// FR-SCN-57: windows and one-way walls. Every kind blocks moves both ways; only sight tells them
// apart: a window never blocks it, a one-way wall only for a viewer on the left of its direction
// as seen on screen. The old wall shape stays valid.
import { describe, expect, test } from "bun:test";
import { pointInPolygon, prepareOccluders, sightPolygon } from "@shared/fog-of-war/vision";
import { blockingSegments, moveBlocked, sightOccluders, wallHint } from "./geometry";
import { AddWallsInput, WALL_ONE_WAY, WALL_WINDOW, Wall } from "./schemas";

// x = 8, y 0–10, drawn downwards: its left on screen is east, so sight passes west → east.
const PLAIN: Wall = [1, 8, 0, 8, 10];
const WINDOW: Wall = [1, 8, 0, 8, 10, WALL_WINDOW];
const ONE_WAY: Wall = [1, 8, 0, 8, 10, WALL_ONE_WAY];
const WEST = { x: 5, y: 5 };
const EAST = { x: 11, y: 5 };

function sees(walls: Wall[], from: { x: number; y: number }, to: { x: number; y: number }) {
  const poly = sightPolygon(from, 40, sightOccluders({ walls, doors: [] })) as number[];
  return pointInPolygon(poly, to.x, to.y);
}

describe("FR-SCN-57 wall kinds", () => {
  test("FR-SCN-57 the wall tuple: kind optional, 1 window or 2 one-way, nothing else", () => {
    expect(Wall.safeParse(PLAIN).success).toBe(true);
    expect(Wall.safeParse(WINDOW).success).toBe(true);
    expect(Wall.safeParse(ONE_WAY).success).toBe(true);
    expect(Wall.safeParse([1, 8, 0, 8, 10, 3]).success).toBe(false);
    expect(Wall.safeParse([1, 8, 0, 8, 10, 0]).success).toBe(false);
    expect(AddWallsInput.safeParse({ sceneId: "s", segments: [[0, 0, 1, 0]] }).success).toBe(true);
    expect(
      AddWallsInput.safeParse({ sceneId: "s", segments: [[0, 0, 1, 0]], kind: 3 }).success,
    ).toBe(false);
  });

  test("FR-SCN-57 sight: a plain wall blocks both ways, a window neither", () => {
    expect(sees([PLAIN], WEST, EAST)).toBe(false);
    expect(sees([PLAIN], EAST, WEST)).toBe(false);
    expect(sees([WINDOW], WEST, EAST)).toBe(true);
    expect(sees([WINDOW], EAST, WEST)).toBe(true);
  });

  test("FR-SCN-57 sight: a one-way wall passes it only the way it points; reversed, the other way", () => {
    expect(sees([ONE_WAY], WEST, EAST)).toBe(true);
    expect(sees([ONE_WAY], EAST, WEST)).toBe(false);
    const reversed: Wall = [1, 8, 10, 8, 0, WALL_ONE_WAY];
    expect(sees([reversed], WEST, EAST)).toBe(false);
    expect(sees([reversed], EAST, WEST)).toBe(true);
  });

  test("FR-SCN-57 a viewer standing on a one-way wall's line sees both sides, like any wall", () => {
    expect(sees([ONE_WAY], { x: 8, y: 5 }, EAST)).toBe(true);
    expect(sees([ONE_WAY], { x: 8, y: 5 }, WEST)).toBe(true);
  });

  test("FR-SCN-57 another wall behind a one-way wall still cuts sight; prepared occluders agree", () => {
    const behind: Wall = [2, 10, 0, 10, 10];
    expect(sees([ONE_WAY, behind], WEST, EAST)).toBe(false);
    expect(sees([ONE_WAY, behind], WEST, { x: 9, y: 5 })).toBe(true);
    const segs = sightOccluders({ walls: [ONE_WAY, behind], doors: [] });
    expect(sightPolygon(WEST, 40, prepareOccluders(segs))).toEqual(sightPolygon(WEST, 40, segs));
  });

  test("FR-SCN-57 a one-way wall crossing a plain one: each viewer gets the right side", () => {
    const cross: Wall = [2, 0, 5, 16, 5];
    const north = { x: 5, y: 2 };
    // North-west sees through the one-way wall east, but the plain one still stops it going south.
    expect(sees([ONE_WAY, cross], north, { x: 11, y: 2 })).toBe(true);
    expect(sees([ONE_WAY, cross], north, { x: 11, y: 8 })).toBe(false);
    expect(sees([ONE_WAY, cross], { x: 11, y: 2 }, north)).toBe(false);
  });

  test("FR-SCN-57 moves: every kind blocks both ways; the hint names the piece", () => {
    const from = { col: 5, row: 5 };
    const to = { col: 10, row: 5 };
    for (const w of [PLAIN, WINDOW, ONE_WAY]) {
      expect(moveBlocked(from, to, 1, [w], [])).toBe(true);
      expect(moveBlocked(to, from, 1, [w], [])).toBe(true);
      expect(blockingSegments(from, to, 1, [w], [])).toEqual([1]);
      expect(wallHint(from, to, 1, [w], [])).toEqual([8, 5, 8, 6]);
    }
  });

  test("FR-SCN-57 occluders: plain as before, windows left out, one-way flagged, order kept", () => {
    expect(
      sightOccluders({
        walls: [PLAIN, [2, 1, 1, 2, 2, WALL_WINDOW], [3, 3, 3, 4, 4, WALL_ONE_WAY]],
        doors: [
          [4, 5, 5, 6, 6, 1, 0],
          [5, 7, 7, 8, 8, 0, 0],
        ],
      }),
    ).toEqual([
      [8, 0, 8, 10],
      [3, 3, 4, 4, 1],
      [5, 5, 6, 6],
    ]);
  });
});
