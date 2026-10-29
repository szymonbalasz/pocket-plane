// FOG v2 editing commands (V1): darkness place / move / remove / clear (FR-FOG-28 / -30), one undo
// stack over fog shapes and darkness (FR-FOG-07, #207 G12), the Explored setting and Forget
// (FR-FOG-29 / -31), static derive with darkness (FR-FOG-34) and the static darkness filter
// (FR-FOG-44). Each command: rows + undo + log + one event, IDs from ctx, rollback → nothing.
import { afterEach, describe, expect, test } from "bun:test";
import { encodeRuns } from "@shared/fog-of-war/mask";
import { FOG_INTENTS as F, FOG_EXPLORED_TYPE, type FogRecord } from "@shared/fog-of-war/schemas";
import { DARKNESS_MAX } from "@shared/fog-of-war/shapes";
import { MAP_INTENTS as I, type SceneRecord } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { armCrashHook } from "../../commands/crash";
import { stateDigest } from "../../db/digest";
import { EXPLORED_DEFAULT, EXPLORED_DEFAULT_KEY } from "../../db/meta";
import { dbMeta, fogExplored, sceneFog, sceneFogEdit, token } from "../../db/schema";
import { readEventLog } from "../../events/log";
import { MAP_REST as R } from "../scenes-map/commands";
import { scenesSetup } from "../scenes-map/testing";
import { DARKNESS_NOT_FOUND, FOG_TOO_MANY_DARKNESS, fogUndoStack } from "./commands";
import { exploredDefaultOf, upgradeExploredDefault } from "./explored-default";
import { dmFogRecord, readFogRecord } from "./rows";

afterEach(() => armCrashHook(null));

const AT = "2026-01-01T00:00:00.000Z";

function setup() {
  const t = scenesSetup();
  // A new scene starts fully fogged (FR-FOG-02); 20 × 14 cells of 70 px.
  const ambush = t.run<SceneRecord>(R.createScene, {
    name: "Goblin Ambush",
    mapAssetId: "map-battle",
  });
  const place = (col: number, row: number, extra: Record<string, unknown> = {}) =>
    t.run<{ tokenId: string }>(I.placeToken, {
      sceneId: ambush.id,
      definitionId: t.h.goblinId,
      col,
      row,
      ...extra,
    }).tokenId;
  const tok = (id: string) => t.s.db.select().from(token).where(eq(token.id, id)).get();
  const fog = () => readFogRecord(t.s.db, ambush.id);
  const darkness = () => {
    const r = fog();
    return r ? dmFogRecord(r).darkness : [];
  };
  const cmd = <T = { editId: string | null }>(name: string, input: object, key?: string) =>
    t.run<T>(name, { sceneId: ambush.id, ...input }, t.h.dm, key);
  const place1 = (shape: object, key?: string) =>
    cmd<{ darknessId: string; editId: string }>(F.placeDarkness, { shape }, key);
  const edit = (op: string, shape: object) => cmd(F.edit, { op, shape }).editId as string;
  const undo = () => cmd(F.undo, { expectedEditId: fog()?.undo?.editId });
  const stack = () => fogUndoStack(t.s.db, ambush.id);
  const lastEvent = () => t.events.at(-1)?.event;
  return { ...t, ambush, place, tok, fog, darkness, cmd, place1, edit, undo, stack, lastEvent };
}

