// FR-SCN-61–63: windows and one-way walls on the server. `scn.addWalls` stores the kind (dedupe per
// kind); with `replace` a segment takes the place of the differing wall under it, leaving pieces
// of their kind that run the way their wall did; `scn.flipWalls` reverses one-way walls in place.
// The wall guard refuses players at every kind both ways, never the DM; sight reads the kinds
// from the row; players never receive any of it.
import { describe, expect, test } from "bun:test";
import { pointInPolygon, sourcePolygons } from "@shared/fog-of-war/vision";
import {
  type AddDoorResult,
  type AddWallsResult,
  WALL_ONE_WAY as ONE_WAY,
  SCN_INTENTS as S,
  SCENE_STRUCTURE_TYPE,
  type Segment,
  type Wall,
  type WallKind,
  WALL_WINDOW as WINDOW,
} from "@shared/scene-tools/schemas";
import { MAP_INTENTS as I } from "@shared/scenes-map/schemas";
import { sceneOccluders } from "../fog-of-war/sight";
import { WALL_BLOCKED } from "./guard";
import { readStructure } from "./rows";
import { NOT_ONE_WAY_MESSAGE } from "./structure";
import { scnSetup } from "./testing";

function setup() {
  const t = scnSetup();
  const sid = t.ambush.id;
  const walls = (): Wall[] => readStructure(t.s.db, sid)?.walls ?? [];
  const add = (segments: Segment[], kind?: WallKind, replace?: boolean) =>
    t.run<AddWallsResult>(S.addWalls, {
      sceneId: sid,
      segments,
      ...(kind ? { kind } : {}),
      ...(replace ? { replace } : {}),
    });
  const flip = (ns: number[]) => t.run(S.flipWalls, { sceneId: sid, ns });
  const lastEvent = () => t.events.at(-1)?.event;
  return { ...t, sid, walls, add, flip, lastEvent };
}

describe("FR-SCN-61 scn.addWalls kinds", () => {
  test("FR-SCN-61 stores the kind and the drawn direction; a plain wall's tuple is unchanged", () => {
    const t = setup();
    t.add([[8, 0, 8, 5]]);
    t.add([[9, 5, 9, 0]], WINDOW);
    t.add([[10, 5, 10, 0]], ONE_WAY);
    expect(t.walls()).toEqual([
      [1, 8, 0, 8, 5],
      [2, 9, 5, 9, 0, WINDOW],
      [3, 10, 5, 10, 0, ONE_WAY],
    ]);
    expect(t.lastEvent()?.payload).toEqual({ sceneId: t.sid, op: "addWalls", ns: [3] });
  });

  test("FR-SCN-07 dedupe is per kind: the same kind gets the old n, another kind its own", () => {
    const t = setup();
    expect(t.add([[8, 0, 8, 5]], WINDOW)).toEqual({ ns: [1] });
    expect(t.add([[8, 5, 8, 0]], WINDOW)).toEqual({ ns: [1] });
    expect(t.add([[8, 0, 8, 5]])).toEqual({ ns: [2] });
  });

  test("FR-SCN-07 a segment identical to a door still gets the door's n, whatever its kind", () => {
    const t = setup();
    const { n } = t.run<AddDoorResult>(S.addDoor, { sceneId: t.sid, segment: [8, 5, 8, 6] });
    expect(t.add([[8, 5, 8, 6]], WINDOW)).toEqual({ ns: [n] });
    expect(t.add([[8, 6, 8, 5]], ONE_WAY, true)).toEqual({ ns: [n] });
    expect(t.walls()).toEqual([]);
  });
});

