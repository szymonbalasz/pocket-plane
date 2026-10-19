// CAMP sprint 5 over real sockets on `player-colours` (DM, `player-1`, `player-2`):
// FR-CAMP-29 colours visibility + live changes + reconnect, FR-CAMP-25 / -26 rejects over WS,
// FR-NOTE-38 the stamp only on rows a player may see. Leak strings: no link token anywhere, no
// `color` key on a signal frame (ADR-0055: 0 B per signal).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import type { CampaignRecord, PlayerRecord } from "@shared/campaign-management/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import type { ServerFrame } from "@shared/protocol/frames";
import { recordsOf } from "@shared/protocol/store";
import { MAP_SIGNALS } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { closeDb, type Db } from "../../db/client";
import { player, scene } from "../../db/schema";
import { readEventLog } from "../../events/log";
import {
  startTestServer,
  TEST_SECRET,
  type TestClient,
  type TestServer,
} from "../../testing/harness";
import { convergence, leakScan } from "../../ws/testing/convergence";

let h: TestServer;
let db: Db;
let cleanup: () => void;
let p: Record<"Player 1" | "Player 2", typeof player.$inferSelect>;

beforeAll(async () => {
  const loaded = await loadBundle("player-colours", { testMode: true, dmSecret: TEST_SECRET });
  cleanup = loaded.cleanup;
  db = loaded.openDb();
  p = Object.fromEntries(
    db
      .select()
      .from(player)
      .all()
      .map((r) => [r.name, r]),
  ) as typeof p;
  h = await startTestServer({ db, testMode: true, fake: false });
}, 60_000);

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
const P1 = () => ({ role: "player" as const, token: p["Player 1"].linkToken });
const P2 = () => ({ role: "player" as const, token: p["Player 2"].linkToken });
const colors = (c: TestClient) =>
  Object.fromEntries(recordsOf<PlayerRecord>(c.store, "player").map((r) => [r.name, r.color]));
const dmColor = (c: TestClient) => recordsOf<CampaignRecord>(c.store, "campaign")[0]?.dmColor;

