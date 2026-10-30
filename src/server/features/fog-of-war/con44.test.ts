// FOG §12 / §13 CON-44 under OQ-FOG-30 B (#207) and the #208 ceilings (DM 1 MiB, players
// 512 KiB, no headroom guard): the realistic-heavy harness with FOG v2 rows on the active battle
// scene (12 typical fog shapes, 2 darkness shapes, each player's explored memory). DM: only the
// active scene's `fog` row (`dmWindow`), no `view-as` rows; players: their own `fog` / memory.
// Per-type bounds: DM `fog` ≤ 16 KiB, a player's `vision` ≤ 48 KiB and `fog-explored` ≤ 8 KiB,
// the View-as ack at caps ≤ 128 KiB. V2: the same with real sight (senses on, 300 walls, one player
// at 4 sources of r 24), and a move's server time at those caps (logged).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import {
  EXPLORED_VERTICES_MAX,
  FOG_EXPLORED_TYPE,
  FOG_TYPE,
  VISION_TYPE,
} from "@shared/fog-of-war/schemas";
import type { DarknessRow, FogLayerShape } from "@shared/fog-of-war/shapes";
import { MAP_INTENTS, TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { and, eq } from "drizzle-orm";
import {
  campaign,
  entity,
  fogExplored,
  player,
  scene,
  sceneFog,
  sceneStructure,
} from "../../db/schema";
import { SNAPSHOT_CEILING } from "../../ws/hub";
import {
  buildRealisticHeavy,
  HEAVY,
  servicesFromBundle,
  snapshotFrames,
  snapshotSizes,
} from "../../ws/testing/snapshot-size";
import { ringShape } from "./testing";

/** FR-FOG-27: the serialized row ≤ 16 KiB. */
const FOG_ROW_MAX = 16 * 1024;
/** FOG §13 CON-44 row: per-player bounds. */
const VISION_MAX = 48 * 1024;
const EXPLORED_MAX = 8 * 1024;
const VIEW_AS_ACK_MAX = 128 * 1024;
const AT = "2026-01-01T00:00:00.000Z";

/** FOG §12's typical scene: 5 rects, 5 ten-vertex polygons, 2 circles (freeform), 2 darkness. */
function typicalShapes(): { shapes: FogLayerShape[]; darkness: DarknessRow[] } {
  const shapes: FogLayerShape[] = [];
  for (let i = 0; i < 5; i++) {
    shapes.push({ op: i % 2 ? "fog" : "reveal", rect: [i * 3.25, 1.5, i * 3.25 + 2.75, 6.5] });
  }
  for (let i = 0; i < 5; i++) {
    const poly: number[] = [];
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      poly.push(
        Math.round((4 + i * 3 + Math.cos(a) * 2.37) * 100) / 100,
        Math.round((9 + Math.sin(a) * 1.83) * 100) / 100,
      );
    }
    shapes.push({ op: i === 4 ? "explored" : "reveal", polygon: poly });
  }
  shapes.push(
    { op: "reveal", circle: [6.5, 11.25, 2.5] },
    { op: "fog", circle: [14.75, 3.5, 1.5] },
  );
  return {
    shapes,
    darkness: [
      { id: "00000000-0000-4000-8000-0000000000d1", circle: [12.5, 9, 1.5] },
      { id: "00000000-0000-4000-8000-0000000000d2", rect: [16.25, 10.5, 18.75, 12.25] },
    ],
  };
}

