// Sprint 15 (BL-175), session-sim-17 at DM 1440×900 (`.verify/20261031-102757-session-sim-17/`):
// v12 and k01, the summary + three cards at home over the tokens east of the wall (none of them a
// PC), the PCs west of it. Token rects from the DM's captured token records (cells at 36 px, map
// origin 328, 122; Mira at col 3, row 6), footprint + 4 px for the PCs.
import { describe, expect, test } from "bun:test";
import type { Rect } from "../play-shell/geometry";
import { dmStackSpot, STACK_W, type StackWindow } from "./keep-out";

const vp = { w: 1440, h: 900 };
const hit = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const box = (p: { left: number; top: number }, h: number, w = STACK_W): Rect => ({
  x: p.left,
  y: p.top,
  w,
  h,
});
/** A PC at a cell of the v12 map, as the runtime reads it (footprint + 4 px). */
const pc = (col: number, row: number): Rect => ({
  x: 328 + 36 * col - 4,
  y: 122 + 36 * row - 4,
  w: 44,
  h: 44,
});

const INIT = { x: 1030, y: 60, w: 398, h: 536 };
const LOG: StackWindow = { x: 70, y: 610, w: 1146, h: 278, used: 888 };
/** v12: the summary + three cards as drawn. */
const STACK_H = 348;
const WEST_PCS = [pc(3, 6), pc(3, 8), pc(4, 10)];

describe("FR-NOTE-80 the DM stack keeps off the PCs where a clear spot exists", () => {
  test("FR-NOTE-80 sim-17 v12 (1440×900): the PCs west of the wall leave the three cards at home; other tokens under them don't move it", () => {
    const at = dmStackSpot(vp, INIT, STACK_H, STACK_W, [], [LOG], [], [], [], WEST_PCS);
    expect(at).toMatchObject({ left: 560, top: 100, covers: 0 });
    for (const p of WEST_PCS) expect(hit(box(at, STACK_H), p)).toBe(false);
  });

  test("FR-NOTE-80 a PC under home (Thorn east of the wall, col 10, row 4): the left-of-Initiative column clears it; before, the stack stayed on it", () => {
    const thorn = pc(10, 4);
    // Today's rule without the PCs: home, on Thorn.
    const before = dmStackSpot(vp, INIT, STACK_H, STACK_W, [], [LOG]);
    expect(before).toMatchObject({ left: 560, top: 100 });
    expect(hit(box(before, STACK_H), thorn)).toBe(true);
    const at = dmStackSpot(vp, INIT, STACK_H, STACK_W, [], [LOG], [], [], [], [...WEST_PCS, thorn]);
    expect(at.covers).toBe(0);
    for (const p of [...WEST_PCS, thorn]) expect(hit(box(at, STACK_H), p)).toBe(false);
    for (const w of [INIT, LOG]) expect(hit(box(at, STACK_H), w)).toBe(false);
  });

  test("FR-NOTE-80 a summary alone over a PC moves down below it, in the column: the nearest clear spot", () => {
    const thorn = { x: 700, y: 110, w: 44, h: 44 };
    const at = dmStackSpot(vp, INIT, 58, STACK_W, [], [LOG], [], [], [], [thorn]);
    expect(at).toMatchObject({ left: 560, top: 166 });
    expect(hit(box(at, 58), thorn)).toBe(false);
  });

  test("FR-NOTE-80 PCs across both column lefts: a slide beside the PC itself holds the stack, left of it, on no window", () => {
    // A row of PCs through the band at every top the 348-px stack can take above the Game log.
    const across = [
      { x: 620, y: 220, w: 44, h: 44 },
      { x: 860, y: 220, w: 44, h: 44 },
    ];
    const at = dmStackSpot(vp, INIT, STACK_H, STACK_W, [], [LOG], [], [], [], across);
    expect(at.left).toBe(620 - 12 - STACK_W);
    for (const p of across) expect(hit(box(at, STACK_H), p)).toBe(false);
    expect(hit(box(at, STACK_H), LOG)).toBe(false);
    expect(at.left).toBeGreaterThanOrEqual(80);
  });

  test("FR-NOTE-80 no clear spot (PCs across the whole band): today's rule stands, the least PC area at the column; no fold for a PC (`covers` counts windows only)", () => {
    const wall: Rect[] = [];
    for (let x = 80; x < 1030; x += 60) wall.push({ x, y: 220, w: 44, h: 44 });
    const at = dmStackSpot(vp, INIT, STACK_H, STACK_W, [], [LOG], [], [], [], wall);
    expect(at).toMatchObject({ left: 560, covers: 0 });
    expect(at.top).toBe(100);
  });

  test("FR-NOTE-80 a window's first rows still beat a PC: with Rules over the column and a PC beside it, the stack doesn't take its heading", () => {
    const rules: StackWindow = {
      x: 430,
      y: 60,
      w: 560,
      h: 540,
      used: 600,
      head: 200,
      primary: [{ x: 440, y: 100, w: 400, h: 30 }],
    };
    const thorn = { x: 300, y: 110, w: 44, h: 44 };
    const at = dmStackSpot(vp, INIT, 58, STACK_W, [], [rules, LOG], [], [], [], [thorn]);
    const r = box(at, 58);
    expect(hit(r, thorn)).toBe(false);
    expect(hit(r, { x: 440, y: 100, w: 400, h: 30 })).toBe(false);
  });

  test("FR-NOTE-80 no PCs: nothing moves (home, and the shortcut stands)", () => {
    expect(dmStackSpot(vp, null, 58)).toMatchObject({ left: 560, top: 100, covers: 0 });
    expect(dmStackSpot(vp, INIT, STACK_H, STACK_W, [], [LOG])).toMatchObject({
      left: 560,
      top: 100,
    });
  });

  test("FR-NOTE-80 round trip: at 1280×720 and 1600×900 a PC under home moves the summary off it and home holds without one", () => {
    for (const [v, init, log] of [
      [
        { w: 1280, h: 720 },
        { x: 868, y: 60, w: 400, h: 500 },
        { x: 68, y: 508, w: 688, h: 200 },
      ],
      [
        { w: 1600, h: 900 },
        { x: 1188, y: 60, w: 400, h: 536 },
        { x: 68, y: 610, w: 1150, h: 278 },
      ],
    ] as const) {
      const home = Math.round((v.w - STACK_W) / 2);
      const thorn = { x: home + 100, y: 110, w: 44, h: 44 };
      expect(dmStackSpot(v, init, 58, STACK_W, [], [log])).toMatchObject({ left: home, top: 100 });
      const at = dmStackSpot(v, init, 58, STACK_W, [], [log], [], [], [], [thorn]);
      expect(at).toMatchObject({ left: home, top: 166 });
    }
  });
});