describe("FR-FOG-30 darkness intents", () => {
  test("FR-FOG-30 place: id from ctx, row + undo entry + log + one DarknessPlaced; any scene (prep)", () => {
    const t = setup();
    const log = readEventLog(t.s.db).length;
    const n = t.events.length;
    const a = t.place1({ circle: [12.5, 9, 1.5] }, "fog-v1-place");
    const b = t.place1({ circle: [12.5, 9, 1.5] });
    expect(a.darknessId).not.toBe(b.darknessId);
    // Same seed key → same ids (ctx.ids, ADR-0022): re-run on a fresh setup.
    const again = setup().place1({ circle: [12.5, 9, 1.5] }, "fog-v1-place");
    expect(again.darknessId).toBe(a.darknessId);
    expect(t.darkness()).toEqual([
      { id: a.darknessId, circle: [12.5, 9, 1.5] },
      { id: b.darknessId, circle: [12.5, 9, 1.5] },
    ]);
    expect(t.fog()?.undo).toEqual({ n: 2, editId: b.editId, kind: "darkness-place" });
    expect(t.events.length).toBe(n + 2);
    expect(t.lastEvent()).toMatchObject({
      type: "DarknessPlaced",
      payload: { sceneId: t.ambush.id, editId: b.editId, darknessId: b.darknessId },
    });
    expect(t.lastEvent()?.changes.map((c) => c.type)).toEqual(["fog"]);
    expect(
      readEventLog(t.s.db)
        .slice(log)
        .map((l) => l.type),
    ).toEqual(["DarknessPlaced", "DarknessPlaced"]);
    // The DM wire never carries `seenBy`.
    const dm = t.lastEvent()?.changes[0]?.after as FogRecord;
    expect(JSON.stringify(t.s.records.get("fog")?.dmRedact?.(dm as never))).not.toContain("seenBy");
  });

  test("FR-FOG-30 move (translate, grid units), remove, clear; unknown id → not_found; (0, 0) / empty clear → no-op", () => {
    const t = setup();
    const a = t.place1({ rect: [1, 1, 3, 2] }).darknessId;
    const b = t.place1({ polygon: [5, 5, 7.5, 5, 6, 7.25] }).darknessId;
    const c = t.place1({ circle: [10, 10, 2] }).darknessId;
    t.cmd(F.moveDarkness, { darknessId: a, dx: 0.5, dy: -1 });
    t.cmd(F.moveDarkness, { darknessId: b, dx: 1.1, dy: 0.2 });
    t.cmd(F.moveDarkness, { darknessId: c, dx: -2, dy: 3 });
    expect(t.darkness()).toEqual([
      { id: a, rect: [1.5, 0, 3.5, 1] },
      { id: b, polygon: [6.1, 5.2, 8.6, 5.2, 7.1, 7.45] },
      { id: c, circle: [8, 13, 2] },
    ]);
    expect(t.lastEvent()).toMatchObject({ type: "DarknessMoved", payload: { darknessId: c } });
    const n = t.events.length;
    expect(t.cmd(F.moveDarkness, { darknessId: a, dx: 0, dy: 0 })).toEqual({ editId: null });
    expect(t.events.length).toBe(n);
    for (const [name, input] of [
      [F.moveDarkness, { darknessId: "nope", dx: 1, dy: 0 }],
      [F.removeDarkness, { darknessId: "nope" }],
    ] as const) {
      expect(t.err(() => t.cmd(name, input))).toMatchObject({
        code: "not_found",
        message: DARKNESS_NOT_FOUND,
      });
    }
    // The moved shape must stay within ±1,024.
    expect(t.err(() => t.cmd(F.moveDarkness, { darknessId: c, dx: 1020, dy: 0 })).code).toBe(
      "invalid",
    );
    t.cmd(F.removeDarkness, { darknessId: b });
    expect(t.lastEvent()).toMatchObject({ type: "DarknessRemoved", payload: { darknessId: b } });
    expect(t.darkness().map((d) => d.id)).toEqual([a, c]);
    t.cmd(F.clearDarkness, {});
    expect(t.lastEvent()?.type).toBe("DarknessCleared");
    expect(t.lastEvent()?.payload).not.toHaveProperty("darknessId");
    expect(t.darkness()).toEqual([]);
    expect(t.cmd(F.clearDarkness, {})).toEqual({ editId: null });
    expect(t.stack().map((e) => e.kind)).toEqual([
      "darkness-place",
      "darkness-place",
      "darkness-place",
      "darkness-move",
      "darkness-move",
      "darkness-move",
      "darkness-remove",
      "darkness-clear",
    ]);
  });

  test("FR-FOG-27 ≤ 20 darkness shapes → conflict 'Too many darkness areas', nothing written; crossing / zero area → invalid", () => {
    const t = setup();
    for (let i = 0; i < DARKNESS_MAX; i++) t.place1({ circle: [i % 20, 3, 0.5] });
    const before = t.fog();
    const n = t.events.length;
    expect(t.err(() => t.place1({ circle: [1, 1, 1] }))).toMatchObject({
      code: "conflict",
      message: FOG_TOO_MANY_DARKNESS,
    });
    expect(t.fog()).toEqual(before);
    expect(t.events.length).toBe(n);
    expect(t.err(() => t.place1({ polygon: [0, 0, 4, 4, 4, 0, 0, 4] }))).toMatchObject({
      code: "invalid",
      message: "Edges can't cross",
    });
    expect(t.err(() => t.place1({ rect: [1, 1, 4, 1] })).code).toBe("invalid");
    expect(t.err(() => t.place1({ circle: [1, 1, 61] })).code).toBe("invalid");
  });

  test("FR-FOG-28 / -06 Fog all and Reveal all never touch darkness", () => {
    const t = setup();
    const a = t.place1({ circle: [5, 5, 1] }).darknessId;
    t.cmd(F.setAll, { fogged: false });
    t.cmd(F.setAll, { fogged: true });
    expect(t.darkness().map((d) => d.id)).toEqual([a]);
    // Same value and no shapes → no-op; with shapes → clears them.
    expect(t.cmd(F.setAll, { fogged: true })).toEqual({ editId: null });
    t.edit("reveal", { rect: [0, 0, 2, 2] });
    expect(t.cmd(F.setAll, { fogged: true }).editId).not.toBeNull();
    expect(t.fog()?.shapes).toEqual([]);
  });

  test("FR-FOG-09 player → forbidden for every V1 intent; other campaign's scene → not_found", () => {
    const t = setup();
    const p = t.player(t.h.p1);
    const id = t.place1({ circle: [5, 5, 1] }).darknessId;
    const inputs: [string, object][] = [
      [F.placeDarkness, { shape: { circle: [1, 1, 1] } }],
      [F.moveDarkness, { darknessId: id, dx: 1, dy: 1 }],
      [F.removeDarkness, { darknessId: id }],
      [F.clearDarkness, {}],
      [F.setExplored, { on: true }],
      [F.forgetExplored, {}],
    ];
    for (const [name, input] of inputs) {
      expect(t.err(() => t.run(name, { sceneId: t.ambush.id, ...input }, p)).code).toBe(
        "forbidden",
      );
    }
    const elsewhere = t.run<SceneRecord>(
      R.createScene,
      { name: "X", mapAssetId: "art-other" },
      t.h.dmSecond,
    );
    for (const [name, input] of inputs) {
      expect(t.err(() => t.run(name, { ...input, sceneId: elsewhere.id })).code).toBe("not_found");
    }
    // `seenBy` in an intent → invalid (strict zod).
    expect(
      t.err(() =>
        t.cmd(F.placeDarkness, { sceneId: t.ambush.id, shape: { circle: [1, 1, 1], seenBy: [] } }),
      ).code,
    ).toBe("invalid");
  });
});

