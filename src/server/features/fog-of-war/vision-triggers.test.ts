// FR-FOG-35 re-derive triggers (FOG §6 table, one test per row), FR-FOG-37 memory (active scene
// only, cap), FR-FOG-38 vision cache (each key input, rollback), FR-FOG-39 `vision` changes, on
// the `vision` bundle with in-process services (Goblin Ambush active).
import { afterEach, describe, expect, test } from "bun:test";
import { type VisionServices, visionServices } from "@fixtures/units/fog-of-war/vision-harness";
import { uniformMask } from "@shared/fog-of-war/mask";
import { FOG_INTENTS as F, FOG_EXPLORED_TYPE, VISION_TYPE } from "@shared/fog-of-war/schemas";
import { SCN_INTENTS } from "@shared/scene-tools/schemas";
import { MAP_INTENTS as I } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { realContext } from "../../commands/context";
import { armCrashHook } from "../../commands/crash";
import { stateDigest } from "../../db/digest";
import { fogExplored, sceneFog, token } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { TokenPlacer } from "../combat-tracker/join";
import { resolveDefinition } from "../entities/commands";
import { MAP_REST as R } from "../scenes-map/commands";
import { readScene } from "../scenes-map/rows";
import { growMemory } from "./rederive";
import { sightsComputed } from "./sight";
import { clearVisionCache } from "./vision-cache";

const opened: VisionServices[] = [];
async function setup() {
  const t = await visionServices();
  opened.push(t);
  return t;
}
afterEach(() => {
  armCrashHook(null);
  for (const t of opened.splice(0)) t.stop();
});

const visionChanges = (t: VisionServices) =>
  (t.last()?.changes ?? []).filter((c) => c.type === VISION_TYPE);
const pair = (t: VisionServices, w: "p1" | "p2") => `${t.ambushId}:${t.pid[w]}`;
const seenBy = (t: VisionServices, name: string) => t.tokenRow(name).seenBy;
const stale = (t: VisionServices, sceneId: string) =>
  t.db.select().from(sceneFog).where(eq(sceneFog.sceneId, sceneId)).get()?.visionStale;