describe("FR-SCN-62 drawing over a wall", () => {
  test("FR-SCN-62 without replace nothing is cut: both stand", () => {
    const t = setup();
    t.add([[8, 0, 8, 10]]);
    expect(t.add([[8, 4, 8, 5]], WINDOW)).toEqual({ ns: [2] });
    expect(t.walls()).toHaveLength(2);
  });

  test("FR-SCN-62 a window mid-wall replaces that section: two pieces, ack for undo, one event", () => {
    const t = setup();
    t.add([[8, 0, 8, 10]]);
    const n0 = t.events.length;
    expect(t.add([[8, 4, 8, 5]], WINDOW, true)).toEqual({
      ns: [4],
      replaced: [[1, 8, 0, 8, 10]],
      pieces: [2, 3],
    });
    expect(t.walls()).toEqual([
      [2, 8, 0, 8, 4],
      [3, 8, 5, 8, 10],
      [4, 8, 4, 8, 5, WINDOW],
    ]);
    expect(t.events.length).toBe(n0 + 1);
    expect(t.lastEvent()?.payload).toEqual({ sceneId: t.sid, op: "addWalls", ns: [4, 1, 2, 3] });
  });

  test("FR-SCN-62 the undo steps give back the wall as it was, even an identical one", () => {
    const t = setup();
    t.add([[8, 0, 8, 1]]);
    const r = t.add([[8, 0, 8, 1]], WINDOW, true);
    expect(r).toEqual({ ns: [2], replaced: [[1, 8, 0, 8, 1]], pieces: [] });
    // As the client sends them: re-add first (never `replace`), then remove what was drawn.
    t.add([[8, 0, 8, 1]]);
    t.run(S.removeSegments, { sceneId: t.sid, ns: [2] });
    expect(t.walls()).toEqual([[3, 8, 0, 8, 1]]);
  });

  test("FR-SCN-62 a plain wall drawn over a window takes its place; the same kind is left alone", () => {
    const t = setup();
    t.add([[8, 0, 8, 10]], WINDOW);
    expect(t.add([[8, 4, 8, 5]], WINDOW, true)).toEqual({ ns: [2] });
    expect(t.walls()).toHaveLength(2);
    const r = t.add([[8, 0, 8, 10]], undefined, true);
    expect(r.replaced?.map((w) => w[0]).sort()).toEqual([1, 2]);
    expect(t.walls()).toEqual([[3, 8, 0, 8, 10]]);
  });

  test("FR-SCN-62 a polyline over one wall: later segments cut the pieces too; only the old wall is reported", () => {
    const t = setup();
    t.add([[8, 0, 8, 10]]);
    const r = t.add(
      [
        [8, 2, 8, 4],
        [8, 4, 8, 6],
      ],
      WINDOW,
      true,
    );
    expect(r.replaced).toEqual([[1, 8, 0, 8, 10]]);
    const byN = new Map(t.walls().map((w) => [w[0], w.slice(1)]));
    expect(r.ns.map((n) => byN.get(n))).toEqual([
      [8, 2, 8, 4, WINDOW],
      [8, 4, 8, 6, WINDOW],
    ]);
    expect(r.pieces?.map((n) => byN.get(n))).toEqual([
      [8, 0, 8, 2],
      [8, 6, 8, 10],
    ]);
    expect(t.walls()).toHaveLength(4);
  });

  test("FR-SCN-62 one-way pieces keep their kind and direction, also under a segment drawn the other way", () => {
    const t = setup();
    t.add([[8, 10, 8, 0]], ONE_WAY);
    t.add([[8, 4, 8, 5]], WINDOW, true);
    expect(t.walls().map((w) => w.slice(1))).toEqual([
      [8, 4, 8, 0, ONE_WAY],
      [8, 10, 8, 5, ONE_WAY],
      [8, 4, 8, 5, WINDOW],
    ]);
  });

  test("FR-SCN-62 a one-way wall drawn back over itself reverses; the same way is a no-op", () => {
    const t = setup();
    t.add([[8, 0, 8, 5]], ONE_WAY);
    const rev = readStructure(t.s.db, t.sid)?.rev;
    expect(t.add([[8, 0, 8, 5]], ONE_WAY, true)).toEqual({ ns: [1] });
    expect(readStructure(t.s.db, t.sid)?.rev).toBe(rev);
    expect(t.add([[8, 5, 8, 0]], ONE_WAY, true)).toEqual({
      ns: [2],
      replaced: [[1, 8, 0, 8, 5, ONE_WAY]],
      pieces: [],
    });
    expect(t.walls()).toEqual([[2, 8, 5, 8, 0, ONE_WAY]]);
  });

  test("FR-SCN-56 a door keeps the kind and direction of what it cuts", () => {
    const t = setup();
    t.add([[8, 10, 8, 0]], ONE_WAY);
    const r = t.run<AddDoorResult>(S.addDoor, { sceneId: t.sid, segment: [8, 4, 8, 5] });
    expect(r.replaced).toEqual([[1, 8, 10, 8, 0, ONE_WAY]]);
    expect(t.walls().map((w) => w.slice(1))).toEqual([
      [8, 4, 8, 0, ONE_WAY],
      [8, 10, 8, 5, ONE_WAY],
    ]);
  });
});