describe("FR-FOG-07 one undo stack over shapes and darkness (#207 G12)", () => {
  test("FR-FOG-07 strict LIFO across fog edits and darkness; undoing a remove / clear restores the same ids", () => {
    const t = setup();
    const a = t.place1({ circle: [5, 5, 1] }).darknessId;
    t.edit("reveal", { rect: [0, 0, 4, 4] });
    const b = t.place1({ rect: [8, 8, 10, 10] }).darknessId;
    t.cmd(F.moveDarkness, { darknessId: a, dx: 1, dy: 0 });
    t.cmd(F.removeDarkness, { darknessId: b });
    t.cmd(F.clearDarkness, {});
    expect(t.darkness()).toEqual([]);
    t.undo();
    expect(t.lastEvent()).toMatchObject({ type: "FogUndone" });
    expect(t.darkness()).toEqual([{ id: a, circle: [6, 5, 1] }]);
    t.undo();
    expect(t.darkness()).toEqual([
      { id: a, circle: [6, 5, 1] },
      { id: b, rect: [8, 8, 10, 10] },
    ]);
    t.undo(); // the move
    expect(t.darkness()[0]).toEqual({ id: a, circle: [5, 5, 1] });
    t.undo(); // the place of b
    expect(t.darkness().map((d) => d.id)).toEqual([a]);
    expect(t.fog()?.shapes).toHaveLength(1);
    t.undo(); // the reveal
    expect(t.fog()?.shapes).toEqual([]);
    expect(t.darkness().map((d) => d.id)).toEqual([a]);
    t.undo(); // the first place
    expect(t.darkness()).toEqual([]);
    expect(t.fog()?.undo).toBeNull();
  });

  test("FR-FOG-07 pre-v2 undo rows (prevShapes / prevDarkness null): shapes → [], darkness unchanged", () => {
    const t = setup();
    const a = t.place1({ circle: [5, 5, 1] }).darknessId;
    t.edit("reveal", { rect: [0, 0, 4, 4] });
    const top = t.stack().at(-1)?.id as string;
    t.s.db
      .update(sceneFogEdit)
      .set({ prevShapes: null, prevDarkness: null })
      .where(eq(sceneFogEdit.id, top))
      .run();
    t.edit("reveal", { rect: [5, 5, 6, 6] }); // pushes a v2 row over it
    t.undo();
    t.undo(); // the doctored row
    expect(t.fog()?.shapes).toEqual([]);
    expect(t.darkness().map((d) => d.id)).toEqual([a]);
  });
});

