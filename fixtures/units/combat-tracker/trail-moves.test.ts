// CBT §13.1 sprint 5 R3 (FR-CBT-97, FR-MAP-65–67) over real sockets on `late-damage` (its
// `trail-moves`: Mira ×2, Thorn ×1, Goblin ×1 this turn): every client that holds a token holds
// the same stored trail (the draw input, FR-MAP-67), before and after a reload, a reconnect and a
// server restart; players hold player tokens' trails only (FR-MAP-66); a hidden token's moves
// never reach a player, also not after the reveal; a blind player sees the whole turn's trail
// once they see the token again (party knowledge). Plus the fixture itself on both bundles.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import { closeDb, type Db, openFileDb } from "@server/db/client";
import { encounter, player, token } from "@server/db/schema";
import { startTestServer, type TestClient, type TestServer } from "@server/testing/harness";
import { TEST_SECRET } from "@server/testing/services";
import { CBTX_INTENTS } from "@shared/combat-extras/intents";
import { CBT_INTENTS } from "@shared/combat-tracker/schemas";
import { MAP_INTENTS, TOKEN_TYPE, type TokenRecord } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { TRAIL_CELLS } from "./trail-moves";

const DM = { role: "dm" as const, secret: TEST_SECRET };
const NAMES = { mira: "Mira", thorn: "Thorn", goblin: "Goblin" } as const;

const dirs: string[] = [];
afterAll(() => {
  Bun.gc(true);
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // Windows may hold the WAL briefly; a leftover temp dir is harmless.
    }
  }
});

const cellsOf = (t: { trail?: { cells: [number, number][] } | null }) =>
  t.trail ? t.trail.cells.map(([c, r]) => `${c},${r}`).join(" ") : null;

/** What `DragPaths` draws on a client: token name → `cells` attr (segments = cells − 1). */
function drawn(c: TestClient, sceneId: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of Object.values(c.store.records[TOKEN_TYPE] ?? {}) as TokenRecord[]) {
    const cells = t.sceneId === sceneId ? cellsOf(t) : null;
    if (cells) out[t.name] = cells;
  }
  return out;
}

describe("CBT §13.1 trail-moves fixture (sprint 5, R3)", () => {
  for (const bundle of ["late-damage", "session-sim-9"]) {
    test(`CBT §13.1 trail-moves on ${bundle}: Mira 2, Thorn 1, Goblin 1 segments this turn`, async () => {
      const r = await loadBundle(bundle);
      dirs.push(r.dir);
      const db = r.openDb();
      const enc = db.select().from(encounter).where(eq(encounter.status, "started")).get();
      const rows = db
        .select()
        .from(token)
        .where(eq(token.sceneId, enc?.sceneId as string))
        .all();
      closeDb(db);
      expect(r.manifest.fixtures).toContain("trail-moves");
      const trails = Object.fromEntries(
        rows.filter((t) => t.trail).map((t) => [t.name, cellsOf(t)]),
      );
      expect(trails).toEqual({
        [NAMES.mira]: TRAIL_CELLS.mira,
        [NAMES.thorn]: TRAIL_CELLS.thorn,
        [NAMES.goblin]: TRAIL_CELLS.goblin,
      });
    }, 60_000);
  }
});

