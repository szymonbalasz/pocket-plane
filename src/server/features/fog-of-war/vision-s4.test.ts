// FOG §13 sprint-4 server rows (V6) on the `vision` bundle with in-process services (Goblin Ambush
// active): FR-FOG-32 default (Normal 999 ft bounded by the map), FR-FOG-38 cache keys (map
// rectangle, party flag), FR-FOG-52 party source cap, recalibration re-derive (review A8) and
// the one-time vision-model upgrade (FR-FOG-40, review A4).
import { afterEach, describe, expect, test } from "bun:test";
import { type VisionServices, visionServices } from "@fixtures/units/fog-of-war/vision-harness";
import { VISION_TYPE, type VisionRecord } from "@shared/fog-of-war/schemas";
import { MAP_INTENTS as I } from "@shared/scenes-map/schemas";
import { eq, inArray, isNull } from "drizzle-orm";
import { realContext } from "../../commands/context";
import { VISION_MODEL, VISION_MODEL_KEY } from "../../db/meta";
import { asset, dbMeta, fogSettings, scene, sceneFog, token } from "../../db/schema";
import { type Logger, silentLogger } from "../../log";
import { addAsset } from "../scenes-map/testing";
import { campaignPlayers, loadSceneSight } from "./derive";
import { rederiveScene } from "./rederive";
import { PARTY_SOURCES_MAX, sceneSources, setFogLogger, sightsComputed } from "./sight";
import { upgradeVisionModel, visionModelOf } from "./upgrade";
import { clearVisionCache } from "./vision-cache";

const opened: VisionServices[] = [];
async function setup(bundle?: string) {
  const t = await visionServices(bundle);
  opened.push(t);
  return t;
}
afterEach(() => {
  for (const t of opened.splice(0)) t.stop();
});

const pts = (p: readonly number[]) => {
  const out: [number, number][] = [];
  for (let i = 0; i < p.length; i += 2) out.push([p[i] as number, p[i + 1] as number]);
  return out;
};

/** Each player's `vision` in a fresh player snapshot (the cache cleared first: a restart). */
function freshVision(t: VisionServices, w: "p1" | "p2", restart = false) {
  if (restart) clearVisionCache();
  return (t.snapshot(w)[VISION_TYPE] as VisionRecord[]).find((v) => v.playerId === t.pid[w]);
}

describe("FR-FOG-32 default (server)", () => {
  test("FR-FOG-32 default: Mira set to Normal → one `see` polygon ending at walls, closed doors and the map's edges (walk step 30)", async () => {
    const t = await setup();
    t.run("char.edit", {
      creatureId: t.charId("Mira"),
      set: { senses: { darkvisionFt: 0, seesMagicalDarkness: false } },
    });
    const v = freshVision(t, "p1") as VisionRecord;
    expect(v.see).toHaveLength(1);
    expect(v.dark).toEqual([]);
    expect(v.src).toEqual([t.tokenRow("Mira").id]);
    const poly = v.see[0] as number[];
    const xs = pts(poly).map((p) => p[0]);
    const ys = pts(poly).map((p) => p[1]);
    // Bounded by the 20 × 14 map: vertices on x = 0, y = 0, y = 14; none farther; cut at x = 8
    // except through the closed doors' absence (d1, d2 closed in `scn-walls`).
    expect(Math.min(...xs)).toBe(0);
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(14);
    expect(Math.max(...xs)).toBeLessThanOrEqual(8);
    // Back at 30 ft: the sprint-3 polygon again (radius 6).
    t.run("char.edit", {
      creatureId: t.charId("Mira"),
      set: { senses: { visionFt: 30, darkvisionFt: 0, seesMagicalDarkness: false } },
    });
    const back = freshVision(t, "p1") as VisionRecord;
    for (const [x, y] of pts(back.see[0] as number[])) {
      expect(Math.hypot(x - 2.5, y - 7.5)).toBeLessThanOrEqual(6.01);
    }
  });
});

