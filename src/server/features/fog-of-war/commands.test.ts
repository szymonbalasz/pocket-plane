// fog-of-war commands (FR-FOG-03–09, -13): each one transaction (fog row + undo entry + flipped
// tokens + hook rows + one log entry → one event); no-ops write nothing; undo is strict LIFO with
// a depth cap and an `expectedEditId` guard; players are refused; a crash is all or nothing.
import { afterEach, describe, expect, test } from "bun:test";
import { encodeRuns } from "@shared/fog-of-war/mask";
import {
  FOG_INTENTS as F,
  FOG_UNDO_MAX,
  type FogRecord,
  type FogShape,
} from "@shared/fog-of-war/schemas";
import { MAP_INTENTS as I, type SceneRecord, type TokenRecord } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { seededContext } from "../../commands/context";
import { armCrashHook } from "../../commands/crash";
import { conflict } from "../../commands/errors";
import { stateDigest } from "../../db/digest";
import { sceneFog, token } from "../../db/schema";
import { readEventLog } from "../../events/log";
import { createEntity } from "../entities/commands";
import { captureLogger, goblinBlock } from "../entities/testing";
import { MAP_REST as R } from "../scenes-map/commands";
import { addAsset, scenesSetup } from "../scenes-map/testing";
import { tokenHooks } from "../scenes-map/token-hooks";
import { visibilityHooks } from "../scenes-map/visibility-hooks";
import { FOG_CHANGED, FOG_NOTHING_TO_UNDO, FOG_TOO_DETAILED, fogUndoStack } from "./commands";
import { readFogRecord } from "./rows";
import { dropFogRow } from "./testing";

afterEach(() => {
  visibilityHooks.unregister("test.hides");
  tokenHooks.unregister("test.spy");
  armCrashHook(null);
});

const AT = "2026-01-01T00:00:00.000Z";