describe("FR-MAP-67 trails over WS (late-damage)", () => {
  let h: TestServer;
  let db: Db;
  let links: Record<string, string>;
  let sceneId: string;
  let encounterId: string;
  const p = (name: string) => ({ role: "player" as const, token: links[name] as string });
  const tokenId = (name: string) =>
    db
      .select()
      .from(token)
      .all()
      .find((t) => t.name === name && t.sceneId === sceneId)?.id as string;
  const barrier = async (c: TestClient) => {
    c.send({ type: "ping" });
    await c.next("pong");
  };
  const ok = async (c: TestClient, name: string, payload: unknown) => {
    const id = c.intent(name, payload);
    for (;;) {
      const f = await c.next(undefined, 2000);
      if (f.type === "reject" && f.intentId === id) throw new Error(`${name}: ${f.message}`);
      if (f.type === "ack" && f.intentId === id) return f;
    }
  };
  const clients = async () => [
    await h.live(DM),
    await h.live(p("Player 1")),
    await h.live(p("Player 2")),
  ];

  beforeAll(async () => {
    const loaded = await loadBundle("late-damage", { dmSecret: TEST_SECRET, testMode: true });
    dirs.push(loaded.dir);
    db = openFileDb(loaded.config.dbPath);
    links = Object.fromEntries(
      db
        .select({ name: player.name, token: player.linkToken })
        .from(player)
        .all()
        .map((r) => [r.name, r.token]),
    );
    const enc = db.select().from(encounter).where(eq(encounter.status, "started")).get();
    sceneId = enc?.sceneId as string;
    encounterId = enc?.id as string;
    h = await startTestServer({ db, fake: false });
    // Players hold the battle scene's tokens only while it is active (L1 has it shown).
    h.s.commands.run(
      MAP_INTENTS.activateScene,
      { sceneId },
      { actor: { role: "dm", playerId: null, campaignId: enc?.campaignId as string } },
    );
  });

  afterAll(async () => {
    await h.stop();
    closeDb(db);
  });

  test("FR-MAP-67 trail equality after reload: DM + two players, reconnect and restart (L1, L2)", async () => {
    const dmTrails = {
      [NAMES.mira]: TRAIL_CELLS.mira,
      [NAMES.thorn]: TRAIL_CELLS.thorn,
      [NAMES.goblin]: TRAIL_CELLS.goblin,
    };
    const playerTrails = { [NAMES.mira]: TRAIL_CELLS.mira, [NAMES.thorn]: TRAIL_CELLS.thorn };
    const expectL1 = (cs: TestClient[]) =>
      expect(cs.map((c) => drawn(c, sceneId))).toEqual([dmTrails, playerTrails, playerTrails]);

    // L1: the DM every token's trail; players Mira's and Thorn's, the Goblin's never.
    const [dm, p1, p2] = await clients();
    expectL1([dm, p1, p2] as TestClient[]);
    for (const c of [p1, p2] as TestClient[]) {
      const gob = c.store.records[TOKEN_TYPE]?.[tokenId(NAMES.goblin)];
      if (gob) expect(Object.keys(gob)).not.toContain("trail");
      expect(c.raw()).not.toContain('"cells":[[12,6],[10,6]]');
    }
    // L2: reload (fresh connections) → the same trails on every client.
    expectL1(await clients());
    // A server restart: still the same.
    await h.restart();
    expectL1(await clients());
  });

  test("FR-MAP-66 hidden token: moves while hidden never reach a player; the reveal resets the trail", async () => {
    const [dm, p1, p2] = (await clients()) as [TestClient, TestClient, TestClient];
    const thorn = tokenId(NAMES.thorn);
    const from = [p1.raw().length, p2.raw().length];
    await ok(dm, MAP_INTENTS.setTokenHidden, { tokenId: thorn, hidden: true });
    await ok(dm, MAP_INTENTS.moveToken, { tokenId: thorn, col: 6, row: 11 });
    await ok(dm, MAP_INTENTS.moveToken, { tokenId: thorn, col: 7, row: 12 });
    // The DM's copy keeps the visible part only (nothing appended while hidden).
    await barrier(dm);
    expect(drawn(dm, sceneId)[NAMES.thorn]).toBe(TRAIL_CELLS.thorn);
    await ok(dm, MAP_INTENTS.setTokenHidden, { tokenId: thorn, hidden: false });
    for (const c of [dm, p1, p2]) await barrier(c);
    for (const c of [dm, p1, p2]) expect(drawn(c, sceneId)[NAMES.thorn]).toBeUndefined();
    for (const [i, c] of [p1, p2].entries()) {
      const since = c.raw().slice(from[i]);
      expect(since).not.toContain("[6,11]");
      expect(since).not.toContain("[7,12]");
    }
    // The next move starts from the current cell, the same on every client and after a reload.
    await ok(p2, MAP_INTENTS.moveToken, { tokenId: thorn, col: 7, row: 11 });
    for (const c of [dm, p1, p2]) await barrier(c);
    const fresh = await clients();
    for (const c of [dm, p1, p2, ...fresh]) {
      expect(drawn(c, sceneId)[NAMES.thorn]).toBe("7,12 7,11");
    }
  });

  test("FR-MAP-66 party knowledge: a blind player sees the whole turn's trail once they see the token again", async () => {
    const [dm, p1, p2] = (await clients()) as [TestClient, TestClient, TestClient];
    const mira = tokenId(NAMES.mira);
    const thornChar = db
      .select()
      .from(token)
      .all()
      .find((t) => t.id === tokenId(NAMES.thorn))?.definitionId as string;
    const r = await ok(dm, CBTX_INTENTS.addEffect, {
      targets: [{ characterId: thornChar }],
      kind: "condition",
      condition: "blinded",
    });
    const effectId = ((r as { result: { effectIds: string[] } }).result.effectIds as string[])[0];
    await barrier(p2);
    // Blind: player-2 no longer holds Mira (nor her trail).
    expect(p2.store.records[TOKEN_TYPE]?.[mira]).toBeUndefined();
    await ok(p1, MAP_INTENTS.moveToken, { tokenId: mira, col: 6, row: 6 });
    for (const c of [dm, p1, p2]) await barrier(c);
    const whole = `${TRAIL_CELLS.mira} 6,6`;
    expect([drawn(dm, sceneId)[NAMES.mira], drawn(p1, sceneId)[NAMES.mira]]).toEqual([
      whole,
      whole,
    ]);
    expect(p2.store.records[TOKEN_TYPE]?.[mira]).toBeUndefined();
    await ok(dm, CBTX_INTENTS.endEffect, { effectId });
    await barrier(p2);
    // Sighted again: Mira with the whole turn's trail, as everyone else (no per-viewer clipping).
    expect(drawn(p2, sceneId)[NAMES.mira]).toBe(whole);
    // Next: every trail gone on every client (L5).
    const enc = db.select().from(encounter).where(eq(encounter.id, encounterId)).get();
    await ok(dm, CBT_INTENTS.nextTurn, {
      encounterId,
      expectedRound: enc?.round,
      expectedTurnId: enc?.turnCombatantId,
    });
    for (const c of [dm, p1, p2]) await barrier(c);
    for (const c of [dm, p1, p2]) expect(drawn(c, sceneId)).toEqual({});
  });
});