describe("FR-SCN-63 scn.flipWalls", () => {
  test("FR-SCN-63 reverses in place: same n, one StructureEdited; twice = back", () => {
    const t = setup();
    t.add([[8, 0, 8, 5]], ONE_WAY);
    const rev = readStructure(t.s.db, t.sid)?.rev as number;
    t.flip([1]);
    expect(t.walls()).toEqual([[1, 8, 5, 8, 0, ONE_WAY]]);
    expect(readStructure(t.s.db, t.sid)?.rev).toBe(rev + 1);
    expect(t.lastEvent()?.type).toBe("StructureEdited");
    expect(t.lastEvent()?.payload).toEqual({ sceneId: t.sid, op: "flipWalls", ns: [1] });
    t.flip([1]);
    expect(t.walls()).toEqual([[1, 8, 0, 8, 5, ONE_WAY]]);
  });

  test("FR-SCN-63 refuses what isn't one-way and any unknown n, changing nothing; DM only", () => {
    const t = setup();
    t.add([[8, 0, 8, 5]], ONE_WAY);
    t.add([[9, 0, 9, 5]]);
    t.add([[10, 0, 10, 5]], WINDOW);
    const before = t.walls();
    for (const n of [2, 3]) {
      const e = t.err(() => t.flip([1, n]));
      expect(e.code).toBe("invalid");
      expect(e.message).toBe(NOT_ONE_WAY_MESSAGE);
    }
    expect(t.err(() => t.flip([1, 99])).code).toBe("not_found");
    expect(
      t.err(() => t.run(S.flipWalls, { sceneId: t.sid, ns: [1] }, t.player(t.h.p1))).code,
    ).toBe("forbidden");
    expect(t.walls()).toEqual(before);
  });
});

describe("FR-SCN-61 everyone else", () => {
  function withMira() {
    const t = setup();
    t.run(I.activateScene, { sceneId: t.sid });
    const mira = t.run<{ tokenId: string }>(I.placeToken, {
      sceneId: t.sid,
      definitionId: t.miraId,
      col: 7,
      row: 7,
    }).tokenId;
    return { ...t, mira, p1: t.player(t.h.p1) };
  }

  test("FR-SCN-61 / FR-SCN-10 a player can't walk through a window or a one-way wall, either way; the DM can", () => {
    const cases: [Segment, WallKind][] = [
      [[8, 6, 8, 9], WINDOW],
      [[8, 6, 8, 9], ONE_WAY],
      [[8, 9, 8, 6], ONE_WAY],
    ];
    for (const [seg, kind] of cases) {
      const t = withMira();
      t.add([seg], kind);
      const there = t.err(() => t.run(I.moveToken, { tokenId: t.mira, col: 9, row: 7 }, t.p1));
      expect(there.code).toBe("conflict");
      expect(there.message).toBe(WALL_BLOCKED);
      // The DM drags through; then the player can't get back either; the DM drags back.
      t.run(I.moveToken, { tokenId: t.mira, col: 9, row: 7 });
      const back = t.err(() => t.run(I.moveToken, { tokenId: t.mira, col: 7, row: 7 }, t.p1));
      expect(back.message).toBe(WALL_BLOCKED);
      t.run(I.moveToken, { tokenId: t.mira, col: 7, row: 7 });
    }
  });

  test("FR-SCN-61 sight reads the kinds from the row, and a flip turns it round", () => {
    const t = setup();
    const senses = { darkvisionFt: 0, seesMagicalDarkness: false };
    const sees = (x: number, tx: number) => {
      const [poly] = sourcePolygons(sceneOccluders(t.s.db, t.sid, []), { x, y: 7.5, senses });
      return pointInPolygon(poly as number[], tx, 7.5);
    };
    t.add([[8, 0, 8, 14]]);
    expect(sees(5.5, 10.5)).toBe(false);
    t.run(S.removeSegments, { sceneId: t.sid, ns: [1] });
    t.add([[8, 0, 8, 14]], WINDOW);
    expect(sees(5.5, 10.5)).toBe(true);
    expect(sees(10.5, 5.5)).toBe(true);
    t.run(S.removeSegments, { sceneId: t.sid, ns: [2] });
    t.add([[8, 0, 8, 14]], ONE_WAY);
    expect(sees(5.5, 10.5)).toBe(true);
    expect(sees(10.5, 5.5)).toBe(false);
    t.flip([3]);
    expect(sees(5.5, 10.5)).toBe(false);
    expect(sees(10.5, 5.5)).toBe(true);
  });

  test("FR-SCN-14 players get no walls of any kind, and no sign of a flip", () => {
    const t = setup();
    t.run(I.activateScene, { sceneId: t.sid });
    t.add([[8, 0, 8, 5]], ONE_WAY);
    t.add([[9, 0, 9, 5]], WINDOW);
    t.flip([1]);
    const ch = t.lastEvent()?.changes[0];
    if (!ch) throw new Error("no change");
    const p1 = t.h.viewer("player", t.h.p1.id);
    expect(t.s.records.view(SCENE_STRUCTURE_TYPE, ch.after, p1).data).toEqual({
      id: t.sid,
      doors: [],
    });
    expect(t.s.records.classifyChange(ch, p1)).toBe("same");
  });
});