describe("FR-FOG-35 re-derive triggers", () => {
  test("FR-FOG-35 source moved: the mover's `vision` + memory only; the other player's nothing; a monster write re-derives only itself", async () => {
    const t = await setup();
    t.run(SCN_INTENTS.setDoor, { sceneId: t.ambushId, n: 4, state: 0 });
    t.run(I.moveToken, { tokenId: t.tokenRow("Mira").id, col: 7, row: 5 }, t.actor("p1"));
    expect(t.changesOf()).toContain("vision:p1");
    expect(t.changesOf()).toContain(`${FOG_EXPLORED_TYPE}:p1`);
    expect(t.changesOf()).not.toContain("vision:p2");
    expect(t.changesOf()).not.toContain(`${FOG_EXPLORED_TYPE}:p2`);
    expect(seenBy(t, "Goblin")).toEqual([t.pid.p1]);
    // Other subject written (DM moves the Goblin): that subject only.
    t.run(I.moveToken, { tokenId: t.tokenRow("Goblin").id, col: 12, row: 5 });
    expect(t.changesOf()).toEqual(["token:Goblin"]);
  });

  test("FR-FOG-35 source placed, duplicated, deleted: `vision` create / update / delete", async () => {
    const t = await setup();
    const thorn = t.tokenRow("Thorn");
    t.run(I.deleteToken, { tokenId: thorn.id });
    const del = visionChanges(t);
    expect(del.map((c) => [c.id, c.before !== null, c.after])).toEqual([
      [pair(t, "p2"), true, null],
    ]);
    // Placed again: a create for P2 (FR-FOG-39).
    t.run(I.placeToken, {
      sceneId: t.ambushId,
      definitionId: thorn.definitionId,
      col: 2,
      row: 9,
    });
    expect(visionChanges(t).map((c) => [c.id, c.before, c.after !== null])).toEqual([
      [pair(t, "p2"), null, true],
    ]);
    // Duplicate: a second source for P2 → one update.
    t.run(I.duplicateToken, { tokenId: t.tokenRow("Thorn").id });
    const dup = visionChanges(t);
    expect(dup.map((c) => c.id)).toEqual([pair(t, "p2")]);
    expect((dup[0]?.after as { dark: unknown[] } | undefined)?.dark).toHaveLength(2);
  });

  test("FR-FOG-35 source hidden / revealed, owner changed: old and new owner", async () => {
    const t = await setup();
    const mira = t.tokenRow("Mira");
    t.run(I.setTokenHidden, { tokenId: mira.id, hidden: true });
    expect(visionChanges(t).map((c) => [c.id, c.after])).toEqual([[pair(t, "p1"), null]]);
    t.run(I.setTokenHidden, { tokenId: mira.id, hidden: false });
    expect(visionChanges(t).map((c) => [c.id, c.before])).toEqual([[pair(t, "p1"), null]]);
    t.run(I.updateToken, { tokenId: mira.id, ownerPlayerId: t.pid.p2 });
    const moved = visionChanges(t);
    expect(moved.map((c) => [c.id, c.after === null])).toEqual([
      [pair(t, "p1"), true],
      [pair(t, "p2"), false],
    ]);
    expect((moved[1]?.after as { see: unknown[] } | undefined)?.see).toHaveLength(1);
  });

  test("FR-FOG-35 source resized (definition size): the re-derive joins EntityUpdated", async () => {
    const t = await setup();
    const id = t.charId("Mira");
    const def = t.s.db
      .select()
      .from(token)
      .where(eq(token.id, t.tokenRow("Mira").id))
      .get();
    expect(def?.size).toBe("medium");
    t.run("char.edit", { creatureId: id, set: { size: "large" } });
    expect(t.changesOf()).toContain("vision:p1");
    expect(t.tokenRow("Mira").size).toBe("large");
  });

  test("FR-FOG-35 / -45 Invisible set: that token only, no `vision` (not a source change)", async () => {
    const t = await setup();
    t.run(F.setInvisible, { tokenId: t.tokenRow("Mira").id, invisible: true });
    expect(t.changesOf()).toEqual(["token:Mira"]);
    t.run(F.setInvisible, { tokenId: t.tokenRow("Goblin").id, invisible: true });
    expect(t.changesOf()).toEqual(["token:Goblin"]);
    expect(t.tokenRow("Goblin")).toMatchObject({ fogged: true, seenBy: [], invisible: true });
  });

  test("FR-FOG-35 senses edit: active scene re-derived, the other scene with Mira's token → visionStale; activation re-derives it and clears the flag", async () => {
    const t = await setup();
    const town = t.sceneId("Town");
    t.run(I.placeToken, { sceneId: town, definitionId: t.charId("Mira"), col: 1, row: 1 });
    t.run(F.setAll, { sceneId: town, fogged: true });
    expect(stale(t, town)).toBe(false);
    t.run("char.edit", {
      creatureId: t.charId("Mira"),
      set: { senses: { visionFt: 60, darkvisionFt: 0, seesMagicalDarkness: false } },
    });
    expect(t.changesOf()).toContain("vision:p1");
    expect(stale(t, town)).toBe(true);
    expect(stale(t, t.ambushId)).toBe(false);
    const before = t.db
      .select()
      .from(token)
      .all()
      .filter((x) => x.sceneId === town && x.name === "Mira")[0]?.seenBy;
    t.run(I.activateScene, { sceneId: town });
    expect(t.last()?.type).toBe("SceneActivated");
    expect(stale(t, town)).toBe(false);
    expect(t.last()?.changes.some((c) => c.type === VISION_TYPE)).toBe(true);
    expect(before).toBeDefined();
    // Not stale → activation re-derives nothing (no fog subject change).
    t.run(I.activateScene, { sceneId: t.ambushId });
    expect(t.last()?.changes.filter((c) => c.type === "token")).toEqual([]);
  });

  test("FR-FOG-35 / OQ-FOG-39 player added: the active scene gains them, other scenes → visionStale", async () => {
    const t = await setup();
    const town = t.sceneId("Town");
    const added = t.run<{ id: string }>("player.add", { name: "Player 3" });
    expect(seenBy(t, "Mira")).toContain(added.id);
    expect(stale(t, town)).toBe(true);
    expect(stale(t, t.ambushId)).toBe(false);
  });

  test("FR-FOG-35 (#216) scene duplicated: the copy's subjects derived with its own sources, not stale; grid recalibration re-derives nothing", async () => {
    const t = await setup();
    t.run(SCN_INTENTS.setDoor, { sceneId: t.ambushId, n: 4, state: 0 });
    t.run(I.moveToken, { tokenId: t.tokenRow("Mira").id, col: 7, row: 5 });
    const copy = t.run<{ id: string }>(R.duplicateScene, { id: t.ambushId });
    const goblin = t.tokenRow("Goblin", copy.id);
    expect(goblin.seenBy).toEqual([t.pid.p1]);
    expect(goblin.fogged).toBe(false);
    expect(stale(t, copy.id)).toBe(false);
    // One change per record in the event (created rows carry the derived copies).
    const ids = (t.last()?.changes ?? []).map((c: RecordChange) => `${c.type}:${c.id}`);
    expect(new Set(ids).size).toBe(ids.length);
    // No explored memory on a non-active copy (FR-FOG-37).
    expect(
      t.db
        .select()
        .from(fogExplored)
        .all()
        .filter((r) => r.sceneId === copy.id),
    ).toEqual([]);
    const n = sightsComputed();
    t.run(I.setGrid, {
      sceneId: t.ambushId,
      cellSize: 70,
      offsetX: 10,
      offsetY: 0,
      visible: true,
      color: "#000000",
      opacity: 0.5,
    });
    expect((t.last()?.changes ?? []).map((c) => c.type)).toEqual(["scene"]);
    expect(sightsComputed()).toBe(n);
  });

  test("FR-FOG-35 (#216) combat placement (`TokenPlacer`, Start / Add): a placed source's re-derive rows follow its create", async () => {
    const t = await setup();
    t.run(I.deleteToken, { tokenId: t.tokenRow("Thorn").id });
    const changes = t.db.transaction((tx) => {
      const env = {
        tx,
        ctx: realContext(t.s.clock),
        actor: t.dmActor,
        emit: () => {},
      };
      const placer = new TokenPlacer(env, readScene(tx, t.ambushId), { col: 2, row: 9 });
      placer.place(resolveDefinition(env, t.charId("Thorn")), false);
      return placer.changes;
    });
    const thorn = t.tokenRow("Thorn");
    expect(changes[0]).toMatchObject({ type: "token", id: thorn.id, before: null });
    expect(changes.findIndex((c) => c.type === VISION_TYPE && c.id === pair(t, "p2"))).toBe(1);
  });
});

