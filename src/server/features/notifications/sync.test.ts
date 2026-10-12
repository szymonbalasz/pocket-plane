// NOTE §13 integration over real sockets on the `notifications` bundle: visibility per viewer,
// leak scan, intents and rejects, live events, ADR-0029 window, convergence, restart.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import { NOTIFICATIONS_TEST_ITEMS } from "@fixtures/units/notifications/notifications-test";
import type { NotificationRecord } from "@shared/notifications/schemas";
import type { ServerFrame } from "@shared/protocol/frames";
import { recordsOf } from "@shared/protocol/store";
import { closeDb, type Db } from "../../db/client";
import { player } from "../../db/schema";
import type { Actor } from "../../events/types";
import {
  startTestServer,
  TEST_SECRET,
  type TestClient,
  type TestServer,
} from "../../testing/harness";
import { convergence, leakScan } from "../../ws/testing/convergence";
import { activateCampaign, addPlayer, createCampaign } from "../campaign-management/commands";
import { noteDismiss, noteResolve, noteTestSend } from "./commands";

let h: TestServer;
let db: Db;
let cleanup: () => void;
let tokens: Record<string, string>;
let ids: Record<(typeof NOTIFICATIONS_TEST_ITEMS)[number], string>;

beforeAll(async () => {
  const loaded = await loadBundle("notifications", { testMode: true, dmSecret: TEST_SECRET });
  cleanup = loaded.cleanup;
  db = loaded.openDb();
  tokens = Object.fromEntries(
    db
      .select()
      .from(player)
      .all()
      .map((p) => [p.name, p.linkToken]),
  );
  const list = loaded.manifest.records["notifications-test"]?.notification ?? [];
  ids = Object.fromEntries(NOTIFICATIONS_TEST_ITEMS.map((k, i) => [k, list[i] as string])) as never;
  h = await startTestServer({ db, testMode: true, fake: false });
});

afterAll(async () => {
  await h.stop();
  closeDb(db);
  try {
    cleanup();
  } catch {
    // Windows may hold the WAL briefly; a leftover temp dir is harmless.
  }
});

const DM = { role: "dm" as const, secret: TEST_SECRET };
const P1 = () => ({ role: "player" as const, token: tokens["Player 1"] as string });
const P2 = () => ({ role: "player" as const, token: tokens["Player 2"] as string });
const notes = (c: TestClient) => recordsOf<NotificationRecord>(c.store, "notification");
const idSet = (c: TestClient) => new Set(notes(c).map((n) => n.id));

async function reply(c: TestClient, name: string, payload: unknown) {
  const intentId = c.intent(name, payload);
  for (;;) {
    const f = await c.next(undefined, 2000);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
}
const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};