describe("FR-FOG-38 cache keys (sprint 4)", () => {
  test("FR-FOG-38 cache keys: the map rectangle and the party flag each invalidate; the same inputs hit", async () => {
    const t = await setup();
    clearVisionCache();
    loadSceneSight(t.db, t.ambushId);
    const n0 = sightsComputed();
    loadSceneSight(t.db, t.ambushId);
    expect(sightsComputed()).toBe(n0);
    // Map rectangle: a bigger image (written directly: the key alone must miss).
    t.db.update(scene).set({ mapWidth: 1470 }).where(eq(scene.id, t.ambushId)).run();
    loadSceneSight(t.db, t.ambushId);
    const n1 = sightsComputed();
    expect(n1).toBeGreaterThan(n0);
    for (const set of [{ gridOffsetX: 7 }, { gridCellSize: 75 }, { mapHeight: 1050 }]) {
      const before = sightsComputed();
      t.db.update(scene).set(set).where(eq(scene.id, t.ambushId)).run();
      loadSceneSight(t.db, t.ambushId);
      expect(sightsComputed()).toBeGreaterThan(before);
    }
    // Party flag.
    const before = sightsComputed();
    t.db
      .insert(fogSettings)
      .values({ campaignId: t.campaignId, partyVision: true, updatedAt: "2026-01-01T00:00:00Z" })
      .run();
    loadSceneSight(t.db, t.ambushId);
    expect(sightsComputed()).toBeGreaterThan(before);
  });
});

describe("FR-FOG-52 party source cap", () => {
  test("FR-FOG-52 6 players × 3 sources with party vision on → 12 count, round robin in campaign order; the rest ignored with a warn", async () => {
    const t = await setup();
    const warns: string[] = [];
    const log: Logger = { ...silentLogger, warn: (m) => warns.push(m) };
    setFogLogger(log);
    for (let i = 3; i <= 6; i++) t.run("player.add", { name: `Player ${i}` });
    const players = campaignPlayers(t.db, t.campaignId);
    expect(players).toHaveLength(6);
    // Remove the bundle's owned tokens, then 3 tokens per player (owned Goblins), oldest first.
    t.db.delete(token).where(eq(token.sceneId, t.ambushId)).run();
    const goblin = t.db.select().from(token).all()[0]?.definitionId ?? t.tokenRow("Mira").id;
    const def = t.db
      .select({ id: token.definitionId })
      .from(token)
      .where(isNull(token.ownerPlayerId))
      .get()?.id as string;
    expect(def ?? goblin).toBeDefined();
    let col = 0;
    for (let round = 0; round < 3; round++) {
      for (const p of players) {
        t.run(I.placeToken, {
          sceneId: t.ambushId,
          definitionId: def,
          col: col % 7,
          row: Math.floor(col / 7) + 2,
          ownerPlayerId: p,
        });
        col++;
      }
    }
    const off = sceneSources(t.db, t.ambushId, players, false);
    expect([...off.values()].map((l) => l.length)).toEqual([3, 3, 3, 3, 3, 3]);
    warns.length = 0;
    const on = sceneSources(t.db, t.ambushId, players, true);
    expect([...on.values()].map((l) => l.length)).toEqual([2, 2, 2, 2, 2, 2]);
    expect([...on.values()].flat()).toHaveLength(PARTY_SOURCES_MAX);
    // Round robin: each player's first two by `seq`.
    for (const p of players) {
      expect(on.get(p)?.map((s) => s.tokenId)).toEqual(
        off
          .get(p)
          ?.slice(0, 2)
          .map((s) => s.tokenId),
      );
    }
    expect(warns).toHaveLength(6);
    expect(warns[0]).toContain("party vision has more than 12 sources");
    setFogLogger(silentLogger);
  });
});