describe("BL-13 one change per record", () => {
  test("BL-13 Reveal all / Fog all / Undo with an encounter running: each combatant once in the event", async () => {
    const t = await setup();
    const enc = t.db.$client
      .query<{ id: string }, []>("SELECT id FROM encounter WHERE name = 'Ambush at the Ford'")
      .get();
    t.run("cbt.start", { encounterId: enc?.id, sceneId: t.ambushId });
    // No darkness: Reveal all flips both goblins (each flip runs the combat hooks).
    t.run(F.clearDarkness, { sceneId: t.ambushId });
    const unique = () => {
      const ids = (t.last()?.changes ?? []).map((c) => `${c.type}:${c.id}`);
      expect(ids.filter((x) => x.startsWith("combatant:")).length).toBeGreaterThan(0);
      expect(new Set(ids).size).toBe(ids.length);
    };
    t.run(F.setAll, { sceneId: t.ambushId, fogged: false });
    unique();
    t.run(F.setAll, { sceneId: t.ambushId, fogged: true });
    unique();
    const latest = t.db.$client
      .query<{ id: string }, [string]>(
        "SELECT id FROM scene_fog_edit WHERE scene_id = ? ORDER BY seq DESC LIMIT 1",
      )
      .get(t.ambushId);
    t.run(F.undo, { sceneId: t.ambushId, expectedEditId: latest?.id });
    unique();
  });
});

describe("FR-FOG-37 explored memory", () => {
  test("FR-FOG-37 a move on a non-active scene with Explored on writes `seenBy` and `vision` but no memory", async () => {
    const t = await setup();
    const town = t.sceneId("Town");
    t.run(I.activateScene, { sceneId: town });
    const rows = () => t.db.select().from(fogExplored).all().length;
    const n = rows();
    t.run(I.moveToken, { tokenId: t.tokenRow("Mira").id, col: 3, row: 7 });
    expect(t.changesOf()).toContain("vision:p1");
    expect(rows()).toBe(n);
  });

  test("FR-FOG-37 memory union never shrinks; over 2,000 runs it stops growing", () => {
    const box: [number, number, number, number] = [0, 0, 100, 100];
    const empty = uniformMask("clear", box);
    const square = [10, 10, 12, 10, 12, 12, 10, 12];
    const once = growMemory(empty, [square], box);
    expect(once).not.toBeNull();
    const twice = growMemory(once && "mask" in once ? once.mask : empty, [square], box);
    expect(twice).toBeNull(); // nothing new
    // A checkerboard: 5,000 runs → full.
    const board = uniformMask("clear", box);
    for (let i = 0; i < 5000; i++) board.cells[2 * i] = 1;
    expect(growMemory(board, [[50.2, 50.2, 52.8, 50.2, 52.8, 52.8, 50.2, 52.8]], box)).toEqual({
      full: true,
    });
  });
});