function setup() {
  const cap = captureLogger();
  const t = scenesSetup(cap.log);
  // Scenes as before this build (no fog row); FR-FOG-02's fogged start is in hooks.test.ts.
  const newScene = (name = "Goblin Ambush", mapAssetId = "map-battle") => {
    const s = t.run<SceneRecord>(R.createScene, { name, mapAssetId });
    dropFogRow(t.s.db, s.id);
    return s;
  };
  const ambush = newScene();
  const ogre = t.run<{ id: string }>(createEntity.name, {
    kind: "monster",
    name: "Cave Ogre",
    statBlock: { ...goblinBlock, size: "large" },
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
  const fog = (sceneId = ambush.id) => readFogRecord(t.s.db, sceneId);
  const stack = (sceneId = ambush.id) => fogUndoStack(t.s.db, sceneId);
  const edit = (op: "reveal" | "hide", shape: FogShape, sceneId = ambush.id, key?: string) =>
    t.run<{ editId: string | null }>(F.edit, { sceneId, op, shape }, t.h.dm, key).editId;
  const setAll = (fogged: boolean, sceneId = ambush.id) =>
    t.run<{ editId: string | null }>(F.setAll, { sceneId, fogged }).editId;
  const undo = (expectedEditId: string, sceneId = ambush.id) =>
    t.run(F.undo, { sceneId, expectedEditId });
  const rect = (c0: number, r0: number, c1: number, r1: number): FogShape => ({
    kind: "rect",
    c0,
    r0,
    c1,
    r1,
  });
  const lastEvent = () => t.events.at(-1)?.event;
  return {
    ...t,
    cap,
    ambush,
    newScene,
    ogre,
    place,
    tok,
    fog,
    stack,
    edit,
    setAll,
    undo,
    rect,
    lastEvent,
  };
}

/** Runs of a 20 × 14 box where exactly the listed cells are clear (fill fog). */
function clearAt(cells: [number, number][]): string {
  const m = new Uint8Array(20 * 14).fill(1);
  for (const [c, r] of cells) m[r * 20 + c] = 0;
  return encodeRuns(m, "fog");
}
const block = (c0: number, r0: number, c1: number, r1: number) => {
  const out: [number, number][] = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) out.push([c, r]);
  return out;
};

describe("FR-FOG-06 fog.setAll", () => {
  test("FR-FOG-06 Fog all on a scene without a row: row + undo entry + log + one FogEdited; IDs from ctx", () => {
    const t = setup();
    expect(t.fog()).toBeNull();
    const n = t.events.length;
    const log = readEventLog(t.s.db).length;
    const editId = t.run<{ editId: string }>(
      F.setAll,
      { sceneId: t.ambush.id, fogged: true },
      t.h.dm,
      "fog-x",
    ).editId;
    expect(editId).toBe(seededContext({ disposable: true, key: "fog-x" }).ids.next());
    const after = t.fog() as FogRecord;
    expect(after).toEqual({
      id: t.ambush.id,
      campaignId: t.h.campaignId,
      fill: "fog",
      box: [0, 0, 20, 14],
      runs: "",
      undo: { n: 1, editId, kind: "fog-all" },
    });
    expect(t.stack()).toEqual([
      expect.objectContaining({
        id: editId,
        kind: "fog-all",
        prevFill: "clear",
        prevCols: 0,
        prevRows: 0,
        prevRuns: "",
      }),
    ]);
    expect(t.events.length).toBe(n + 1);
    expect(t.lastEvent()).toMatchObject({
      type: "FogEdited",
      payload: { sceneId: t.ambush.id, editId, kind: "fog-all" },
      changes: [{ type: "fog", id: t.ambush.id, before: null, after }],
    });
    expect(t.lastEvent()?.payload).not.toHaveProperty("shape");
    expect(
      readEventLog(t.s.db)
        .slice(log)
        .map((l) => l.type),
    ).toEqual(["FogEdited"]);
  });

  test("FR-FOG-06 same value → no-op: no row, no event, no entry, editId null", () => {
    const t = setup();
    const n = t.events.length;
    expect(t.setAll(false)).toBeNull();
    expect(t.fog()).toBeNull();
    t.setAll(true);
    expect(t.setAll(true)).toBeNull();
    expect(t.events.length).toBe(n + 1);
    expect(t.stack()).toHaveLength(1);
    // Reveal all: clear row, kind reveal-all.
    t.setAll(false);
    expect(t.fog()).toMatchObject({ fill: "clear", runs: "", undo: { n: 2, kind: "reveal-all" } });
  });
});

describe("FR-FOG-05 fog.edit", () => {
  test("FR-FOG-05 reveal rect (normalised, inclusive): runs over the box, shape in the payload", () => {
    const t = setup();
    t.setAll(true);
    const shape = t.rect(7, 11, 0, 3);
    const editId = t.edit("reveal", shape) as string;
    expect(t.fog()).toMatchObject({
      fill: "fog",
      box: [0, 0, 20, 14],
      runs: clearAt(block(0, 3, 7, 11)),
      undo: { n: 2, editId, kind: "reveal-rect" },
    });
    expect(t.lastEvent()).toMatchObject({
      type: "FogEdited",
      payload: { sceneId: t.ambush.id, editId, kind: "reveal-rect", shape },
    });
    // Hide part of it again.
    t.edit("hide", t.rect(0, 3, 7, 3));
    expect(t.fog()?.runs).toBe(clearAt(block(0, 4, 7, 11)));
    expect(t.stack().map((e) => e.kind)).toEqual(["fog-all", "reveal-rect", "hide-rect"]);
  });

  test("FR-FOG-05 polygon: centre on the diagonal is inside; crossing / zero area → invalid", () => {
    const t = setup();
    t.setAll(true);
    const tri: FogShape = {
      kind: "polygon",
      points: [
        [8, 9],
        [13, 9],
        [8, 14],
      ],
    };
    t.edit("reveal", tri);
    // Row 9: centres x 8.5…12.5 inside (edge x + y = 22 → x ≤ 12.5); row 13: x 8.5 only.
    const cells: [number, number][] = [];
    for (let r = 9; r < 14; r++) for (let c = 8; c + 0.5 + r + 0.5 <= 22; c++) cells.push([c, r]);
    expect(t.fog()?.runs).toBe(clearAt(cells));
    expect(t.stack().at(-1)?.kind).toBe("reveal-polygon");
    const n = t.events.length;
    const bow: FogShape = {
      kind: "polygon",
      points: [
        [0, 0],
        [4, 4],
        [4, 0],
        [0, 4],
      ],
    };
    expect(t.err(() => t.edit("reveal", bow))).toMatchObject({
      code: "invalid",
      message: "Edges can't cross",
    });
    const flat: FogShape = {
      kind: "polygon",
      points: [
        [0, 0],
        [2, 0],
        [4, 0],
      ],
    };
    // Collinear points overlap their adjacent edges (crossing) or have no area: both invalid.
    expect(t.err(() => t.edit("reveal", flat)).code).toBe("invalid");
    expect(t.events.length).toBe(n);
  });

  test("FR-FOG-05 zod: ints, |v| ≤ 1,024, 3–64 vertices, strict; fogged in an intent → invalid", () => {
    const t = setup();
    const bad = [
      { op: "reveal", shape: { kind: "rect", c0: 0.5, r0: 0, c1: 1, r1: 1 } },
      { op: "reveal", shape: { kind: "rect", c0: 1025, r0: 0, c1: 1, r1: 1 } },
      {
        op: "reveal",
        shape: {
          kind: "polygon",
          points: [
            [0, 0],
            [1, 1],
          ],
        },
      },
      {
        op: "reveal",
        shape: { kind: "polygon", points: Array.from({ length: 65 }, (_, i) => [i, i % 2]) },
      },
      { op: "erase", shape: { kind: "rect", c0: 0, r0: 0, c1: 1, r1: 1 } },
      { op: "reveal", shape: { kind: "rect", c0: 0, r0: 0, c1: 1, r1: 1 }, fogged: true },
    ];
    for (const b of bad) {
      expect(t.err(() => t.run(F.edit, { sceneId: t.ambush.id, ...b })).code).toBe("invalid");
    }
    // FR-FOG-10: `fogged` is server-written; a placement carrying it is refused.
    expect(
      t.err(() =>
        t.run(I.placeToken, {
          sceneId: t.ambush.id,
          definitionId: t.h.goblinId,
          col: 1,
          row: 1,
          fogged: true,
        }),
      ).code,
    ).toBe("invalid");
  });

  test("FR-FOG-05 no cell changes (already clear, outside the box) → no event, no entry, editId null", () => {
    const t = setup();
    const n = t.events.length;
    // No row = every cell clear: a reveal changes nothing.
    expect(t.edit("reveal", t.rect(0, 0, 5, 5))).toBeNull();
    expect(t.fog()).toBeNull();
    t.setAll(true);
    // Wholly outside the 20 × 14 box: ignored.
    expect(t.edit("reveal", t.rect(30, 30, 40, 40))).toBeNull();
    expect(
      t.edit("reveal", {
        kind: "polygon",
        points: [
          [-10, -10],
          [-5, -10],
          [-10, -5],
        ],
      }),
    ).toBeNull();
    expect(t.edit("hide", t.rect(0, 0, 3, 3))).toBeNull();
    expect(t.events.length).toBe(n + 1);
    expect(t.stack()).toHaveLength(1);
    // Partly outside: only box cells change.
    t.edit("reveal", t.rect(18, 12, 25, 25));
    expect(t.fog()?.runs).toBe(clearAt(block(18, 12, 19, 13)));
  });

  test("FR-FOG-04 > 2,000 runs → conflict, nothing written; ≤ 2,000 fine", () => {
    const t = setup();
    addAsset(t.s, "map-huge", t.h.campaignId, { w: 7000, h: 7000 });
    const huge = t.newScene("Huge", "map-huge");
    // 1,998 runs of one cell each, then clear: 100 × 100 box, fill clear.
    const cells = new Uint8Array(100 * 100);
    for (let i = 0; i < 1998; i += 2) cells[i] = 1;
    t.s.db
      .insert(sceneFog)
      .values({
        sceneId: huge.id,
        campaignId: t.h.campaignId,
        fill: "clear",
        col0: 0,
        row0: 0,
        cols: 100,
        rows: 100,
        runs: encodeRuns(cells, "clear"),
        updatedAt: AT,
      })
      .run();
    expect(t.fog(huge.id)?.runs.split(",")).toHaveLength(1998);
    // An isolated fogged cell adds two runs: 2,000 is within the cap.
    expect(t.edit("hide", t.rect(50, 50, 50, 50), huge.id)).not.toBeNull();
    expect(t.fog(huge.id)?.runs.split(",")).toHaveLength(2000);
    const before = t.fog(huge.id);
    const n = t.events.length;
    const e = t.err(() => t.edit("hide", t.rect(60, 60, 60, 60), huge.id));
    expect(e).toMatchObject({ code: "conflict", message: FOG_TOO_DETAILED });
    expect(t.fog(huge.id)).toEqual(before);
    expect(t.stack(huge.id)).toHaveLength(1);
    expect(t.events.length).toBe(n);
  });

  test("FR-FOG-04 corrupt runs on read → fully fogged + error log; the edit applies to that", () => {
    const t = setup();
    t.s.db
      .insert(sceneFog)
      .values({
        sceneId: t.ambush.id,
        campaignId: t.h.campaignId,
        fill: "clear",
        col0: 0,
        row0: 0,
        cols: 20,
        rows: 14,
        runs: "5,5",
        updatedAt: AT,
      })
      .run();
    t.edit("reveal", t.rect(0, 0, 0, 0));
    expect(t.cap.errors).toEqual([
      `fog: scene ${t.ambush.id} has corrupt runs; treated as fully fogged`,
    ]);
    expect(t.fog()).toMatchObject({ fill: "fog", runs: clearAt([[0, 0]]) });
    // The undo entry holds the fail-closed mask, not the corrupt runs.
    expect(t.stack()[0]).toMatchObject({ prevFill: "fog", prevRuns: "", prevCols: 20 });
  });

  test("FR-FOG-03 re-base: an edit after a grid change takes the new box; dropped cells fall back to fill", () => {
    const t = setup();
    t.setAll(true);
    t.edit("reveal", t.rect(0, 0, 19, 0)); // row 0 clear
    t.run(I.setGrid, {
      sceneId: t.ambush.id,
      cellSize: 70,
      offsetX: 35,
      offsetY: 0,
      visible: true,
      color: "#000000",
      opacity: 0.5,
    });
    // Grid change alone: fog untouched (cells keep their index).
    expect(t.fog()?.box).toEqual([0, 0, 20, 14]);
    t.edit("reveal", t.rect(5, 5, 5, 5));
    // New box: col0 = floor(−35 / 70) = −1, cols = ceil((1400 − 35) / 70) + 1 = 21.
    const rec = t.fog() as FogRecord;
    expect(rec.box).toEqual([-1, 0, 21, 14]);
    const m = new Uint8Array(21 * 14).fill(1);
    for (let c = 0; c <= 19; c++) m[c + 1] = 0; // row 0, cols 0…19 kept clear; col −1 takes fill
    m[5 * 21 + 6] = 0;
    expect(rec.runs).toBe(encodeRuns(m, "fog"));
  });
});

describe("FR-FOG-08 tokens and hooks", () => {
  test("FR-FOG-08 / -10 fogged re-derived on every token whose value flips; Large with one clear cell stays", () => {
    const t = setup();
    const goblin = t.place(12, 6);
    const ogre = t.run<{ tokenId: string }>(I.placeToken, {
      sceneId: t.ambush.id,
      definitionId: t.ogre.id,
      col: 9,
      row: 10,
    }).tokenId;
    const owned = t.place(2, 7, { ownerPlayerId: t.h.p1.id });
    t.setAll(true);
    const ev = t.lastEvent();
    expect(ev?.changes.map((c) => [c.type, c.id])).toEqual([
      ["fog", t.ambush.id],
      ["token", goblin],
      ["token", ogre],
      ["token", owned],
    ]);
    for (const id of [goblin, ogre, owned]) expect(t.tok(id)?.fogged).toBe(true);
    expect(ev?.changes[1]?.after).toMatchObject({ fogged: true });
    // Reveal one cell of the Ogre's 2 × 2: not every footprint cell fogged → not fogged.
    t.edit("reveal", t.rect(10, 11, 10, 11));
    expect(t.lastEvent()?.changes.map((c) => c.id)).toEqual([t.ambush.id, ogre]);
    expect(t.tok(ogre)?.fogged).toBe(false);
    expect(t.tok(goblin)?.fogged).toBe(true);
    // An edit that flips nothing lists only the fog row.
    t.edit("reveal", t.rect(0, 0, 0, 0));
    expect(t.lastEvent()?.changes.map((c) => c.type)).toEqual(["fog"]);
  });

  test("FR-FOG-13 no `hides` registered → token-changed hooks never run (players unaffected)", () => {
    const t = setup();
    const runs: string[] = [];
    tokenHooks.register("test.spy", (_e, before) => {
      runs.push(before.id);
      return [];
    });
    t.place(12, 6);
    t.setAll(true);
    t.edit("reveal", t.rect(0, 0, 19, 13));
    expect(runs).toEqual([]);
  });

  test("FR-FOG-13 a fog-hidden flip runs the token-changed hooks; rows join; a reject rolls everything back", () => {
    const t = setup();
    visibilityHooks.register({
      name: "test.hides",
      hides: (type, r) => type === "token" && (r as TokenRecord).fogged === true,
    });
    const goblin = t.place(12, 6);
    const seen: [string, boolean | undefined, boolean | undefined][] = [];
    let reject = false;
    tokenHooks.register("test.spy", (_e, before, after) => {
      if (reject) throw conflict("bound");
      seen.push([before.id, before.fogged, after?.fogged]);
      return [{ type: "probe", id: before.id, before: null, after: { id: before.id } }];
    });
    t.setAll(true);
    expect(seen).toEqual([[goblin, undefined, true]]);
    expect(t.lastEvent()?.changes.map((c) => c.type)).toEqual(["fog", "token", "probe"]);
    // Reject: no fog row change, no undo entry, no token change, no event, no log entry.
    reject = true;
    const fogBefore = t.fog();
    const n = t.events.length;
    const log = readEventLog(t.s.db).length;
    expect(t.err(() => t.edit("reveal", t.rect(12, 6, 12, 6))).code).toBe("conflict");
    expect(t.fog()).toEqual(fogBefore);
    expect(t.tok(goblin)?.fogged).toBe(true);
    expect(t.events.length).toBe(n);
    expect(readEventLog(t.s.db).length).toBe(log);
  });
});

describe("FR-FOG-07 fog.undo", () => {
  test("FR-FOG-07 restores the mask before the latest edit, LIFO; tokens re-derived; one FogUndone", () => {
    const t = setup();
    const goblin = t.place(12, 6);
    const a = t.setAll(true) as string;
    const b = t.edit("reveal", t.rect(11, 5, 13, 7)) as string;
    expect(t.tok(goblin)?.fogged).toBe(false);
    const fogged = t.fog() as FogRecord;
    const c = t.edit("hide", t.rect(0, 0, 3, 3)) as string;
    expect(c).toBeNull(); // already fogged → nothing to undo for it
    const d = t.edit("reveal", t.rect(0, 0, 0, 0)) as string;
    const n = t.events.length;
    const log = readEventLog(t.s.db).length;
    t.undo(d);
    expect(t.fog()).toEqual(fogged);
    expect(t.events.length).toBe(n + 1);
    expect(t.lastEvent()).toMatchObject({
      type: "FogUndone",
      payload: { sceneId: t.ambush.id, editId: d },
    });
    expect(
      readEventLog(t.s.db)
        .slice(log)
        .map((l) => l.type),
    ).toEqual(["FogUndone"]);
    t.undo(b);
    expect(t.tok(goblin)?.fogged).toBe(true);
    expect(t.lastEvent()?.changes.map((x) => x.id)).toEqual([t.ambush.id, goblin]);
    expect(t.fog()).toMatchObject({ fill: "fog", runs: "", undo: { n: 1, editId: a } });
    // Undoing the first edit restores "no fog" (a clear row): every cell clear.
    t.undo(a);
    expect(t.fog()).toMatchObject({ fill: "clear", runs: "", undo: null });
  });

  test("FR-FOG-07 stale expectedEditId → conflict; empty → conflict; nothing changes", () => {
    const t = setup();
    expect(t.err(() => t.undo("nope"))).toMatchObject({
      code: "conflict",
      message: FOG_NOTHING_TO_UNDO,
    });
    const a = t.setAll(true) as string;
    t.edit("reveal", t.rect(0, 0, 1, 1));
    const before = t.fog();
    const n = t.events.length;
    expect(t.err(() => t.undo(a))).toMatchObject({ code: "conflict", message: FOG_CHANGED });
    expect(t.fog()).toEqual(before);
    expect(t.events.length).toBe(n);
  });

  test("FR-FOG-07 ≤ 20 entries: the oldest drops in the edit's transaction; stacks are per scene", () => {
    const t = setup();
    const other = t.newScene("Town", "map-town");
    t.setAll(true, other.id);
    t.setAll(true);
    const ids: string[] = [];
    for (let i = 0; i < FOG_UNDO_MAX + 2; i++) {
      const [c, r] = [i % 20, Math.floor(i / 20)];
      ids.push(t.edit("reveal", t.rect(c, r, c, r)) as string);
    }
    const stack = t.stack();
    expect(stack).toHaveLength(FOG_UNDO_MAX);
    expect(stack.map((e) => e.id)).toEqual(ids.slice(2));
    expect(t.fog()?.undo).toMatchObject({ n: FOG_UNDO_MAX, editId: ids.at(-1) });
    expect(t.stack(other.id)).toHaveLength(1);
    for (const id of [...ids.slice(2)].reverse()) t.undo(id);
    expect(t.fog()?.undo).toBeNull();
    expect(t.err(() => t.undo(ids[1] as string)).code).toBe("conflict");
  });
});

describe("FR-FOG-09 permissions and scope", () => {
  test("FR-FOG-09 player → forbidden for every fog intent; other campaign's scene → not_found", () => {
    const t = setup();
    const a = t.setAll(true) as string;
    const p = t.player(t.h.p1);
    const inputs: [string, unknown][] = [
      [F.edit, { sceneId: t.ambush.id, op: "reveal", shape: t.rect(0, 0, 1, 1) }],
      [F.setAll, { sceneId: t.ambush.id, fogged: false }],
      [F.undo, { sceneId: t.ambush.id, expectedEditId: a }],
    ];
    for (const [name, input] of inputs)
      expect(t.err(() => t.run(name, input, p)).code).toBe("forbidden");
    const elsewhere = t.run<SceneRecord>(
      R.createScene,
      { name: "X", mapAssetId: "art-other" },
      t.h.dmSecond,
    );
    for (const [name, input] of inputs) {
      const moved = { ...(input as object), sceneId: elsewhere.id };
      expect(t.err(() => t.run(name, moved)).code).toBe("not_found");
    }
    // Works on an inactive scene (prep): the ambush was never activated.
    expect(
      t.s.db.select().from(sceneFog).where(eq(sceneFog.sceneId, t.ambush.id)).all(),
    ).toHaveLength(1);
    expect(t.s.intents.has(F.edit) && t.s.intents.has(F.setAll) && t.s.intents.has(F.undo)).toBe(
      true,
    );
  });
});

describe("FOG §11 crash", () => {
  test("FOG §11 crash before commit → nothing; after commit → row, entry, tokens and log all there", () => {
    class Killed extends Error {}
    const kill = () => {
      throw new Killed();
    };
    const t = setup();
    const goblin = t.place(12, 6);
    const log = readEventLog(t.s.db).length;
    const digest = stateDigest(t.s.db.$client).sha256;
    armCrashHook({ point: "before-commit", target: F.setAll }, kill);
    expect(() => t.setAll(true)).toThrow();
    expect(stateDigest(t.s.db.$client).sha256).toBe(digest);
    expect(t.fog()).toBeNull();
    expect(t.stack()).toEqual([]);
    expect(t.tok(goblin)?.fogged).toBe(false);
    expect(readEventLog(t.s.db).length).toBe(log);
    armCrashHook({ point: "after-commit", target: F.setAll }, kill);
    expect(() => t.setAll(true)).toThrow(Killed);
    armCrashHook(null);
    expect(t.fog()).toMatchObject({ fill: "fog", undo: { n: 1 } });
    expect(t.tok(goblin)?.fogged).toBe(true);
    expect(
      readEventLog(t.s.db)
        .slice(log)
        .map((l) => l.type),
    ).toEqual(["FogEdited"]);
    // Undo and edit alike: a kill before commit leaves the digest unchanged.
    const after = stateDigest(t.s.db.$client).sha256;
    expect(after).not.toBe(digest);
    const editId = t.fog()?.undo?.editId as string;
    for (const [target, fn] of [
      [F.undo, () => t.undo(editId)],
      [F.edit, () => t.edit("reveal", t.rect(12, 6, 12, 6))],
    ] as const) {
      armCrashHook({ point: "before-commit", target }, kill);
      expect(fn).toThrow();
      expect(stateDigest(t.s.db.$client).sha256).toBe(after);
    }
  });
});