describe("Recalibration (review A8)", () => {
  test("FR-FOG-33 / -38 map.setGrid / map.setSceneMap re-derive the scene: each player's `vision` equals a fresh snapshot's, before and after a restart", async () => {
    const t = await setup();
    t.run("char.edit", {
      creatureId: t.charId("Mira"),
      set: { senses: { darkvisionFt: 0, seesMagicalDarkness: false } },
    });
    const v0 = freshVision(t, "p1") as VisionRecord;
    t.run(I.setGrid, {
      sceneId: t.ambushId,
      cellSize: 70,
      offsetX: 35,
      offsetY: 0,
      visible: true,
      color: "#000000",
      opacity: 0.5,
    });
    const ev = t.last();
    expect(ev?.type).toBe("SceneUpdated");
    const live = ev?.changes.find((c) => c.type === VISION_TYPE && c.id === v0.id);
    const after = live?.after as VisionRecord & { campaignId?: string; shared?: boolean };
    expect(after).toBeDefined();
    const fresh = freshVision(t, "p1") as VisionRecord;
    const { campaignId: _c, shared: _s, ...wire } = after;
    expect(wire).toEqual(fresh);
    // The west edge moved to x = -0.5.
    expect(Math.min(...pts(fresh.see[0] as number[]).map((p) => p[0]))).toBe(-0.5);
    expect(freshVision(t, "p1", true)).toEqual(fresh);
    // A new map image (shorter: the south edge moves to y = 10): re-derived in `SceneUpdated`.
    addAsset(t.s as never, "map-short", t.campaignId, { w: 1400, h: 700 });
    expect(t.db.select().from(asset).where(eq(asset.id, "map-short")).get()).toBeDefined();
    t.run(I.setSceneMap, { sceneId: t.ambushId, mapAssetId: "map-short" });
    expect(t.last()?.changes.some((c) => c.type === VISION_TYPE)).toBe(true);
    const wide = freshVision(t, "p1") as VisionRecord;
    expect(wide).toEqual(freshVision(t, "p1", true) as VisionRecord);
  });
});

describe("FR-FOG-40 vision-model upgrade (review A4)", () => {
  test("FR-FOG-40 vision-model upgrade: a sprint-3-model DB → boot step → per-player snapshots equal a fresh derive; prep scenes stale; rerun no-op", async () => {
    const t = await setup();
    // A fresh DB is stamped with the current model.
    expect(visionModelOf(t.db)).toBe(VISION_MODEL);
    // The expected state: a fresh full derive of the active scene (memory grows with it).
    const actor = { role: "system" as const, playerId: null, campaignId: null };
    t.db.transaction((tx) => {
      rederiveScene({ tx, ctx: realContext(t.s.clock), actor }, t.ambushId);
    });
    const expected = { p1: t.snapshot("p1"), p2: t.snapshot("p2") };
    // Sprint 3's copies: monsters seen by nobody (senses absent meant no sight), no version row.
    const ambushTokens = t.db
      .select({ id: token.id })
      .from(token)
      .where(eq(token.sceneId, t.ambushId))
      .all()
      .map((r) => r.id);
    t.db
      .update(token)
      .set({ seenBy: [], fogged: true })
      .where(inArray(token.id, ambushTokens))
      .run();
    t.db.delete(dbMeta).where(eq(dbMeta.key, VISION_MODEL_KEY)).run();
    clearVisionCache();
    expect(visionModelOf(t.db)).toBe(1);
    expect(t.snapshot("p1")).not.toEqual(expected.p1);
    const n = upgradeVisionModel(t.db, realContext(t.s.clock));
    expect(n).toBeGreaterThan(0);
    expect(visionModelOf(t.db)).toBe(VISION_MODEL);
    expect(t.snapshot("p1")).toEqual(expected.p1);
    expect(t.snapshot("p2")).toEqual(expected.p2);
    // Every other scene with a fog row is stale (re-derived at activation, FR-FOG-35).
    const rows = t.db.select().from(sceneFog).all();
    for (const r of rows) expect(r.visionStale).toBe(r.sceneId !== t.ambushId);
    // Rerun: nothing.
    expect(upgradeVisionModel(t.db, realContext(t.s.clock))).toBe(0);
  });
});