describe("notifications over WS (notifications bundle)", () => {
  test("FR-NOTE-06/12 snapshots: DM 7; Player 1 its four; Player 2 two; no SECRET-NOTE in player frames", async () => {
    const dm = await h.live(DM);
    const b = await h.live(P1());
    const c = await h.live(P2());
    expect(notes(dm)).toHaveLength(7);
    expect(idSet(b)).toEqual(
      new Set([ids["info-all"], ids["info-p1"], ids["pending-p1"], ids["resolved-all"]]),
    );
    expect(idSet(c)).toEqual(new Set([ids["info-all"], ids["resolved-all"]]));
    const byId = Object.fromEntries(notes(dm).map((n) => [n.id, n]));
    expect(byId[ids["resolved-all"]]).toMatchObject({ state: "resolved", closedByRole: "dm" });
    expect(byId[ids["dismissed-dm"]]).toMatchObject({ state: "dismissed" });
    expect(byId[ids["pending-p1"]]).toMatchObject({
      state: "pending",
      actionRole: "player",
      actionLabel: "Done",
    });
    for (const x of [b, c]) {
      expect(x.raw()).not.toContain("SECRET-NOTE");
      expect(leakScan(h.s, x)).toEqual([]);
    }
    for (const x of [dm, b, c]) x.close();
  });

  test("FR-NOTE-09/11/22 rejects: P2 resolve pending-p1 → not_found; player dismiss → forbidden; player testSend with audience → invalid", async () => {
    const b = await h.live(P1());
    const c = await h.live(P2());
    expect(await reply(c, "note.resolve", { id: ids["pending-p1"] })).toMatchObject({
      type: "reject",
      code: "not_found",
    });
    expect(await reply(b, "note.dismiss", { id: ids["pending-p1"] })).toMatchObject({
      type: "reject",
      code: "forbidden",
    });
    expect(await reply(b, "note.testSend", { text: "x", audience: "all" })).toMatchObject({
      type: "reject",
      code: "invalid",
    });
    // DM-owned pending (audience dm) is invisible to players: not_found, never forbidden.
    expect(await reply(b, "note.resolve", { id: ids["pending-dm"] })).toMatchObject({
      code: "not_found",
    });
    expect(await reply(b, "note.resolve", { id: ids["resolved-all"] })).toMatchObject({
      code: "conflict",
    });
    for (const x of [b, c]) x.close();
  });

  test("FR-NOTE-02/13/16 live: DM sends pending to P1 → event frames (cause NotificationCreated) to DM + P1 only; P1 resolves; events before ack", async () => {
    const dm = await h.live(DM);
    const b = await h.live(P1());
    const c = await h.live(P2());
    const sent = await reply(dm, "note.testSend", {
      text: "Roll DEX save",
      audience: "player",
      audiencePlayerId: idOfPlayer("Player 1"),
      actionLabel: "Done",
      actionRole: "player",
      actionPlayerId: idOfPlayer("Player 1"),
    });
    expect(sent.type).toBe("ack");
    const newId = (sent as Extract<ServerFrame, { type: "ack" }>).result as { id: string };
    const ev = dm.frames.find((f) => f.type === "event" && f.cause.name === "NotificationCreated");
    expect(dm.frames.indexOf(ev as ServerFrame)).toBeLessThan(dm.frames.indexOf(sent));
    const be = await b.next("event", 1000);
    expect(be.cause.name).toBe("NotificationCreated");
    expect(be.changes).toEqual([
      expect.objectContaining({ type: "notification", id: newId.id, op: "upsert" }),
    ]);
    await c.expectNoFrame(200);

    const done = await reply(b, "note.resolve", { id: newId.id });
    expect(done.type).toBe("ack");
    const de = await dm.next("event", 1000);
    expect(de.cause.name).toBe("NotificationResolved");
    expect(de.changes[0]?.data).toMatchObject({
      state: "resolved",
      closedByRole: "player",
      closedByPlayerId: idOfPlayer("Player 1"),
    });
    expect(await reply(b, "note.resolve", { id: newId.id })).toMatchObject({ code: "conflict" });
    await c.expectNoFrame(100);

    // Convergence: live stores equal fresh snapshots.
    for (const [live, cred] of [
      [dm, DM],
      [b, P1()],
      [c, P2()],
    ] as const) {
      await barrier(live);
      const fresh = await h.live(cred);
      const cv = convergence(h.s, live, fresh);
      expect(cv.live).toEqual(cv.fresh);
      fresh.close();
    }
    for (const x of [dm, b, c]) x.close();
  });

  test("FR-NOTE-07 concurrent resolve from two DM tabs: one ack, one conflict", async () => {
    const a = await h.live(DM);
    const d = await h.live(DM);
    const b = await h.live(P1());
    const sent = await reply(b, "note.testSend", { text: "Apply 4 damage?" });
    const { id } = (sent as Extract<ServerFrame, { type: "ack" }>).result as { id: string };
    await barrier(a);
    await barrier(d);
    const ia = a.intent("note.resolve", { id });
    const id2 = d.intent("note.resolve", { id });
    const ra = await waitReply(a, ia);
    const rd = await waitReply(d, id2);
    expect([ra.type, rd.type].sort()).toEqual(["ack", "reject"]);
    const rej = [ra, rd].find((r) => r.type === "reject");
    expect(rej).toMatchObject({ code: "conflict" });
    for (const x of [a, d, b]) x.close();
  });

  test("FR-NOTE-12 restart on the same DB → identical snapshots; resolve after restart works", async () => {
    const snap = async () => {
      const out: Record<string, unknown> = {};
      for (const [k, cred] of Object.entries({ dm: DM, p1: P1(), p2: P2() })) {
        const x = await h.live(cred);
        out[k] = notes(x).sort((p, q) => p.seq - q.seq);
        x.close();
      }
      return out;
    };
    const before = await snap();
    await h.restart();
    expect(await snap()).toEqual(before);
    const b = await h.live(P1());
    const pend = notes(b).find((n) => n.state === "pending" && n.actionRole === "player");
    expect(pend).toBeDefined();
    expect(await reply(b, "note.resolve", { id: pend?.id })).toMatchObject({ type: "ack" });
    b.close();
  });
});

function idOfPlayer(name: string): string {
  const p = db
    .select()
    .from(player)
    .all()
    .find((x) => x.name === name);
  return p?.id as string;
}

