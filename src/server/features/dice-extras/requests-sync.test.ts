// TT1+TT2 over real sockets on `table-tools` (DM, Player 1 with Mira, Player 2 with Thorn): the
// real intents. Macros per player (the DM-only "Ambush" and Bless never reach a player; Player 2
// sees Inspiration read-only), the open hidden Perception (DC 15) prompts, a hidden answer sent
// as an intent (DM + the roller only), decline, the DM's public request answered by roll for
// missing, an owner change closing a target. Leak scans per player before and after a reconnect
// (FR-DICEX-92), convergence live = fresh.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { DICEX_MACROS } from "@fixtures/units/dice-extras/dicex-macros";
import { ROLL_MACRO_TYPE, type RollMacroRecord } from "@shared/dice-extras/macros";
import {
  DICEX_REQUEST_INTENTS,
  ROLL_REQUEST_KIND,
  ROLL_REQUEST_TYPE,
  type RollRequestRecord,
} from "@shared/dice-extras/requests";
import type { GameLogEntryRecord } from "@shared/dice-roll-log/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import type { Credential, ServerFrame } from "@shared/protocol/frames";
import { and, eq } from "drizzle-orm";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { campaign, entity, player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { convergence, leakScan } from "../../ws/testing/convergence";

const DM: Credential = { role: "dm", secret: TEST_SECRET };
type EventFrame = Extract<ServerFrame, { type: "event" }>;
const eventsOf = (c: TestClient, name: string, from = 0) =>
  c.frames.slice(from).filter((f): f is EventFrame => f.type === "event" && f.cause.name === name);
async function until(pred: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("condition not reached in time");
    await Bun.sleep(10);
  }
}
async function reply(c: TestClient, intentId: string) {
  for (;;) {
    const f = await c.next(undefined, 3000);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
}
async function ok<T>(c: TestClient, name: string, payload: unknown): Promise<T> {
  const f = await reply(c, c.intent(name, payload));
  expect([name, f.type, f.type === "reject" ? f : null]).toEqual([name, "ack", null]);
  return (f as { result: T }).result;
}
const names = (c: TestClient) =>
  (Object.values(c.store.records[ROLL_MACRO_TYPE] ?? {}) as RollMacroRecord[])
    .map((m) => m.name)
    .sort();
const prompts = (c: TestClient) =>
  (Object.values(c.store.records.notification ?? {}) as NotificationRecord[]).filter(
    (n) => n.kind === ROLL_REQUEST_KIND,
  );

describe("TT1+TT2 table tools over sockets (table-tools)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let links: Record<string, string>;
  let miraId: string;
  let thornId: string;
  let p1Id: string;
  let p2Id: string;
  let dm: TestClient;
  let p1: TestClient;
  let p2: TestClient;
  const cred = (name: string): Credential => ({ role: "player", token: links[name] as string });
  const activeId = () =>
    db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
  const openReq = () =>
    (Object.values(dm.store.records[ROLL_REQUEST_TYPE] ?? {}) as RollRequestRecord[]).find(
      (r) => r.state === "open",
    ) as RollRequestRecord;
  /**
   * No DM-only table-tools data in a player's frames or store (FR-DICEX-92): no other player's or
   * DM-only macro row (by id: names like "Bless" are common words), no request row, DC or pass /
   * fail.
   */
  const expectClean = (c: TestClient, label: string, also: string[] = []) => {
    const raw = c.raw();
    const me = c === p1 ? p1Id : p2Id;
    const others = (Object.values(dm.store.records[ROLL_MACRO_TYPE] ?? {}) as RollMacroRecord[])
      .filter((m) => m.playerId !== me)
      .map((m) => m.id);
    const forbidden = [
      ...others,
      `"type":"${ROLL_REQUEST_TYPE}"`,
      '"success"',
      '"dc":15',
      '"results"',
      ...also,
    ];
    expect([label, forbidden.filter((s) => raw.includes(s))]).toEqual([label, []]);
    expect([label, leakScan(h.s, c)]).toEqual([label, []]);
  };

  beforeAll(async () => {
    const loaded = await loadBundle("table-tools", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    const players = db.select().from(player).where(eq(player.campaignId, activeId())).all();
    links = Object.fromEntries(players.map((r) => [r.name, r.linkToken]));
    p1Id = players.find((p) => p.name === "Player 1")?.id as string;
    p2Id = players.find((p) => p.name === "Player 2")?.id as string;
    const pc = (name: string) =>
      db
        .select()
        .from(entity)
        .where(and(eq(entity.campaignId, activeId()), eq(entity.name, name)))
        .get()?.id as string;
    miraId = pc("Mira");
    thornId = pc("Thorn");
    h = await startTestServer({ db, fake: false, testMode: true });
    dm = await h.live(DM);
    p1 = await h.live(cred("Player 1"));
    p2 = await h.live(cred("Player 2"));
  });

  afterAll(async () => {
    await h.stop();
    closeDb(db);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may hold the WAL briefly; a leftover temp dir is harmless.
    }
  });

  test("FR-DICEX-67 FR-DICEX-92 macros per viewer: DM all five; Player 1 own two; Player 2 Inspiration only", () => {
    expect(names(dm)).toEqual(["Ambush", "Bless", "Inspiration", "Luck", "Sneak Attack"]);
    expect(names(p1)).toEqual(["Luck", "Sneak Attack"]);
    expect(names(p2)).toEqual(["Inspiration"]);
    const insp = Object.values(p2.store.records[ROLL_MACRO_TYPE] ?? {})[0] as RollMacroRecord;
    expect(insp.createdBy).toBeNull();
    expect(names(dm)).toContain(DICEX_MACROS.ambush);
    expectClean(p1, "p1 macros");
    expectClean(p2, "p2 macros");
  });

  test("FR-DICEX-66 macro intents: Player 1 saves on Mira (Player 2 gets no frame); the DM's row → forbidden", async () => {
    const b0 = p2.frames.length;
    await ok(p1, "dicex.saveMacro", {
      name: "Quick",
      expression: "1d20+2",
      category: "attack",
      creatureId: miraId,
    });
    await until(() => names(p1).includes("Quick"));
    await until(() => names(dm).includes("Quick"));
    await p2.expectNoFrame(150);
    expect(p2.frames.length).toBe(b0);
    const insp = Object.values(p2.store.records[ROLL_MACRO_TYPE] ?? {})[0] as RollMacroRecord;
    const no = await reply(p2, p2.intent("dicex.deleteMacro", { id: insp.id }));
    expect(no.type === "reject" ? no.code : no.type).toBe("forbidden");
  });

  test("FR-DICEX-74 FR-DICEX-77 the open request: each player only their own prompt, no DC; DM the row", () => {
    const req = openReq();
    expect([req.label, req.dc, req.results]).toEqual(["Perception", 15, "hidden"]);
    for (const [c, me, mine] of [
      [p1, p1Id, miraId],
      [p2, p2Id, thornId],
    ] as const) {
      const ps = prompts(c);
      expect(ps.map((n) => [n.audiencePlayerId, n.text, n.state])).toEqual([
        [me, "DM: Perception", "pending"],
      ]);
      expect(ps[0]?.payload).toMatchObject({ characterId: mine, dc: null });
    }
    expect(prompts(dm)).toHaveLength(2);
    expectClean(p1, "p1 prompt");
    expectClean(p2, "p2 prompt");
  });

  test("FR-DICEX-78 FR-DICEX-84 FR-NOTE-64 hidden answer as an intent: DM + Player 1 only (the total in Player 1's resolve only); the DM's card has the total", async () => {
    const req = openReq();
    // Player 2 can't answer Mira's target.
    const no = await reply(
      p2,
      p2.intent(DICEX_REQUEST_INTENTS.answerRequest, {
        requestId: req.id,
        characterId: miraId,
        mode: "normal",
      }),
    );
    expect(no.type === "reject" ? no.code : no.type).toBe("not_found");
    const [a0, b0] = [p1.frames.length, p2.frames.length];
    const r = await ok<{ entryId: string }>(p1, DICEX_REQUEST_INTENTS.answerRequest, {
      requestId: req.id,
      characterId: miraId,
      mode: "advantage",
      manual: { diceTotal: 14, dice: [14, 3] },
    });
    await until(() => eventsOf(p1, "NotificationResolved", a0).length === 1);
    await until(() => openReq()?.targets[0]?.state === "rolled");
    const e = p1.store.records["game-log-entry"]?.[r.entryId] as GameLogEntryRecord;
    expect([e.public, e.audiencePlayerId]).toEqual([false, p1Id]);
    const mine = prompts(p1)[0];
    expect([mine?.state, mine?.resolution]).toEqual([
      "resolved",
      { outcome: "rolled", total: openReq().targets[0]?.total },
    ]);
    expect(typeof openReq().targets[0]?.success).toBe("boolean");
    await p2.expectNoFrame(200);
    expect(p2.frames.length).toBe(b0);
    expectClean(p1, "p1 answer");
    expectClean(p2, "p2 answer", [r.entryId]);
  });

  test("FR-DICEX-79 decline over the socket: Player 2 declines → the request closes (all done)", async () => {
    const req = openReq();
    await ok(p2, DICEX_REQUEST_INTENTS.declineRequest, {
      requestId: req.id,
      characterId: thornId,
    });
    await until(() => {
      const r = dm.store.records[ROLL_REQUEST_TYPE]?.[req.id] as RollRequestRecord;
      return r.state === "closed";
    });
    const r = dm.store.records[ROLL_REQUEST_TYPE]?.[req.id] as RollRequestRecord;
    expect(r.targets.map((t) => t.state)).toEqual(["rolled", "declined"]);
    expect(prompts(p2)[0]?.resolution).toEqual({ outcome: "declined" });
  });

  test("FR-DICEX-81 public request, roll for missing: lines to everyone; DC shown in the prompt", async () => {
    const [a0, b0] = [p1.frames.length, p2.frames.length];
    const { requestId } = await ok<{ requestId: string }>(dm, DICEX_REQUEST_INTENTS.request, {
      roll: { kind: "save", key: "dex", expression: null },
      characterIds: [miraId, thornId],
      dc: 12,
      dcShown: true,
      mode: "normal",
      results: "public",
    });
    await until(() => eventsOf(p1, "NotificationCreated", a0).length === 1);
    await until(() => eventsOf(p2, "NotificationCreated", b0).length === 1);
    expect(eventsOf(p1, "RollRequested", a0)).toHaveLength(0);
    const shown = prompts(p1).find((n) => n.state === "pending");
    expect([shown?.text, (shown?.payload as { dc: number } | undefined)?.dc]).toEqual([
      "DM: DEX save · DC 12",
      12,
    ]);
    const out = await ok<{ entryIds: string[] }>(dm, DICEX_REQUEST_INTENTS.rollForMissing, {
      requestId,
    });
    for (const c of [p1, p2]) {
      await until(() => out.entryIds.every((id) => c.store.records["game-log-entry"]?.[id]));
    }
    expect(prompts(p2).every((n) => n.state === "resolved")).toBe(true);
  });

  test("FR-DICEX-65 owner change over the socket: Thorn → Player 1 closes Thorn's target; Player 2 keeps no macro", async () => {
    const { requestId } = await ok<{ requestId: string }>(dm, DICEX_REQUEST_INTENTS.request, {
      roll: { kind: "check", key: "str", expression: null },
      characterIds: [thornId],
      dcShown: false,
      mode: "normal",
      results: "hidden",
    });
    await until(() => prompts(p2).some((n) => n.state === "pending"));
    await ok(dm, "char.edit", { creatureId: thornId, set: { ownerPlayerId: p1Id } });
    await until(() => prompts(p2).every((n) => n.state === "resolved"));
    await until(() => names(p1).includes("Inspiration"));
    expect(names(p2)).toEqual([]);
    const r = dm.store.records[ROLL_REQUEST_TYPE]?.[requestId] as RollRequestRecord;
    expect([r.state, r.targets[0]?.state]).toEqual(["closed", "missed"]);
    expect(prompts(p1).filter((n) => n.state === "pending")).toEqual([]);
    // Back to Player 2 for the reconnect checks.
    await ok(dm, "char.edit", { creatureId: thornId, set: { ownerPlayerId: p2Id } });
    await until(() => names(p2).includes("Inspiration"));
  });

  test("FR-DICEX-92 reconnect: fresh snapshots clean per player and converged", async () => {
    for (const c of [p1, p2]) c.close();
    p1 = await h.live(cred("Player 1"));
    p2 = await h.live(cred("Player 2"));
    const dm2 = await h.live(DM);
    for (const c of [p1, p2]) {
      const snap = [...c.frames].reverse().find((f) => f.type === "snapshot");
      if (snap?.type !== "snapshot") throw new Error("no snapshot");
      expect(Object.keys(snap.records)).not.toContain(ROLL_REQUEST_TYPE);
    }
    expect(names(p1)).toEqual(["Luck", "Quick", "Sneak Attack"]);
    expect(names(p2)).toEqual(["Inspiration"]);
    expectClean(p1, "p1 reconnect");
    expectClean(p2, "p2 reconnect");
    for (const [live, label] of [
      [dm, "dm"],
      [p1, "p1"],
      [p2, "p2"],
    ] as const) {
      const fresh = label === "dm" ? dm2 : live;
      const { live: l, fresh: f } = convergence(h.s, live, fresh);
      expect([label, l]).toEqual([label, f]);
    }
    dm2.close();
  });
});