describe("FR-FOG-34 static derive with darkness", () => {
  test("FR-FOG-34 / -08 a token in revealed area under darkness is seen by nobody; moving the darkness off reveals it in the one DarknessMoved", () => {
    const t = setup();
    t.edit("reveal", { rect: [0, 0, 20, 14] });
    const goblin = t.place(12, 8);
    expect(t.tok(goblin)).toMatchObject({ fogged: false });
    const d = t.place1({ circle: [12.5, 9, 1.5] }).darknessId;
    expect(t.tok(goblin)).toMatchObject({ fogged: true, seenBy: [] });
    expect(t.lastEvent()?.changes.map((c) => [c.type, c.id])).toEqual([
      ["fog", t.ambush.id],
      ["token", goblin],
    ]);
    t.cmd(F.moveDarkness, { darknessId: d, dx: 5, dy: 0 });
    expect(t.tok(goblin)?.fogged).toBe(false);
    expect(t.lastEvent()?.type).toBe("DarknessMoved");
    expect(t.lastEvent()?.changes.map((c) => c.id)).toEqual([t.ambush.id, goblin]);
    // Undo the move → back in darkness.
    t.undo();
    expect(t.tok(goblin)?.fogged).toBe(true);
  });

  test("FR-FOG-01 explored shapes hide records (Explored counts as hidden) like fog", () => {
    const t = setup();
    t.edit("reveal", { rect: [0, 0, 20, 14] });
    const goblin = t.place(3, 3);
    t.edit("explored", { polygon: [2, 2, 5, 2, 5, 5, 2, 5] });
    expect(t.tok(goblin)?.fogged).toBe(true);
    t.edit("reveal", { circle: [3.5, 3.5, 0.5] });
    expect(t.tok(goblin)?.fogged).toBe(false);
  });
});

