import { describe, expect, test } from "bun:test";
import type { TokenSize } from "@shared/scenes-map/schemas";
import { cameraOn, contentBox, FIT_MARGIN, fitCamera, fitContent } from "./camera";

/** The `battlemap` fixture: 20 × 14 cells at 70 px, no offset. */
const GRID = { gridCellSize: 70, gridOffsetX: 0, gridOffsetY: 0 };
const MAP = { w: 1400, h: 980 };
const tok = (col: number, row: number, size: TokenSize = "medium") => ({ col, row, size });

/** Goblin Ambush in `session-sim`: Mira, Goblin, Goblin 2, Thorn; hidden Wolf, Elite. */
const VISIBLE = [tok(2, 7), tok(12, 6), tok(12, 8), tok(2, 9)];
const HIDDEN = [tok(14, 4), tok(15, 8)];

describe("FR-MAP-44 content box", () => {
  test("FR-MAP-44 content box: footprints + 1 cell per side (DM incl. hidden)", () => {
    expect(contentBox([...VISIBLE, ...HIDDEN], GRID, MAP)).toEqual({
      x: 70,
      y: 210,
      w: 1120,
      h: 560,
    });
  });

  test("FR-MAP-44 content box: the player's store only (hidden tokens never count)", () => {
    expect(contentBox(VISIBLE, GRID, MAP)).toEqual({ x: 70, y: 350, w: 910, h: 420 });
  });

  test("FR-MAP-44 content box: cut to the map", () => {
    expect(contentBox([tok(0, 0), tok(19, 13)], GRID, MAP)).toEqual({ x: 0, y: 0, ...MAP });
  });

  test("FR-MAP-44 content box: no tokens → the map", () => {
    expect(contentBox([], GRID, MAP)).toEqual({ x: 0, y: 0, ...MAP });
  });

  test("FR-MAP-44 content box: Large footprint (2 × 2) and grid offset", () => {
    const g = { ...GRID, gridOffsetX: 10, gridOffsetY: 20 };
    expect(contentBox([tok(5, 5, "large")], g, MAP)).toEqual({ x: 290, y: 300, w: 280, h: 280 });
  });

  test("FR-MAP-44 content box: only tokens off the map → the map", () => {
    expect(contentBox([tok(40, 40)], GRID, MAP)).toEqual({ x: 0, y: 0, ...MAP });
  });
});

describe("FR-MAP-44 fit", () => {
  const work = { w: 1440, h: 788 };
  const cap = fitCamera(MAP, work).scale;

  test("FR-MAP-44 scale cap: never above the whole-map fit into the work area", () => {
    const free = { x: 68, y: 48, w: 1372, h: 788 };
    const one = contentBox([tok(10, 7)], GRID, MAP);
    const cam = fitContent(one, free, MAP, work);
    // One token: that zoom, centred in the free area.
    expect(cam.scale).toBe(cap);
    expect(cam.x + (one.x + one.w / 2) * cam.scale).toBeCloseTo(68 + 1372 / 2);
    expect(cam.y + (one.y + one.h / 2) * cam.scale).toBeCloseTo(48 + 788 / 2);
    // Pre-R1 the scene opened at the viewport fit: never zoom in beyond that either.
    expect(cam.scale).toBeLessThanOrEqual(fitCamera(MAP, { w: 1440, h: 900 }).scale);
  });

  test("FR-MAP-44 fit: the box fills the free area minus 16 px, centred", () => {
    const free = { x: 68, y: 48, w: 600, h: 400 };
    const box = contentBox([...VISIBLE, ...HIDDEN], GRID, MAP);
    const cam = fitContent(box, free, MAP, work);
    expect(cam.scale).toBeCloseTo((600 - 2 * FIT_MARGIN) / box.w);
    const left = cam.x + box.x * cam.scale;
    const right = cam.x + (box.x + box.w) * cam.scale;
    expect(left).toBeCloseTo(68 + FIT_MARGIN);
    expect(right).toBeCloseTo(68 + 600 - FIT_MARGIN);
    const top = cam.y + box.y * cam.scale;
    const bottom = cam.y + (box.y + box.h) * cam.scale;
    expect(top - 48).toBeCloseTo(48 + 400 - bottom);
  });
});

describe("FR-MAP-44/45 camera triggers", () => {
  test("FR-MAP-44 triggers: scene open fits; appearance refits only while fitted", () => {
    expect(cameraOn("moved", "open")).toEqual({ mode: "fitted", fit: true });
    expect(cameraOn("fitted", "appearance")).toEqual({ mode: "fitted", fit: true });
    expect(cameraOn("moved", "appearance")).toEqual({ mode: "moved", fit: false });
  });

  test("FR-MAP-44 triggers: pan, wheel zoom and pull mark the camera moved; no refit after", () => {
    for (const e of ["pan", "zoom", "pull"] as const) {
      const after = cameraOn("fitted", e);
      expect(after).toEqual({ mode: "moved", fit: false });
      expect(cameraOn(after.mode, "appearance").fit).toBe(false);
    }
  });

  test("FR-MAP-45 fit button refits from moved (camera only: no live input, works while not live)", () => {
    expect(cameraOn("moved", "fit")).toEqual({ mode: "fitted", fit: true });
    expect(cameraOn(cameraOn("moved", "fit").mode, "appearance").fit).toBe(true);
  });
});
