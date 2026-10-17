// FOG §12 / §13 sprint-4 CON-44 (V6) on the realistic-heavy harness: 6 PCs at Normal 999 ft
// (senses absent) on the active battle scene, party vision off and on; then caps (2,000 random
// walls on a 120 × 120 map, every source at its own origin) with 12 and 24 sources on the scene
// (12 count, FR-FOG-52). Bounds: DM < 1 MiB, players < 512 KiB (#208, never raised); a player's
// own `vision` ≤ 48 KiB; a player's whole `vision` type (own + shared) ≤ 192 KiB; the View as
// Party ack at caps (12 sources + 6 memory rows at the run cap) ≤ 192 KiB. Figures logged.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import { encodeRuns } from "@shared/fog-of-war/mask";
import {
  FOG_INTENTS as F,
  FOG_EXPLORED_TYPE,
  FOG_RUNS_MAX,
  FOG_SETTINGS_TYPE,
  VISION_TYPE,
  type VisionRecord,
} from "@shared/fog-of-war/schemas";
import { VIEW_AS_PARTY } from "@shared/protocol/scene-window";
import { MAP_INTENTS } from "@shared/scenes-map/schemas";
import { and, eq } from "drizzle-orm";
import {
  campaign,
  entity,
  fogExplored,
  player,
  scene,
  sceneStructure,
  token,
} from "../../db/schema";
import { SNAPSHOT_CEILING } from "../../ws/hub";
import {
  buildRealisticHeavy,
  servicesFromBundle,
  snapshotFrames,
  snapshotSizes,
} from "../../ws/testing/snapshot-size";

const OWN_VISION_MAX = 48 * 1024;
const VISION_TYPE_MAX = 192 * 1024;
const PARTY_ACK_MAX = 192 * 1024;
const AT = "2026-01-01T00:00:00.000Z";

/** One player's own `vision` bytes in a snapshot frame. */
function ownVisionBytes(records: Record<string, unknown[]>, playerId: string | null): number {
  const own = (records[VISION_TYPE] ?? []).find((v) => (v as VisionRecord).playerId === playerId);
  return own ? Buffer.byteLength(JSON.stringify(own), "utf8") : 0;
}