describe("CON-44 with FOG v2 (FOG §12, #208)", () => {
  let b: Awaited<ReturnType<typeof servicesFromBundle>>;
  beforeAll(async () => {
    b = await servicesFromBundle(await loadBundle("session-sim", { testMode: true }));
    buildRealisticHeavy(b.s);
    const db = b.s.db;
    const cid = db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
    const battle = db
      .select()
      .from(scene)
      .where(and(eq(scene.campaignId, cid), eq(scene.active, true)))
      .get()?.id as string;
    const players = db.select().from(player).where(eq(player.campaignId, cid)).all();
    const { shapes, darkness } = typicalShapes();
    const ids = players.map((p) => p.id);
    db.update(sceneFog)
      .set({ shapes, darkness: darkness.map((d) => ({ ...d, seenBy: ids })) })
      .where(eq(sceneFog.sceneId, battle))
      .run();
    // Remember explored areas is on by default (#383): the load may already have grown a row.
    for (const p of players) {
      // A walked 40 × 40 map held 500 vertices at most (ADR-0076).
      const heavy = { shape: ringShape(500), updatedAt: AT };
      db.insert(fogExplored)
        .values({ sceneId: battle, playerId: p.id, campaignId: cid, ...heavy })
        .onConflictDoUpdate({ target: [fogExplored.sceneId, fogExplored.playerId], set: heavy })
        .run();
    }
  }, 60_000);
  afterAll(() => b.cleanup());

  test("CON-44 FOG §12 heavy (#208): DM < 1 MiB with the active scene's fog row only and no view-as rows; players < 512 KiB", () => {
    const sizes = snapshotSizes(b.s);
    const [dm, ...players] = sizes;
    const fog = dm?.types[FOG_TYPE];
    expect(fog?.rows).toBe(1);
    expect(fog?.bytes ?? Infinity).toBeLessThanOrEqual(FOG_ROW_MAX);
    expect(dm?.types[VISION_TYPE]?.rows).toBe(0);
    expect(dm?.types[FOG_EXPLORED_TYPE]?.rows).toBe(0);
    expect(dm?.bytes ?? Infinity).toBeLessThan(SNAPSHOT_CEILING.dm);
    for (const p of players) {
      expect(p.types[FOG_TYPE]?.rows).toBe(1);
      expect(p.types[FOG_EXPLORED_TYPE]?.rows).toBe(1);
      expect(p.types[FOG_EXPLORED_TYPE]?.bytes ?? Infinity).toBeLessThanOrEqual(EXPLORED_MAX);
      expect(p.types[VISION_TYPE]?.bytes ?? Infinity).toBeLessThanOrEqual(VISION_MAX);
      expect(p.bytes).toBeLessThan(SNAPSHOT_CEILING.player);
    }
    const left = SNAPSHOT_CEILING.dm - (dm?.bytes ?? 0);
    console.log(
      `FOG CON-44 (V0): heavy DM ${dm?.bytes} B (fog 1 row ${fog?.bytes} B; ${left} B left of 1 MiB); players ${Math.min(...players.map((p) => p.bytes))}–${Math.max(...players.map((p) => p.bytes))} B (fog-explored ${players[0]?.types[FOG_EXPLORED_TYPE]?.bytes} B)`,
    );
  });

  test("FR-FOG-43 the View-as ack at caps (memory at the vertex cap) ≤ 128 KiB", () => {
    const db = b.s.db;
    const p = db.select().from(fogExplored).all()[0];
    if (!p) throw new Error("no memory row");
    db.update(fogExplored)
      .set({ shape: ringShape(EXPLORED_VERTICES_MAX) })
      .where(and(eq(fogExplored.sceneId, p.sceneId), eq(fogExplored.playerId, p.playerId)))
      .run();
    const dm = snapshotFrames(b.s)[0]?.viewer;
    if (!dm) throw new Error("no DM");
    const ack = b.s.records.loadViewAs(
      { db, presence: { list: () => [] } },
      dm,
      p.sceneId,
      p.playerId,
    );
    expect(ack[FOG_EXPLORED_TYPE]).toHaveLength(1);
    const bytes = Buffer.byteLength(JSON.stringify({ records: ack }), "utf8");
    expect(bytes).toBeLessThanOrEqual(VIEW_AS_ACK_MAX);
    console.log(`FOG CON-44 (V0): View-as ack with memory at the vertex cap ${bytes} B`);
  });

  test("FR-FOG-25 heavy: the revealed battle scene's tokens reach every player; no player token row is fogged unless owned", () => {
    const frames = snapshotFrames(b.s);
    for (const f of frames) {
      const tokens = (f.records[TOKEN_TYPE] ?? []) as { fogged?: boolean }[];
      expect(tokens).toHaveLength(HEAVY.activeSceneTokens);
      expect(tokens.filter((t) => t.fogged === true)).toEqual([]);
    }
  });

  test("FR-FOG-02 heavy: tokens on the new (fogged) scenes carry `fogged: true` in the DB", () => {
    const n = (sql: string) => b.s.db.$client.query<{ n: number }, []>(sql).get()?.n ?? Number.NaN;
    const fogged = n("SELECT count(*) AS n FROM token WHERE fogged = 1");
    expect(fogged).toBeGreaterThan(HEAVY.tokens / 2);
    expect(fogged).toBeLessThan(HEAVY.tokens - HEAVY.activeSceneTokens + 1);
  });
  // Last: it adds tokens and walls to the heavy campaign.
  test("CON-44 V2 (FOG §12, #208): real sight at caps (4 sources, r 24, 300 walls): the player's `vision` ≤ 48 KiB, the View-as ack ≤ 48 KiB, DM / players under the ceilings", () => {
    const db = b.s.db;
    const cid = db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
    const battle = db
      .select()
      .from(scene)
      .where(and(eq(scene.campaignId, cid), eq(scene.active, true)))
      .get() as typeof scene.$inferSelect;
    const pc = db
      .select()
      .from(entity)
      .all()
      .find((e) => e.campaignId === cid && e.kind === "character" && e.ownerPlayerId !== null);
    if (!pc) throw new Error("no character");
    const owner = pc.ownerPlayerId as string;
    const dmActor = { role: "dm" as const, playerId: null, campaignId: cid };
    const run = (name: string, input: unknown) => b.s.commands.run(name, input, { actor: dmActor });
    // Senses at the cap: see r 12, dark r 24 (FR-FOG-32).
    db.update(entity)
      .set({
        statBlock: {
          ...(pc.statBlock as object),
          senses: { visionFt: 60, darkvisionFt: 120, seesMagicalDarkness: true },
        },
      })
      .where(eq(entity.id, pc.id))
      .run();
    // 300 short walls within r 24 of the sources (seeded).
    let seed = 7;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const walls = Array.from({ length: 300 }, (_, i) => {
      const x = r2(rnd() * 20);
      const y = r2(rnd() * 14);
      return [i + 1, x, y, r2(x + 0.5 + rnd() * 2), r2(y + rnd() * 2 - 1)] as [
        number,
        number,
        number,
        number,
        number,
      ];
    });
    db.delete(sceneStructure).where(eq(sceneStructure.sceneId, battle.id)).run();
    db.insert(sceneStructure)
      .values({
        sceneId: battle.id,
        campaignId: cid,
        rev: 1,
        nextN: 301,
        walls,
        doors: [],
        doorSeen: {},
        updatedAt: AT,
      })
      .run();
    const ids = [
      [8, 6],
      [10, 6],
      [8, 8],
      [10, 8],
    ].map(
      ([col, row]) =>
        (
          run(MAP_INTENTS.placeToken, {
            sceneId: battle.id,
            definitionId: pc.id,
            col,
            row,
            ownerPlayerId: owner,
          }) as { tokenId: string }
        ).tokenId,
    );
    const sizes = snapshotSizes(b.s);
    const [dm, ...players] = sizes;
    expect(dm?.bytes ?? Infinity).toBeLessThan(SNAPSHOT_CEILING.dm);
    const frames = snapshotFrames(b.s);
    const label = frames.find((f) => f.viewer.playerId === owner)?.label;
    const mine = players.find((p) => p.label === label);
    expect(mine?.types[VISION_TYPE]?.rows).toBe(1);
    const visionBytes = mine?.types[VISION_TYPE]?.bytes ?? Infinity;
    expect(visionBytes).toBeLessThanOrEqual(VISION_MAX);
    for (const p of players) expect(p.bytes).toBeLessThan(SNAPSHOT_CEILING.player);
    // The View-as ack with that player's memory at the vertex cap.
    db.update(fogExplored)
      .set({ shape: ringShape(EXPLORED_VERTICES_MAX) })
      .where(and(eq(fogExplored.sceneId, battle.id), eq(fogExplored.playerId, owner)))
      .run();
    const dmViewer = frames[0]?.viewer;
    if (!dmViewer) throw new Error("no DM");
    const ack = b.s.records.loadViewAs(
      { db, presence: { list: () => [] } },
      dmViewer,
      battle.id,
      owner,
    );
    expect(ack[VISION_TYPE]).toHaveLength(1);
    const ackBytes = Buffer.byteLength(JSON.stringify({ records: ack }), "utf8");
    expect(ackBytes).toBeLessThanOrEqual(VIEW_AS_ACK_MAX);
    // A source move at these caps (server: derive, write, re-derive, memory, log), median of 5.
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      run(MAP_INTENTS.moveToken, { tokenId: ids[0], col: 7 + (i % 2), row: 5 });
      times.push(performance.now() - t0);
    }
    times.sort((a, z) => a - z);
    console.log(
      `FOG CON-44 (V2): heavy DM ${dm?.bytes} B; players ≤ ${Math.max(...players.map((p) => p.bytes))} B; vision at 4 sources r 24 / 300 walls ${visionBytes} B; View-as ack ${ackBytes} B; a source move (server) median ${times[2]?.toFixed(1)} ms`,
    );
  });
});
