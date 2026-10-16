// FR-FOG-10 / -34 / -46 copies (V0, static only): `subjectCopies` against a scene's static state.
import { describe, expect, test } from "bun:test";
import { uniformMask } from "@shared/fog-of-war/mask";
import type { FogLayerShape } from "@shared/fog-of-war/shapes";
import { cellCentres, type SceneStatic, sameSeenBy, subjectCopies } from "./derive";

/** Fogged base; a reveal rect over cells (0..3) × (0..3); darkness over cell (1, 1). */
function scene(players: string[]): SceneStatic {
  const shapes: FogLayerShape[] = [{ op: "reveal", rect: [0, 0, 4, 4] }];
  return {
    sceneId: "s",
    campaignId: "c",
    mask: uniformMask("fog", [0, 0, 20, 20]),
    shapes,
    darkness: [{ id: "d1", circle: [1.5, 1.5, 0.5] }],
    players,
  };
}
const block = (col: number, row: number, n = 1) => ({ col, row, w: n, h: n });
const tok = (col: number, row: number, extra = {}) => ({
  type: "token",
  sceneId: "s",
  cells: block(col, row),
  ownerPlayerId: null,
  ...extra,
});

describe("FR-FOG-10 subject copies (static)", () => {
  const st = scene(["p1", "p2"]);

  test("FR-FOG-34 unowned: every player iff a sample point is statically clear and not in darkness", () => {
    expect(subjectCopies(st, tok(0, 0))).toEqual({ fogged: false, seenBy: ["p1", "p2"] });
    expect(subjectCopies(st, tok(10, 10))).toEqual({ fogged: true, seenBy: [] });
    // Darkness covers the only sample point (centre (1.5, 1.5)).
    expect(subjectCopies(st, tok(1, 1))).toEqual({ fogged: true, seenBy: [] });
    // A Large token with one cell clear: seen (FR-FOG-34 any sample point).
    expect(subjectCopies(st, { ...tok(3, 3), cells: block(3, 3, 2) })).toEqual({
      fogged: false,
      seenBy: ["p1", "p2"],
    });
  });

  test("FR-FOG-34 owned: owner + party always; fogged = statically hidden (sprint 2's value)", () => {
    expect(subjectCopies(st, tok(10, 10, { ownerPlayerId: "p1" }))).toEqual({
      fogged: true,
      seenBy: ["p1", "p2"],
    });
    expect(subjectCopies(st, tok(0, 0, { ownerPlayerId: "p2" }))).toEqual({
      fogged: false,
      seenBy: ["p1", "p2"],
    });
  });

  test("FR-FOG-46 unowned invisible: nobody (no source sees invisible in V0), fogged even in clear area", () => {
    expect(subjectCopies(st, tok(0, 0, { invisible: true }))).toEqual({ fogged: true, seenBy: [] });
    // Owned invisible: party rule unchanged.
    expect(subjectCopies(st, tok(0, 0, { invisible: true, ownerPlayerId: "p1" })).seenBy).toEqual([
      "p1",
      "p2",
    ]);
  });

  test("FR-FOG-10 player-placed template: not a fog subject (every player), fogged = static copy", () => {
    const t = { type: "aoe-template", sceneId: "s", cells: [[10, 10]] as [number, number][] };
    expect(subjectCopies(st, { ...t, placedByPlayerId: "p2" })).toEqual({
      fogged: true,
      seenBy: ["p1", "p2"],
    });
    expect(subjectCopies(st, { ...t, placedByPlayerId: null })).toEqual({
      fogged: true,
      seenBy: [],
    });
  });

  test("FR-FOG-10 a campaign with no players: fogged = statically hidden, seenBy []", () => {
    const none = scene([]);
    expect(subjectCopies(none, tok(0, 0))).toEqual({ fogged: false, seenBy: [] });
    expect(subjectCopies(none, tok(10, 10))).toEqual({ fogged: true, seenBy: [] });
  });

  test("FR-SCN-36 doors: explicit sample points (either side) instead of cell centres", () => {
    const door = {
      type: "scene-structure",
      sceneId: "s",
      cells: [],
      points: [
        [3.5, 2.5],
        [4.5, 2.5],
      ] as [number, number][],
    };
    expect(subjectCopies(st, door).seenBy).toEqual(["p1", "p2"]);
    expect(subjectCopies(st, { ...door, points: [[9.5, 9.5]] as [number, number][] }).fogged).toBe(
      true,
    );
  });

  test("helpers: cell centres; seenBy compare is order-insensitive, null never equal", () => {
    expect(cellCentres(block(2, 3, 2))).toEqual([
      [2.5, 3.5],
      [3.5, 3.5],
      [2.5, 4.5],
      [3.5, 4.5],
    ]);
    expect(sameSeenBy(["a", "b"], ["b", "a"])).toBe(true);
    expect(sameSeenBy(null, [])).toBe(false);
    expect(sameSeenBy(["a"], ["a", "b"])).toBe(false);
  });
});