async function waitReply(c: TestClient, intentId: string) {
  for (;;) {
    const f = await c.next(undefined, 2000);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
}

describe("ADR-0029 window (FR-NOTE-12)", () => {
  test("FR-NOTE-12 105 closed + 3 pending → DM 103; same floor for all; players get the visible subset", async () => {
    const t = await startTestServer({ testMode: true });
    try {
      const dm0: Actor = { role: "dm", playerId: null, campaignId: null };
      const run = t.s.commands.run.bind(t.s.commands);
      const c1 = run(createCampaign, { name: "One" }, { actor: dm0 });
      const p1 = run(addPlayer, { name: "Player 1" }, { actor: dm0 });
      const p2 = run(addPlayer, { name: "Player 2" }, { actor: dm0 });
      run(createCampaign, { name: "Two" }, { actor: dm0 });
      run(activateCampaign, { id: c1.id }, { actor: dm0 });
      const dm: Actor = { ...dm0, campaignId: c1.id };
      const send = (i: number, extra: Record<string, unknown> = {}) =>
        run(noteTestSend, { text: `n${i}`, ...extra } as never, { actor: dm }).id;
      const pendingIds: string[] = [];
      // Oldest rows: two pending (pinned) far below the floor.
      pendingIds.push(send(0, { audience: "all", actionLabel: "Ok" }));
      pendingIds.push(send(1, { audience: "dm", actionLabel: "Ok" }));
      const closed: string[] = [];
      for (let i = 0; i < 105; i++) {
        const audience = i % 3 === 0 ? "all" : i % 3 === 1 ? "dm" : "player";
        const extra = audience === "player" ? { audience, audiencePlayerId: p1.id } : { audience };
        // Every 10th is a pending row that gets resolved / dismissed (closed rows count).
        if (i % 10 === 0) {
          const id = send(i + 2, { ...extra, actionLabel: "Ok" });
          run(i % 20 === 0 ? noteResolve : noteDismiss, { id }, { actor: dm });
          closed.push(id);
        } else closed.push(send(i + 2, extra));
      }
      pendingIds.push(
        send(200, { audience: "player", audiencePlayerId: p2.id, actionLabel: "Go" }),
      );

      const dmc = await t.live({ role: "dm", secret: TEST_SECRET });
      const tok = Object.fromEntries(
        t.db
          .select()
          .from(player)
          .all()
          .map((p) => [p.id, p.linkToken]),
      );
      const b = await t.live({ role: "player", token: tok[p1.id] as string });
      const c = await t.live({ role: "player", token: tok[p2.id] as string });
      const dmIds = idSet(dmc);
      expect(dmIds.size).toBe(103);
      for (const id of pendingIds) expect(dmIds.has(id)).toBe(true);
      const newest100 = closed.slice(-100);
      for (const id of newest100) expect(dmIds.has(id)).toBe(true);
      for (const id of closed.slice(0, 5)) expect(dmIds.has(id)).toBe(false);
      // Players: the visible subset of the same cut.
      for (const x of [b, c]) {
        for (const n of notes(x)) expect(dmIds.has(n.id)).toBe(true);
        expect(leakScan(t.s, x)).toEqual([]);
      }
      const floor = Math.min(
        ...notes(dmc)
          .filter((n) => n.state !== "pending")
          .map((n) => n.seq),
      );
      for (const x of [b, c]) {
        for (const n of notes(x)) {
          if (n.state !== "pending") expect(n.seq).toBeGreaterThanOrEqual(floor);
        }
      }
      // P1 sees `all` + its own rows in the cut and the pinned `all` row; P2 its pinned row.
      expect(notes(b).some((n) => n.id === pendingIds[0])).toBe(true);
      expect(notes(c).some((n) => n.id === pendingIds[2])).toBe(true);
      expect(notes(b).some((n) => n.id === pendingIds[2])).toBe(false);
      // Closing the oldest pinned row (below the floor) is delivered live; a fresh snapshot omits it.
      const r = dmc.intent("note.resolve", { id: pendingIds[0] });
      await waitReply(dmc, r);
      await barrier(b);
      expect(notes(b).find((n) => n.id === pendingIds[0])?.state).toBe("resolved");
      const fresh = await t.live({ role: "player", token: tok[p1.id] as string });
      expect(idSet(fresh).has(pendingIds[0] as string)).toBe(false);
      const cv = convergence(t.s, b, fresh);
      expect(cv.live).toEqual(cv.fresh);
    } finally {
      await t.stop();
    }
  });
});