async function reply(c: TestClient, name: string, payload: unknown) {
  const intentId = c.intent(name, payload);
  for (;;) {
    const f = await c.next(undefined, 2000);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
}

type EventFrame = Extract<ServerFrame, { type: "event" }>;
const scanned = new WeakMap<TestClient, number>();

/**
 * The next event frame whose cause is `type` (≤ 1 s, FR-CAMP-27's live bound), scanning every
 * frame received (`reply` reads past the sender's own event on its way to the ack).
 */
async function eventOf(c: TestClient, type: string): Promise<EventFrame> {
  const deadline = Date.now() + 1000;
  for (;;) {
    const from = scanned.get(c) ?? 0;
    const i = c.frames.findIndex(
      (f, k) => k >= from && f.type === "event" && f.cause.name === type,
    );
    if (i >= 0) {
      scanned.set(c, i + 1);
      return c.frames[i] as EventFrame;
    }
    if (Date.now() > deadline) throw new Error(`No ${type} event within 1000 ms`);
    await Bun.sleep(10);
  }
}

function noTokens(...clients: TestClient[]) {
  for (const c of clients) {
    const raw = c.raw();
    expect(raw).not.toContain("linkToken");
    expect(raw).not.toContain("link_token");
    for (const r of Object.values(p)) expect(raw).not.toContain(r.linkToken);
  }
}

describe("FR-CAMP-29 colours visibility (player-colours)", () => {
  test("FR-CAMP-29 colours visibility: every viewer gets every player's colour and the DM colour; changes reach all three ≤ 1 s; rejects over WS; reconnect converges; no token, no leak", async () => {
    const dm = await h.live(DM);
    const b = await h.live(P1());
    const c = await h.live(P2());
    const want = { "Player 1": "jade", "Player 2": "blue" };
    for (const x of [dm, b, c]) {
      expect(colors(x)).toEqual(want);
      expect(dmColor(x)).toBe("amber");
    }

    // Player 1 picks rose: one `player` upsert to everyone, logged.
    const logN = readEventLog(db).length;
    expect(
      (await reply(b, "camp.setColor", { playerId: p["Player 1"].id, color: "rose" })).type,
    ).toBe("ack");
    for (const x of [dm, b, c]) {
      const f = await eventOf(x, "PlayerColorSet");
      expect(f.changes).toEqual([
        {
          type: "player",
          id: p["Player 1"].id,
          op: "upsert",
          data: {
            id: p["Player 1"].id,
            campaignId: p["Player 1"].campaignId,
            name: "Player 1",
            color: "rose",
          },
        },
      ]);
      expect(colors(x)).toEqual({ "Player 1": "rose", "Player 2": "blue" });
    }
    expect(
      readEventLog(db)
        .slice(logN)
        .map((r) => r.type),
    ).toEqual(["PlayerColorSet"]);

    // The DM moves to yellow: one `campaign` upsert to everyone.
    expect((await reply(dm, "camp.setColor", { playerId: null, color: "yellow" })).type).toBe(
      "ack",
    );
    for (const x of [dm, b, c]) {
      const f = await eventOf(x, "PlayerColorSet");
      expect(f.changes.map((ch) => [ch.type, ch.op])).toEqual([["campaign", "upsert"]]);
      expect(dmColor(x)).toBe("yellow");
    }

    // Rejects: taken, someone else's, the DM colour, a bad key — nothing reaches anyone.
    const rejects = [
      [c, { playerId: p["Player 2"].id, color: "rose" }, "conflict", "Taken by Player 1"],
      [c, { playerId: p["Player 2"].id, color: "yellow" }, "conflict", "Taken by DM"],
      [c, { playerId: p["Player 1"].id, color: "sky" }, "forbidden", undefined],
      [c, { playerId: null, color: "sky" }, "forbidden", undefined],
      [dm, { playerId: p["Player 2"].id, color: "rose" }, "conflict", "Taken by Player 1"],
      [dm, { playerId: p["Player 2"].id, color: "teal" }, "invalid", undefined],
    ] as const;
    for (const [x, payload, code, message] of rejects) {
      const f = await reply(x, "camp.setColor", payload);
      expect(f).toMatchObject({ type: "reject", code, ...(message ? { message } : {}) });
    }
    for (const x of [dm, b]) await x.expectNoFrame(150);

    // Signals carry the server-stamped sender, never a colour.
    const town = db.select().from(scene).where(eq(scene.active, true)).get();
    b.send({ type: "signal", name: MAP_SIGNALS.ping, data: { sceneId: town?.id, x: 10, y: 20 } });
    for (const x of [dm, c]) {
      const f = await x.next("signal", 1000);
      expect(f).toMatchObject({
        name: MAP_SIGNALS.ping,
        from: { role: "player", playerId: p["Player 1"].id },
      });
      expect(JSON.stringify(f)).not.toContain("color");
    }

    // Reconnect: the snapshot carries every colour; stores converge; leak scans clean.
    b.close();
    const b2 = await h.live(P1());
    expect(colors(b2)).toEqual({ "Player 1": "rose", "Player 2": "blue" });
    expect(dmColor(b2)).toBe("yellow");
    for (const [live, cred] of [
      [dm, DM],
      [c, P2()],
    ] as const) {
      const fresh = await h.live(cred);
      const conv = convergence(h.s, live, fresh);
      expect(conv.live).toEqual(conv.fresh);
      fresh.close();
    }
    for (const x of [b2, c]) expect(leakScan(h.s, x)).toEqual([]);
    noTokens(dm, b, b2, c);
    for (const x of [dm, b2, c]) x.close();
  }, 30_000);

  test("FR-CAMP-29 colours visibility: after a restart the snapshot keeps every colour", async () => {
    await h.restart();
    const x = await h.live(P2());
    expect(colors(x)).toEqual({ "Player 1": "rose", "Player 2": "blue" });
    expect(dmColor(x)).toBe("yellow");
    noTokens(x);
    x.close();
  }, 30_000);
});

describe("FR-NOTE-38 visibility (player-colours)", () => {
  test("FR-NOTE-38 visibility: the stamp rides only on rows a player may see; the DM sees all; no hidden row becomes visible", async () => {
    const dm = await h.live(DM);
    const b = await h.live(P1());
    const c = await h.live(P2());
    const notes = (x: TestClient) => recordsOf<NotificationRecord>(x.store, "notification");
    const before = {
      b: new Set(notes(b).map((n) => n.id)),
      c: new Set(notes(c).map((n) => n.id)),
    };
    // Player 1's test card: audience = themself, owner DM.
    const sent = await reply(b, "note.testSend", { text: "Player 1 test" });
    expect(sent.type).toBe("ack");
    const mine = (await eventOf(b, "NotificationCreated")).changes[0]?.data as NotificationRecord;
    expect(mine).toMatchObject({ byRole: "player", byPlayerId: p["Player 1"].id });
    const dmRow = (await eventOf(dm, "NotificationCreated")).changes[0]?.data as NotificationRecord;
    expect(dmRow).toMatchObject({ id: mine.id, byRole: "player", byPlayerId: p["Player 1"].id });
    // The DM to Player 2 only.
    expect(
      (
        await reply(dm, "note.testSend", {
          text: "DM to Player 2",
          audience: "player",
          audiencePlayerId: p["Player 2"].id,
        })
      ).type,
    ).toBe("ack");
    const toC = (await eventOf(c, "NotificationCreated")).changes[0]?.data as NotificationRecord;
    expect(toC).toMatchObject({
      byRole: "dm",
      byPlayerId: null,
      audiencePlayerId: p["Player 2"].id,
    });
    // Player 2 never received Player 1's row, Player 1 never the DM's row to Player 2.
    await b.expectNoFrame(200);
    expect(notes(c).map((n) => n.id)).not.toContain(mine.id);
    expect(notes(b).map((n) => n.id)).not.toContain(toC.id);
    expect(c.raw()).not.toContain("Player 1 test");
    expect(b.raw()).not.toContain("DM to Player 2");
    // Each player holds exactly the rows they held before plus their own new one.
    expect(new Set(notes(b).map((n) => n.id))).toEqual(new Set([...before.b, mine.id]));
    expect(new Set(notes(c).map((n) => n.id))).toEqual(new Set([...before.c, toC.id]));
    for (const x of [b, c]) {
      for (const n of notes(x)) expect(["dm", "player", null]).toContain(n.byRole);
      expect(leakScan(h.s, x)).toEqual([]);
    }
    for (const x of [dm, b, c]) x.close();
  }, 30_000);
});
