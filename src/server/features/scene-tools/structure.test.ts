// Structure commands (SCN §9; FR-SCN-07, -08, -09, -33, -36): each edit = the row (`rev` + 1) +
// one log entry → one `StructureEdited`; edits go by `n`; no-ops write nothing; caps and bounds;
// DM only; another campaign's scene → not_found; a crash is all or nothing; players receive doors
// only (locked as closed) and only the cause name.
import { afterEach, describe, expect, test } from "bun:test";
import {
  type PlayerSceneStructureRecord,
  SCN_INTENTS as S,
  SCENE_STRUCTURE_TYPE,
  type SceneStructureRecord,
  SEGMENTS_MAX,
  type Segment,
  type Wall,
} from "@shared/scene-tools/schemas";
import { MAP_INTENTS as I, type SceneRecord } from "@shared/scenes-map/schemas";
import { armCrashHook } from "../../commands/crash";
import { stateDigest } from "../../db/digest";
import { readEventLog } from "../../events/log";
import { MAP_REST as R } from "../scenes-map/commands";
import { visibilityHooks } from "../scenes-map/visibility-hooks";
import { readStructure } from "./rows";
import { SEGMENT_CAP_MESSAGE, SEGMENT_TAKEN_MESSAGE } from "./structure";
import { scnSetup } from "./testing";

afterEach(() => {
  visibilityHooks.unregister("test.fog");
  armCrashHook(null);
});

function setup() {
  const t = scnSetup();
  const sid = t.ambush.id;
  const structure = (id = sid) => readStructure(t.s.db, id);
  const addWalls = (segments: Segment[], actor = t.h.dm, sceneId = sid) =>
    t.run<{ ns: number[] }>(S.addWalls, { sceneId, segments }, actor);
  const addDoor = (segment: Segment, state?: 0 | 1 | 2) =>
    t.run<{ n: number }>(S.addDoor, {
      sceneId: sid,
      segment,
      ...(state !== undefined ? { state } : {}),
    });
  const setDoor = (n: number, state: 0 | 1 | 2) => t.run(S.setDoor, { sceneId: sid, n, state });
  const remove = (ns: number[]) => t.run(S.removeSegments, { sceneId: sid, ns });
  const lastEvent = () => t.events.at(-1)?.event;
  return { ...t, sid, structure, addWalls, addDoor, setDoor, remove, lastEvent };
}