describe("FR-FOG-44 darkness filter (static part)", () => {
  test("FR-FOG-44 seenBy = every player with a statically clear / explored cell centre in the box; in static fog → nobody", () => {
    const t = setup();
    const players = [t.h.p1.id, t.h.p2.id];
    t.edit("reveal", { rect: [0, 6, 3, 11] });
    t.edit("explored", { polygon: [8.5, 0, 19.75, 0, 19.75, 4.5, 8.5, 4.5] });
    t.place1({ circle: [17.5, 11.5, 1] }); // box in static fog
    t.place1({ circle: [1.5, 8.5, 1] }); // over the revealed nook
    t.place1({ circle: [16.4, 3.7, 2.2] }); // box meets the static Explored polygon
    const raw = t.s.db.select().from(sceneFog).where(eq(sceneFog.sceneId, t.ambush.id)).get();
    expect(raw?.darkness.map((d) => d.seenBy)).toEqual([[], players, players]);
    // Box edges are boundary-inclusive on cell centres: (3.5, 12.5) and (2.5, 11.5) lie on the box
    // but in fog (the reveal ends at x 3, y 11) → nobody; (2.5, 10.5) is revealed → everyone.
    t.place1({ rect: [3.5, 12, 6, 13] });
    t.place1({ rect: [2.5, 11.5, 6, 13] });
    const rows = t.s.db.select().from(sceneFog).where(eq(sceneFog.sceneId, t.ambush.id)).get();
    expect(rows?.darkness.slice(3).map((d) => d.seenBy)).toEqual([[], []]);
    t.place1({ rect: [2.5, 10.5, 6, 13] });
    const last = t.s.db.select().from(sceneFog).where(eq(sceneFog.sceneId, t.ambush.id)).get();
    expect(last?.darkness.at(-1)?.seenBy).toEqual(players);
  });

  test("FR-FOG-44 a player's explored memory cell in the box → that player only; Forget explored drops it (fog row + fog-explored deletes in ExploredForgotten)", () => {
    const t = setup();
    const m = new Uint8Array(20 * 14);
    m[11 * 20 + 17] = 1; // cell (17, 11) explored for player 1
    t.s.db
      .insert(fogExplored)
      .values({
        sceneId: t.ambush.id,
        playerId: t.h.p1.id,
        campaignId: t.h.campaignId,
        col0: 0,
        row0: 0,
        cols: 20,
        rows: 14,
        runs: encodeRuns(m, "clear"),
        updatedAt: AT,
      })
      .run();
    t.place1({ circle: [17.5, 11.5, 1] });
    const seen = () =>
      t.s.db.select().from(sceneFog).where(eq(sceneFog.sceneId, t.ambush.id)).get()?.darkness[0]
        ?.seenBy;
    expect(seen()).toEqual([t.h.p1.id]);
    // FR-FOG-02: a duplicate copies the darkness, not the memory: nobody gets it there.
    const copy = t.run<SceneRecord>(R.duplicateScene, { id: t.ambush.id });
    const copied = t.s.db.select().from(sceneFog).where(eq(sceneFog.sceneId, copy.id)).get();
    expect(copied?.darkness.map((d) => d.seenBy)).toEqual([[]]);
    t.cmd(F.forgetExplored, {});
    expect(t.lastEvent()?.type).toBe("ExploredForgotten");
    expect(t.lastEvent()?.changes.map((c) => [c.type, c.after === null])).toEqual([
      [FOG_EXPLORED_TYPE, true],
      ["fog", false],
    ]);
    expect(seen()).toEqual([]);
    expect(t.s.db.select().from(fogExplored).all()).toEqual([]);
    // No rows → no-op.
    const n = t.events.length;
    t.cmd(F.forgetExplored, {});
    expect(t.events.length).toBe(n);
  });
});