describe("FR-FOG-38 vision cache", () => {
  test("FR-FOG-38 a hit recomputes nothing; each key input (fog rev, structure rev, position, size, senses) misses", async () => {
    const t = await setup();
    const snap = () => t.snapshot("p1");
    snap();
    const n0 = sightsComputed();
    snap();
    expect(sightsComputed()).toBe(n0);
    const misses = (fn: () => void) => {
      const n = sightsComputed();
      fn();
      snap();
      return sightsComputed() > n;
    };
    expect(
      misses(() => t.run(F.placeDarkness, { sceneId: t.ambushId, shape: { circle: [18, 2, 1] } })),
    ).toBe(true);
    expect(misses(() => t.run(SCN_INTENTS.setDoor, { sceneId: t.ambushId, n: 4, state: 0 }))).toBe(
      true,
    );
    expect(
      misses(() => t.run(I.moveToken, { tokenId: t.tokenRow("Mira").id, col: 2, row: 8 })),
    ).toBe(true);
    expect(
      misses(() => t.run("char.edit", { creatureId: t.charId("Mira"), set: { size: "large" } })),
    ).toBe(true);
    expect(
      misses(() =>
        t.run("char.edit", {
          creatureId: t.charId("Mira"),
          set: { senses: { visionFt: 35, darkvisionFt: 0, seesMagicalDarkness: false } },
        }),
      ),
    ).toBe(true);
    // A write that changes no input: hit.
    expect(
      misses(() => t.run(I.updateToken, { tokenId: t.tokenRow("Mira").id, name: "Mira A" })),
    ).toBe(false);
  });

  test("FR-FOG-38 rollback then a same-rev edit → no stale hit (entries land only after commit)", async () => {
    const t = await setup();
    t.snapshot("p1");
    const kill = () => {
      throw new Error("killed");
    };
    // Rolled back: darkness on Mira's origin (she would be blind) at fog rev N + 1.
    armCrashHook({ point: "before-commit", target: F.placeDarkness }, kill);
    expect(() =>
      t.run(F.placeDarkness, { sceneId: t.ambushId, shape: { circle: [2.5, 7.5, 1] } }),
    ).toThrow();
    armCrashHook(null);
    // Committed at the same rev N + 1: darkness far away; Mira sees.
    t.run(F.placeDarkness, { sceneId: t.ambushId, shape: { circle: [18, 2, 1] } });
    const v = t.snapshot("p1")[VISION_TYPE]?.[0] as { blind: boolean; see: number[][] };
    expect(v.blind).toBe(false);
    expect(v.see).toHaveLength(1);
    clearVisionCache();
    expect(t.snapshot("p1")[VISION_TYPE]?.[0]).toEqual(v);
  });
});

describe("FOG §11 server crash mid-action", () => {
  test("FOG §11 PP_TEST_CRASH map.moveToken:after-commit / fog.placeDarkness:before-commit / fog.setInvisible:before-commit → digest as expected; restart → identical per-player snapshots", async () => {
    const t = await setup();
    const kill = () => {
      throw new Error("killed");
    };
    const snaps = () => JSON.stringify([t.snapshot("p1"), t.snapshot("p2"), t.snapshot("dm")]);
    const digest = () => stateDigest(t.db.$client).sha256;
    // before-commit: nothing changes.
    for (const [target, fn] of [
      [
        F.placeDarkness,
        () => t.run(F.placeDarkness, { sceneId: t.ambushId, shape: { circle: [2.5, 7.5, 1] } }),
      ],
      [
        F.setInvisible,
        () => t.run(F.setInvisible, { tokenId: t.tokenRow("Goblin").id, invisible: true }),
      ],
    ] as const) {
      const d = digest();
      const s = snaps();
      armCrashHook({ point: "before-commit", target }, kill);
      expect(fn).toThrow();
      armCrashHook(null);
      clearVisionCache();
      expect(digest()).toBe(d);
      expect(snaps()).toBe(s);
    }
    // after-commit: the move, its copies, memory and log row are all there.
    armCrashHook({ point: "after-commit", target: I.moveToken }, kill);
    expect(() =>
      t.run(I.moveToken, { tokenId: t.tokenRow("Mira").id, col: 3, row: 8 }, t.actor("p1")),
    ).toThrow();
    armCrashHook(null);
    const d = digest();
    const s = snaps();
    clearVisionCache();
    expect(t.tokenRow("Mira")).toMatchObject({ col: 3, row: 8 });
    expect(digest()).toBe(d);
    expect(snaps()).toBe(s);
  });
});
