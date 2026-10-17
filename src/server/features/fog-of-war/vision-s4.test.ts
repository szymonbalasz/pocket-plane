// FOG §13 sprint-4 server rows (V6) on the `vision` bundle with in-process services (Goblin Ambush
// active): FR-FOG-32 default (Normal 999 ft bounded by the map), FR-FOG-38 cache keys (map
// rectangle, party flag), FR-FOG-52 party source cap, recalibration re-derive (review A8) and
// the one-time vision-model upgrade (FR-FOG-40, review A4).
import { afterEach, describe, expect, test } from "bun:test";
import {
  explores,
  type VisionServices,
  visionServices,
} from "@fixtures/units/fog-of-war/vision-harness";
import {
  FOG_INTENTS as F,
  FOG_SETTINGS_TYPE,
  VISION_TYPE,
  type VisionRecord,
} from "@shared/fog-of-war/schemas";
import { MAP_INTENTS as I, TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { eq, inArray, isNull } from "drizzle-orm";
import { realContext } from "../../commands/context";
import { armCrashHook } from "../../commands/crash";
import { stateDigest } from "../../db/digest";
import { VISION_MODEL, VISION_MODEL_KEY } from "../../db/meta";
import { asset, dbMeta, fogExplored, fogSettings, scene, sceneFog, token } from "../../db/schema";
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
  armCrashHook(null);
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

describe("FR-FOG-49 party vision switch (in-process)", () => {
  test("FR-FOG-49 setPartyVision: one transaction = row + active-scene re-derive + visionStale elsewhere + one logged PartyVisionSet; same value → no event", async () => {
    const t = await setup("vision-party");
    const n = t.events.length;
    t.run(F.setPartyVision, { on: true });
    expect(t.events.length).toBe(n + 1);
    const ev = t.last();
    expect(ev?.type).toBe("PartyVisionSet");
    expect(ev?.payload).toEqual({ on: true });
    expect(ev?.changes[0]).toMatchObject({
      type: FOG_SETTINGS_TYPE,
      before: { partyVision: false },
      after: { partyVision: true },
    });
    // Every player's `vision` is listed with its new `shared` flag.
    const visions = (ev?.changes ?? []).filter((c) => c.type === VISION_TYPE);
    expect(visions.map((c) => (c.after as { shared: boolean }).shared)).toEqual([true, true]);
    expect(visions.map((c) => (c.before as { shared: boolean }).shared)).toEqual([false, false]);
    for (const r of t.db.select().from(sceneFog).all()) {
      expect(r.visionStale).toBe(r.sceneId !== t.ambushId);
    }
    t.run(F.setPartyVision, { on: true });
    expect(t.events.length).toBe(n + 1);
    expect(() => t.run(F.setPartyVision, { on: false }, t.actor("p1"))).toThrow();
  });

  test("FR-FOG-49 PP_TEST_CRASH fog.setPartyVision:before-commit → digest and per-player snapshots unchanged; :after-commit → as switched after a restart", async () => {
    const t = await setup("vision-party");
    const kill = () => {
      throw new Error("killed");
    };
    const snaps = () => JSON.stringify([t.snapshot("p1"), t.snapshot("p2"), t.snapshot("dm")]);
    const digest = () => stateDigest(t.db.$client).sha256;
    const d0 = digest();
    const s0 = snaps();
    armCrashHook({ point: "before-commit", target: F.setPartyVision }, kill);
    expect(() => t.run(F.setPartyVision, { on: true })).toThrow();
    armCrashHook(null);
    clearVisionCache();
    expect(digest()).toBe(d0);
    expect(snaps()).toBe(s0);
    armCrashHook({ point: "after-commit", target: F.setPartyVision }, kill);
    expect(() => t.run(F.setPartyVision, { on: true })).toThrow();
    armCrashHook(null);
    const d1 = digest();
    const s1 = snaps();
    expect(d1).not.toBe(d0);
    clearVisionCache();
    expect(digest()).toBe(d1);
    expect(snaps()).toBe(s1);
    // Switched: each player holds the other's `vision`.
    expect((t.snapshot("p1")[VISION_TYPE] as unknown[]).length).toBe(2);
  });

  test("FR-FOG-50 party-blind: both players' sources in darkness without see-through → nobody but own tokens; one sees again → the party's sight", async () => {
    const t = await setup("vision-party");
    t.run(F.setPartyVision, { on: true });
    // Both PCs into the darkness [12.5, 9, 1.5]; Thorn without see-through.
    t.run("char.edit", {
      creatureId: t.charId("Thorn"),
      set: { senses: { visionFt: 0, darkvisionFt: 60, seesMagicalDarkness: false } },
    });
    t.run(I.moveToken, { tokenId: t.tokenRow("Mira").id, col: 12, row: 9 });
    t.run(I.moveToken, { tokenId: t.tokenRow("Thorn").id, col: 11, row: 9 });
    const names = (w: "p1" | "p2") =>
      (t.snapshot(w)[TOKEN_TYPE] as { name: string; sceneId: string }[])
        .filter((x) => x.sceneId === t.ambushId)
        .map((x) => x.name)
        .sort();
    expect(names("p1")).toEqual(["Mira"]);
    expect(names("p2")).toEqual(["Thorn"]);
    // Thorn sees through again: the whole party sees Thorn's sight (Goblin 2 too: Sees invisible).
    t.run("char.edit", {
      creatureId: t.charId("Thorn"),
      set: {
        senses: { visionFt: 0, darkvisionFt: 60, seesMagicalDarkness: true, seesInvisible: true },
      },
    });
    expect(names("p1")).toContain("Goblin 2");
    expect(names("p1")).toEqual(names("p2"));
    // Mira herself is blind (her `vision` says so) but keeps the party's sight (OQ-FOG-48).
    const own = (t.snapshot("p1")[VISION_TYPE] as VisionRecord[]).find(
      (v) => v.playerId === t.pid.p1,
    );
    expect(own?.blind).toBe(true);
  });
});

describe("FR-FOG-37 party memory (OQ-FOG-47)", () => {
  test("FR-FOG-37 party vision on: every row grows from the party's sight; a player added later starts from it; switching off keeps the rows", async () => {
    const t = await setup("vision-party");
    t.run(F.setPartyVision, { on: true });
    const row = (p: string) =>
      t.db
        .select()
        .from(fogExplored)
        .all()
        .find((r) => r.sceneId === t.ambushId && r.playerId === p);
    // Thorn's darkvision (r 12 from (2.5, 9.5)) holds cell (5, 12); the nook (1, 10) is in both.
    const cell = (p: string, col: number, r: number) => {
      const m = row(p);
      if (!m) return false;
      return explores({ box: [m.col0, m.row0, m.cols, m.rows], runs: m.runs } as never, col, r);
    };
    expect(cell(t.pid.p1, 5, 12)).toBe(true);
    expect(cell(t.pid.p2, 5, 12)).toBe(true);
    const added = t.run<{ id: string }>("player.add", { name: "Player 3" });
    expect(cell(added.id, 5, 12)).toBe(true);
    expect(cell(added.id, 1, 10)).toBe(true);
    t.run(F.setPartyVision, { on: false });
    expect(cell(added.id, 5, 12)).toBe(true);
  });
});