describe("FR-FOG-29 Explored memory setting", () => {
  test("FR-FOG-29 default on; fog.setExplored off / on → FogExploredSet with the fog row; same value → no-op; not in the undo stack", () => {
    const t = setup();
    // #383: a new scene starts with Remember explored areas on.
    expect(t.fog()?.explored).toBe(true);
    const depth = t.stack().length;
    t.cmd(F.setExplored, { on: false });
    expect(t.fog()?.explored).toBe(false);
    expect(t.lastEvent()).toMatchObject({
      type: "FogExploredSet",
      payload: { sceneId: t.ambush.id, on: false },
    });
    expect(t.lastEvent()?.changes.map((c) => c.type)).toEqual(["fog"]);
    const n = t.events.length;
    t.cmd(F.setExplored, { on: false });
    expect(t.events.length).toBe(n);
    t.cmd(F.setExplored, { on: true });
    expect(t.fog()?.explored).toBe(true);
    expect(t.stack().length).toBe(depth);
  });

  test("FR-FOG-29 default on: a new scene's fog row and a duplicate of an off scene keep their setting", () => {
    const t = setup();
    const made = t.run<SceneRecord>(R.createScene, { name: "Cellar", mapAssetId: "map-battle" });
    expect(readFogRecord(t.s.db, made.id)?.explored).toBe(true);
    t.cmd(F.setExplored, { on: false });
    const copy = t.run<SceneRecord>(R.duplicateScene, { id: t.ambush.id });
    expect(readFogRecord(t.s.db, copy.id)?.explored).toBe(false);
  });

  test("FR-FOG-29 boot upgrade: a DB from before #383 switches every scene on once, no event; a fresh DB is stamped; rerun no-op", () => {
    const t = setup();
    // A DB created from scratch already has the version: nothing to do.
    expect(exploredDefaultOf(t.s.db)).toBe(EXPLORED_DEFAULT);
    expect(upgradeExploredDefault(t.s.db)).toBe(0);
    // Before #383: every row off, no version.
    t.s.db.update(sceneFog).set({ explored: false }).run();
    t.s.db.delete(dbMeta).where(eq(dbMeta.key, EXPLORED_DEFAULT_KEY)).run();
    expect(exploredDefaultOf(t.s.db)).toBe(0);
    const rows = () => t.s.db.select().from(sceneFog).all();
    const n = t.events.length;
    expect(upgradeExploredDefault(t.s.db)).toBe(rows().length);
    expect(rows().every((r) => r.explored)).toBe(true);
    expect(exploredDefaultOf(t.s.db)).toBe(EXPLORED_DEFAULT);
    expect(t.events.length).toBe(n);
    // Rerun, even after the DM switched a scene off again: nothing.
    t.cmd(F.setExplored, { on: false });
    expect(upgradeExploredDefault(t.s.db)).toBe(0);
    expect(t.fog()?.explored).toBe(false);
  });
});

describe("FOG §11 crash (V1 intents)", () => {
  test("FOG §11 fog.placeDarkness:before-commit → digest unchanged; after-commit → row, entry and log there", () => {
    class Killed extends Error {}
    const kill = () => {
      throw new Killed();
    };
    const t = setup();
    const digest = stateDigest(t.s.db.$client).sha256;
    const log = readEventLog(t.s.db).length;
    armCrashHook({ point: "before-commit", target: F.placeDarkness }, kill);
    expect(() => t.place1({ circle: [5, 5, 1] })).toThrow();
    expect(stateDigest(t.s.db.$client).sha256).toBe(digest);
    armCrashHook({ point: "after-commit", target: F.placeDarkness }, kill);
    expect(() => t.place1({ circle: [5, 5, 1] })).toThrow(Killed);
    armCrashHook(null);
    expect(t.darkness()).toHaveLength(1);
    expect(t.fog()?.undo?.kind).toBe("darkness-place");
    expect(
      readEventLog(t.s.db)
        .slice(log)
        .map((l) => l.type),
    ).toEqual(["DarknessPlaced"]);
    for (const [target, fn] of [
      [
        F.moveDarkness,
        () => t.cmd(F.moveDarkness, { darknessId: t.darkness()[0]?.id, dx: 1, dy: 0 }),
      ],
      [F.removeDarkness, () => t.cmd(F.removeDarkness, { darknessId: t.darkness()[0]?.id })],
      [F.clearDarkness, () => t.cmd(F.clearDarkness, {})],
      [F.setExplored, () => t.cmd(F.setExplored, { on: true })],
    ] as const) {
      const before = stateDigest(t.s.db.$client).sha256;
      armCrashHook({ point: "before-commit", target }, kill);
      expect(fn).toThrow();
      expect(stateDigest(t.s.db.$client).sha256).toBe(before);
    }
  });
});