describe("CON-44 sprint 4 (FOG §12, #208): 999 ft default and party vision", () => {
  let b: Awaited<ReturnType<typeof servicesFromBundle>>;
  let cid: string;
  let battle: typeof scene.$inferSelect;
  const dmActor = () => ({ role: "dm" as const, playerId: null, campaignId: cid });
  const run = (name: string, input: unknown) => b.s.commands.run(name, input, { actor: dmActor() });
  beforeAll(async () => {
    b = await servicesFromBundle(await loadBundle("session-sim", { testMode: true }));
    buildRealisticHeavy(b.s);
    const db = b.s.db;
    cid = db.select().from(campaign).where(eq(campaign.active, true)).get()?.id as string;
    battle = db
      .select()
      .from(scene)
      .where(and(eq(scene.campaignId, cid), eq(scene.active, true)))
      .get() as typeof scene.$inferSelect;
  }, 60_000);
  afterAll(() => b.cleanup());

  /** Sizes + the largest own / whole `vision` per player. */
  function measure() {
    const sizes = snapshotSizes(b.s);
    const frames = snapshotFrames(b.s);
    const [dm, ...players] = sizes;
    const own = frames
      .filter((f) => f.viewer.role === "player")
      .map((f) => ownVisionBytes(f.records, f.viewer.playerId));
    const whole = players.map((p) => p.types[VISION_TYPE]?.bytes ?? 0);
    return {
      dm: dm?.bytes ?? Number.POSITIVE_INFINITY,
      min: Math.min(...players.map((p) => p.bytes)),
      max: Math.max(...players.map((p) => p.bytes)),
      own: Math.max(...own),
      whole: Math.max(...whole),
      players,
    };
  }

  test("CON-44 heavy, 999 ft default: party off and on, DM < 1 MiB, players < 512 KiB; own `vision` ≤ 48 KiB, the `vision` type ≤ 192 KiB", () => {
    const off = measure();
    expect(off.dm).toBeLessThan(SNAPSHOT_CEILING.dm);
    expect(off.max).toBeLessThan(SNAPSHOT_CEILING.player);
    expect(off.own).toBeLessThanOrEqual(OWN_VISION_MAX);
    expect(off.own).toBeGreaterThan(0);
    run(F.setPartyVision, { on: true });
    const on = measure();
    expect(on.dm).toBeLessThan(SNAPSHOT_CEILING.dm);
    expect(on.max).toBeLessThan(SNAPSHOT_CEILING.player);
    expect(on.whole).toBeLessThanOrEqual(VISION_TYPE_MAX);
    for (const p of on.players) expect(p.types[FOG_SETTINGS_TYPE]?.rows).toBe(1);
    console.log(
      `FOG CON-44 (V6): heavy DM ${off.dm} B (party on ${on.dm} B; ${SNAPSHOT_CEILING.dm - on.dm} B left of 1 MiB); players party off ${off.min}–${off.max} B, own vision ≤ ${off.own} B; party on ${on.min}–${on.max} B (+${on.max - off.max}), vision type ≤ ${on.whole} B; ${SNAPSHOT_CEILING.player - on.max} B left of 512 KiB`,
    );
    run(F.setPartyVision, { on: false });
  });

  // Last: it rebuilds the battle scene at caps.
  test("CON-44 caps (2,000 walls on 120 × 120, own origins): 12 and 24 sources with party vision on → players < 512 KiB, the `vision` type ≤ 192 KiB; own `vision` at 4 sources ≤ 48 KiB; View as Party ack ≤ 192 KiB", () => {
    const db = b.s.db;
    const cs = battle.gridCellSize;
    db.update(scene)
      .set({
        mapWidth: Math.round(120 * cs),
        mapHeight: Math.round(120 * cs),
        gridOffsetX: 0,
        gridOffsetY: 0,
      })
      .where(eq(scene.id, battle.id))
      .run();
    let seed = 11;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const walls = Array.from({ length: 2000 }, (_, i) => {
      const x = r2(rnd() * 120);
      const y = r2(rnd() * 120);
      const a = rnd() * 2 * Math.PI;
      const len = 0.5 + rnd() * 1.5;
      return [i + 1, x, y, r2(x + len * Math.cos(a)), r2(y + len * Math.sin(a))] as [
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
        nextN: 2001,
        walls,
        doors: [],
        doorSeen: {},
        updatedAt: AT,
      })
      .run();
    // The PCs' tokens off the battle scene; 4 sources per player at their own origins.
    db.delete(token)
      .where(and(eq(token.sceneId, battle.id), eq(token.hidden, false)))
      .run();
    const players = db.select().from(player).where(eq(player.campaignId, cid)).all();
    const pcOf = (p: string) =>
      db
        .select()
        .from(entity)
        .all()
        .find((e) => e.ownerPlayerId === p && e.kind === "character")?.id as string;
    const placed: string[][] = players.map(() => []);
    const place = (round: number) => {
      players.forEach((p, i) => {
        const r = run(MAP_INTENTS.placeToken, {
          sceneId: battle.id,
          definitionId: pcOf(p.id),
          col: 5 + Math.floor(rnd() * 110),
          row: 5 + Math.floor(rnd() * 110),
          ownerPlayerId: p.id,
        }) as { tokenId: string };
        placed[i]?.push(r.tokenId);
        expect(round).toBeGreaterThanOrEqual(0);
      });
    };
    place(0);
    place(1);
    run(F.setPartyVision, { on: true });
    const twelve = measure();
    place(2);
    place(3);
    const twentyFour = measure();
    for (const m of [twelve, twentyFour]) {
      expect(m.dm).toBeLessThan(SNAPSHOT_CEILING.dm);
      expect(m.max).toBeLessThan(SNAPSHOT_CEILING.player);
      expect(m.whole).toBeLessThanOrEqual(VISION_TYPE_MAX);
    }
    // Own record at 4 caps sources, party off (each player's own ≤ 4).
    run(F.setPartyVision, { on: false });
    const own = measure();
    expect(own.own).toBeLessThanOrEqual(OWN_VISION_MAX);
    // View as Party: 12 sources + every player's memory at the run cap.
    run(F.setPartyVision, { on: true });
    const cells = 120 * 120;
    const a = new Uint8Array(cells);
    const step = Math.max(1, Math.floor(cells / FOG_RUNS_MAX));
    for (let i = 0; i < cells; i++) a[i] = Math.floor(i / step) % 2;
    const runs = encodeRuns(a, "fog");
    for (const p of players) {
      db.insert(fogExplored)
        .values({
          sceneId: battle.id,
          playerId: p.id,
          campaignId: cid,
          col0: 0,
          row0: 0,
          cols: 120,
          rows: 120,
          runs,
          updatedAt: AT,
        })
        .onConflictDoUpdate({
          target: [fogExplored.sceneId, fogExplored.playerId],
          set: { cols: 120, rows: 120, runs },
        })
        .run();
    }
    const dmViewer = snapshotFrames(b.s)[0]?.viewer;
    if (!dmViewer) throw new Error("no DM");
    const ack = b.s.records.loadViewAs(
      { db, presence: { list: () => [] } },
      dmViewer,
      battle.id,
      VIEW_AS_PARTY,
    );
    expect(ack[VISION_TYPE]).toHaveLength(players.length);
    expect(ack[FOG_EXPLORED_TYPE]).toHaveLength(players.length);
    const ackBytes = Buffer.byteLength(JSON.stringify({ records: ack }), "utf8");
    expect(ackBytes).toBeLessThanOrEqual(PARTY_ACK_MAX);
    console.log(
      `FOG CON-44 (V6 caps): party on, 12 sources: players ${twelve.min}–${twelve.max} B, vision type ≤ ${twelve.whole} B; 24 on the scene (12 count): ${twentyFour.min}–${twentyFour.max} B, vision type ≤ ${twentyFour.whole} B; own vision at 4 sources (party off) ≤ ${own.own} B; View as Party ack ${ackBytes} B; DM ≤ ${Math.max(twelve.dm, twentyFour.dm)} B`,
    );
  }, 60_000);
});