describe("FR-SCN-07 / -08 scn.addWalls", () => {
  test("FR-SCN-08 one polyline: lazy row, rev 1, n from nextN, one log entry, one StructureEdited", () => {
    const t = setup();
    expect(t.structure()).toBeNull();
    const log = readEventLog(t.s.db).length;
    const n0 = t.events.length;
    const r = t.addWalls([
      [8, 0, 8, 5],
      [8, 6, 8, 11],
      [8, 12, 8, 14],
    ]);
    expect(r).toEqual({ ns: [1, 2, 3] });
    expect(t.structure()).toEqual({
      id: t.sid,
      campaignId: t.h.campaignId,
      rev: 1,
      nextN: 4,
      walls: [
        [1, 8, 0, 8, 5],
        [2, 8, 6, 8, 11],
        [3, 8, 12, 8, 14],
      ],
      doors: [],
    });
    expect(
      readEventLog(t.s.db)
        .slice(log)
        .map((l) => l.type),
    ).toEqual(["StructureEdited"]);
    expect(t.events.length).toBe(n0 + 1);
    const ev = t.lastEvent();
    expect(ev?.payload).toEqual({ sceneId: t.sid, op: "addWalls", ns: [1, 2, 3] });
    expect(ev?.changes).toEqual([
      { type: SCENE_STRUCTURE_TYPE, id: t.sid, before: null, after: t.structure() },
    ]);
  });

  test("FR-SCN-07 identical segments dedupe in either direction, in the batch and against the row", () => {
    const t = setup();
    t.addWalls([[0, 0, 2, 0]]);
    const r = t.addWalls([
      [2, 0, 0, 0],
      [0, 0, 0, 3],
      [0, 3, 0, 0],
    ]);
    expect(r).toEqual({ ns: [1, 2, 2] });
    expect(t.structure()?.walls).toEqual([
      [1, 0, 0, 2, 0],
      [2, 0, 0, 0, 3],
    ]);
    expect(t.lastEvent()?.payload).toMatchObject({ ns: [2] });
    // Nothing new → no write, no event.
    const rev = t.structure()?.rev;
    const n0 = t.events.length;
    expect(t.addWalls([[0, 3, 0, 0]])).toEqual({ ns: [2] });
    expect(t.structure()?.rev).toBe(rev);
    expect(t.events.length).toBe(n0);
  });

  test("FR-SCN-07 length 0 and out of bounds → invalid; nothing written", () => {
    const t = setup();
    // Goblin Ambush: 20 × 14 cells → vertices 0–20 × 0–14, ± 1 allowed.
    const a = t.err(() =>
      t.addWalls([
        [1, 1, 2, 2],
        [3, 3, 3, 3],
      ]),
    );
    expect(a.code).toBe("invalid");
    expect(a.issues?.[0]?.path).toEqual(["segments", 1]);
    expect(t.err(() => t.addWalls([[0, 0, 22, 0]])).code).toBe("invalid");
    expect(t.err(() => t.addWalls([[-2, 0, 0, 0]])).code).toBe("invalid");
    t.addWalls([[-1, -1, 21, 15]]);
    expect(t.structure()?.walls).toEqual([[1, -1, -1, 21, 15]]);
  });

  test("FR-SCN-07 ≤ 2,000 segments per scene, else conflict and nothing written", () => {
    const t = setup();
    // Distinct segments written directly (off the map: the cap counts, bounds don't).
    const walls = Array.from(
      { length: SEGMENTS_MAX - 1 },
      (_, i): Wall => [i + 1, 100 + i, 0, 100 + i, 1],
    );
    t.writeStructure(t.sid, walls, []);
    const before = t.structure();
    const e = t.err(() =>
      t.addWalls([
        [0, 0, 0, 1],
        [0, 1, 0, 2],
      ]),
    );
    expect(e).toMatchObject({ code: "conflict", message: SEGMENT_CAP_MESSAGE });
    expect(t.structure()).toEqual(before);
    t.addWalls([[0, 0, 0, 1]]);
    expect(t.structure()?.walls).toHaveLength(SEGMENTS_MAX);
    expect(t.err(() => t.addDoor([1, 0, 1, 1])).code).toBe("conflict");
  });
});

describe("FR-SCN-08 / -36 scn.addDoor", () => {
  test("FR-SCN-08 a door: closed by default, its own n, f = 0 without fog; ack {n}", () => {
    const t = setup();
    t.addWalls([[8, 0, 8, 5]]);
    expect(t.addDoor([8, 5, 8, 6])).toEqual({ n: 2 });
    expect(t.addDoor([8, 11, 8, 12], 2)).toEqual({ n: 3 });
    expect(t.structure()).toMatchObject({
      rev: 3,
      nextN: 4,
      doors: [
        [2, 8, 5, 8, 6, 1, 0],
        [3, 8, 11, 8, 12, 2, 0],
      ],
    });
    expect(t.lastEvent()?.payload).toEqual({ sceneId: t.sid, op: "addDoor", ns: [3] });
  });

  test("FR-SCN-07 a door on an existing wall or door → conflict", () => {
    const t = setup();
    t.addWalls([[8, 0, 8, 5]]);
    t.addDoor([8, 5, 8, 6]);
    for (const seg of [
      [8, 5, 8, 0],
      [8, 6, 8, 5],
    ] as Segment[]) {
      expect(t.err(() => t.addDoor(seg))).toMatchObject({
        code: "conflict",
        message: SEGMENT_TAKEN_MESSAGE,
      });
    }
    expect(t.err(() => t.addDoor([8, 7, 8, 7])).code).toBe("invalid");
  });

  test("FR-SCN-36 scn.addDoor sets f via derive before the write: 1 iff every doorCells cell is fogged", () => {
    const t = setup();
    const seen: string[] = [];
    // Test fog: every cell with col ≥ 8 is fogged.
    visibilityHooks.register({
      name: "test.fog",
      derive(read, obj) {
        seen.push(
          `${obj.type} ${JSON.stringify(obj.cells)} row=${readStructure(read, t.sid) ? 1 : 0}`,
        );
        const all = "col" in obj.cells ? obj.cells.col >= 8 : obj.cells.every(([c]) => c >= 8);
        return { fogged: all };
      },
    });
    t.addDoor([8, 5, 8, 6]); // cells (7, 5) and (8, 5): not all fogged
    t.addDoor([9, 5, 9, 6]); // cells (8, 5) and (9, 5): fogged
    expect(t.structure()?.doors.map((d) => d[6])).toEqual([0, 1]);
    expect(seen).toEqual([
      "scene-structure [[7,5],[8,5]] row=0",
      "scene-structure [[8,5],[9,5]] row=1",
    ]);
    // The redaction drops the f = 1 door for players.
    const p1 = t.h.viewer("player", t.h.p1.id);
    t.run(I.activateScene, { sceneId: t.sid });
    const [s] = t.h.snapshot(p1)[SCENE_STRUCTURE_TYPE] as PlayerSceneStructureRecord[];
    expect(s?.doors).toEqual([[1, 8, 5, 8, 6, 0]]);
  });
});

