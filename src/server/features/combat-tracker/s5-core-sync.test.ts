// Sprint 5 track R core (R0) over real sockets on `late-damage` (= rules-effects, round 1):
// Apply hit lines reach players, the hit ruling never does; the side players see is the public
// one; trails ride the token and reach players on player tokens only; after a reconnect every
// client holds the same trails (FR-MAP-67's server half) and a fresh store equals the live one.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import {
  type AttackResult,
  COMBATANT_TYPE,
  type CombatantRecord,
  HIT_RULING_TYPE,
  LOG_KIND_ATTACK,
} from "@shared/combat-tracker/schemas";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { formatEntry } from "@shared/dice-roll-log/line";
import { GAME_LOG_ENTRY_TYPE, type GameLogEntryView } from "@shared/dice-roll-log/schemas";
import { TOKEN_TYPE, type TokenRecord } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { encounter, player } from "../../db/schema";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";

const DM = { role: "dm" as const, secret: TEST_SECRET };

async function nextEvent(c: TestClient, cause: string) {
  for (;;) {
    const e = await c.next("event", 1500);
    if (e.cause.name === cause) return e;
  }
}
const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};
const byName = (c: TestClient, name: string) =>
  (Object.values(c.store.records[COMBATANT_TYPE] ?? {}) as CombatantRecord[]).find(
    (x) => x.name === name,
  );
const attackLines = (c: TestClient) =>
  (Object.values(c.store.records[GAME_LOG_ENTRY_TYPE] ?? {}) as GameLogEntryView[])
    .sort((a, b) => a.n - b.n)
    .filter((e) => e.kind === LOG_KIND_ATTACK)
    .map((e) => lineText(formatEntry(e).segments));
/** Token id → its trail cells, for every token the client holds. */
const trails = (c: TestClient) =>
  Object.fromEntries(
    (Object.values(c.store.records[TOKEN_TYPE] ?? {}) as TokenRecord[]).map((t) => [
      t.id,
      t.trail?.cells ?? null,
    ]),
  );

describe("sprint 5 core over WS (late-damage)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let tokens: Record<string, string>;
  const p = (name: string) => ({ role: "player" as const, token: tokens[name] as string });

  beforeAll(async () => {
    const loaded = await loadBundle("late-damage", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    tokens = Object.fromEntries(
      db
        .select({ name: player.name, token: player.linkToken })
        .from(player)
        .all()
        .map((r) => [r.name, r.token]),
    );
    h = await startTestServer({ db, fake: false });
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

  test("FR-CBT-88 FR-CBT-100 FR-MAP-66 FR-MAP-67 leak scan + trail equality after reconnect", async () => {
    // Players hold (and move) the battle scene's tokens only while it is active.
    const enc = db.select().from(encounter).where(eq(encounter.status, "started")).get();
    h.s.commands.run(
      "map.activateScene",
      { sceneId: enc?.sceneId },
      { actor: { role: "dm", playerId: null, campaignId: enc?.campaignId as string } },
    );
    const dm = await h.live(DM);
    const p1 = await h.live(p("Player 1"));
    const p2 = await h.live(p("Player 2"));
    const mira = byName(p1, "Mira") as CombatantRecord;
    const goblin = byName(dm, "Goblin") as CombatantRecord;
    const goblin2 = byName(dm, "Goblin 2") as CombatantRecord;
    const start = [p1.frames.length, p2.frames.length];

    // FR-CBT-88: Mira's to-hit card; the DM applies the hit before any damage.
    p1.intent("cbt.attack", { attackerId: mira.id, rolls: "toHit", manual: [{ diceTotal: 11 }] });
    const { cardId } = (await p1.next("ack")).result as AttackResult;
    await nextEvent(dm, "NotificationCreated");
    dm.intent("cbt.applyHit", {
      cardId,
      toHitTotal: 15,
      targets: [{ targetId: goblin2.id, hit: true, multiplier: "normal" }],
    });
    await dm.next("ack");
    for (const c of [p1, p2]) await nextEvent(c, "HitApplied");
    // The bundle's `late-hit-ruled` (R1) already holds one ruling.
    expect(Object.keys(dm.store.records[HIT_RULING_TYPE] ?? {})).toHaveLength(2);
    for (const c of [p1, p2]) {
      expect(attackLines(c).at(-1)).toMatch(/^Mira attacks Goblin 2: .* — DM: hit\.$/);
    }

    // FR-CBT-100: open ally, then a secret betrayal: players keep "ally", no line.
    dm.intent("cbt.setSide", { combatantId: goblin2.id, side: "ally" });
    await dm.next("ack");
    for (const c of [p1, p2]) await nextEvent(c, "CombatantSideChanged");
    dm.intent("cbt.setSide", { combatantId: goblin2.id, side: "enemy", secret: true });
    await dm.next("ack");
    for (const c of [p1, p2]) await barrier(c);
    for (const c of [p1, p2]) {
      expect((byName(c, "Goblin 2") as unknown as { side: string }).side).toBe("ally");
    }
    expect(byName(dm, "Goblin 2")).toMatchObject({ side: "enemy", publicSide: "ally" });

    // FR-CBT-97 / FR-MAP-66: the Goblin (DM) and Mira (player-1) move; trails ride the tokens
    // (appended to the bundle's `trail-moves`: Goblin 12,6 → 10,6; Mira 2,7 → 4,7 → 5,6).
    dm.intent("map.moveToken", { tokenId: goblin.tokenId, col: 11, row: 6 });
    await dm.next("ack");
    p1.intent("map.moveToken", { tokenId: mira.tokenId, col: 3, row: 7 });
    await p1.next("ack");
    p1.intent("map.moveToken", { tokenId: mira.tokenId, col: 4, row: 7 });
    await p1.next("ack");
    for (const c of [dm, p1, p2]) await barrier(c);
    expect(trails(dm)[goblin.tokenId as string]).toEqual([
      [12, 6],
      [10, 6],
      [11, 6],
    ]);
    for (const c of [dm, p1, p2]) {
      expect(trails(c)[mira.tokenId as string]).toHaveLength(5);
    }

    // Leak scan of every player frame since the start (CBT §13.1 leak strings).
    for (const [i, c] of [p1, p2].entries()) {
      const frames = JSON.stringify(c.frames.slice(start[i]));
      for (const leak of [HIT_RULING_TYPE, "rulingId", "publicSide", "(secret)", "secret"]) {
        expect(frames).not.toContain(leak);
      }
      expect(trails(c)[goblin.tokenId as string] ?? null).toBeNull();
      const gob = c.store.records[TOKEN_TYPE]?.[goblin.tokenId as string];
      expect(Object.keys(gob ?? {})).not.toContain("trail");
    }

    // FR-MAP-67 (server half): reconnects bring back equal trails; live = fresh for every client.
    const before = [trails(dm), trails(p1), trails(p2)];
    const dm2 = await h.live(DM);
    const p12 = await h.live(p("Player 1"));
    const p22 = await h.live(p("Player 2"));
    expect([trails(dm2), trails(p12), trails(p22)]).toEqual(before);
    // Every player token's trail is the same on every client that holds it.
    for (const c of [p12, p22]) {
      for (const [id, cells] of Object.entries(trails(c))) {
        if (cells) expect(trails(dm2)[id]).toEqual(cells);
      }
    }
    expect(dm2.store.records[HIT_RULING_TYPE]).toEqual(dm.store.records[HIT_RULING_TYPE]);
    expect(byName(p22, "Goblin 2")).toEqual(byName(p2, "Goblin 2") as CombatantRecord);
  });
});