describe("FR-SCN-09 scn.setDoor", () => {
  test("FR-SCN-09 open / close / lock; f kept; same state → nothing; unknown or a wall's n → not_found", () => {
    const t = setup();
    t.writeStructure(t.sid);
    const rev = t.structure()?.rev as number;
    t.setDoor(4, 0);
    expect(t.structure()?.doors[0]).toEqual([4, 8, 5, 8, 6, 0, 0]);
    expect(t.structure()?.rev).toBe(rev + 1);
    expect(t.lastEvent()?.payload).toEqual({ sceneId: t.sid, op: "setDoor", ns: [4] });
    t.setDoor(5, 1);
    expect(t.structure()?.doors[1]).toEqual([5, 8, 11, 8, 12, 1, 0]);
    const n0 = t.events.length;
    t.setDoor(5, 1);
    expect(t.events.length).toBe(n0);
    expect(t.err(() => t.setDoor(99, 0)).code).toBe("not_found");
    expect(t.err(() => t.setDoor(1, 0)).code).toBe("not_found");
  });
});

describe("FR-SCN-08 scn.removeSegments", () => {
  test("FR-SCN-08 Erase removes walls and doors by n; any unknown n → not_found, nothing removed", () => {
    const t = setup();
    t.writeStructure(t.sid);
    const before = t.structure();
    expect(t.err(() => t.remove([1, 42])).code).toBe("not_found");
    expect(t.structure()).toEqual(before);
    t.remove([2, 5, 2]);
    expect(t.structure()).toMatchObject({
      walls: [
        [1, 8, 0, 8, 5],
        [3, 8, 12, 8, 14],
      ],
      doors: [[4, 8, 5, 8, 6, 1, 0]],
      nextN: 6,
    });
    expect(t.lastEvent()?.payload).toEqual({ sceneId: t.sid, op: "removeSegments", ns: [2, 5] });
    // n is never reused.
    expect(t.addWalls([[8, 6, 8, 11]])).toEqual({ ns: [6] });
  });

  test("SCN §11 two DM tabs editing by n keep each other's walls", () => {
    const t = setup();
    const a = t.addWalls([[0, 0, 1, 0]]).ns[0] as number;
    const b = t.addWalls([[0, 1, 1, 1]]).ns[0] as number;
    t.remove([a]);
    expect(t.structure()?.walls).toEqual([[b, 0, 1, 1, 1]]);
    expect(t.err(() => t.remove([a])).code).toBe("not_found");
  });
});

describe("FR-SCN-33 permissions and scope", () => {
  test("FR-SCN-33 players are refused every structure intent; another campaign's scene → not_found", () => {
    const t = setup();
    t.writeStructure(t.sid);
    const p1 = t.player(t.h.p1);
    for (const [name, input] of [
      [S.addWalls, { sceneId: t.sid, segments: [[0, 0, 1, 0]] }],
      [S.addDoor, { sceneId: t.sid, segment: [0, 0, 1, 0] }],
      [S.setDoor, { sceneId: t.sid, n: 4, state: 0 }],
      [S.removeSegments, { sceneId: t.sid, ns: [1] }],
    ] as const) {
      expect(t.err(() => t.run(name, input, p1)).code).toBe("forbidden");
    }
    const other = t.run<SceneRecord>(
      R.createScene,
      { name: "Elsewhere", mapAssetId: "art-other" },
      { role: "dm", playerId: null, campaignId: t.h.secondCampaignId },
    );
    expect(t.err(() => t.addWalls([[0, 0, 1, 0]], t.h.dm, other.id)).code).toBe("not_found");
    expect(t.structure(other.id)).toBeNull();
  });

  test("FR-SCN-33 / -14 players get doors only (locked as closed) and never the walls; the DM all", () => {
    const t = setup();
    t.run(I.activateScene, { sceneId: t.sid });
    t.writeStructure(t.sid);
    const p1 = t.h.viewer("player", t.h.p1.id);
    const dm = t.h.viewer("dm");
    for (const step of [
      () => t.setDoor(5, 1),
      () => t.setDoor(5, 2),
      () => t.addWalls([[0, 0, 1, 0]]),
    ]) {
      step();
      const ch = t.lastEvent()?.changes[0];
      if (!ch) throw new Error("no change");
      const w = t.s.records.filterChange(ch, p1);
      expect(w).toEqual({
        type: SCENE_STRUCTURE_TYPE,
        id: t.sid,
        op: "upsert",
        data: {
          id: t.sid,
          doors: [
            [4, 8, 5, 8, 6, 0],
            [5, 8, 11, 8, 12, 0],
          ],
        },
      });
      expect(JSON.stringify(w)).not.toContain("walls");
      expect(t.s.records.filterChange(ch, dm)?.data).toEqual(ch.after as SceneStructureRecord);
    }
    // A non-active scene's edit reaches no player.
    t.writeStructure(t.cellar.id);
    t.run(S.setDoor, { sceneId: t.cellar.id, n: 4, state: 0 });
    const ch = t.lastEvent()?.changes[0];
    if (!ch) throw new Error("no change");
    expect(t.s.records.filterChange(ch, p1)).toBeNull();
    expect(t.s.records.filterChange(ch, dm)?.op).toBe("upsert");
  });
});

describe("SCN §11 crash", () => {
  test("SCN §11 scn.addWalls: crash before commit → digest unchanged; after commit → row + log", () => {
    class Killed extends Error {}
    const kill = () => {
      throw new Killed();
    };
    const t = setup();
    const digest = stateDigest(t.s.db.$client).sha256;
    const log = readEventLog(t.s.db).length;
    armCrashHook({ point: "before-commit", target: S.addWalls }, kill);
    expect(() => t.addWalls([[0, 0, 1, 0]])).toThrow();
    expect(stateDigest(t.s.db.$client).sha256).toBe(digest);
    expect(t.structure()).toBeNull();
    armCrashHook({ point: "after-commit", target: S.addWalls }, kill);
    expect(() => t.addWalls([[0, 0, 1, 0]])).toThrow(Killed);
    armCrashHook(null);
    expect(t.structure()?.walls).toEqual([[1, 0, 0, 1, 0]]);
    expect(
      readEventLog(t.s.db)
        .slice(log)
        .map((l) => l.type),
    ).toEqual(["StructureEdited"]);
    t.addDoor([0, 2, 1, 2]);
    const after = stateDigest(t.s.db.$client).sha256;
    for (const [target, fn] of [
      [S.addDoor, () => t.addDoor([0, 1, 1, 1])],
      [S.setDoor, () => t.setDoor(2, 0)],
      [S.removeSegments, () => t.remove([1])],
    ] as const) {
      armCrashHook({ point: "before-commit", target }, kill);
      expect(fn).toThrow();
      expect(stateDigest(t.s.db.$client).sha256).toBe(after);
    }
  });
});
