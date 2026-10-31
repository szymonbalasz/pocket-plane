// Sprint 15 (BL-151), session-sim-17 (`.verify/20261031-102757-session-sim-17/`): b08 (player-1,
// 1280×720): the sheet remembered at 600 × 598, the sticky concentration card at home on a row's
// +4 button. b06 (player-2, 1280×800): the default sheet, the card clear of it. Rects read off the
// screenshots, the card 72 px tall as drawn.
import { describe, expect, test } from "bun:test";
import type { Rect } from "../play-shell/geometry";
import type { StackWindow } from "./keep-out";
import { STACK_W } from "./keep-out";
import { playerHome, playerStackSpot } from "./keep-out-player";

const hit = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const box = (p: { left: number; top: number }, h: number): Rect => ({
  x: p.left,
  y: p.top,
  w: STACK_W,
  h,
});

const CARD_H = 72;
const vp720 = { w: 1280, h: 720 };
/** b08: the row buttons as drawn, cut by the body's bottom at 642; the skills' +N column. */
const plus4 = { x: 1168, y: 627, w: 49, h: 15 };
const rowButtons: Rect[] = [
  { x: 1168, y: 543, w: 49, h: 28 },
  { x: 1168, y: 571, w: 49, h: 28 },
  { x: 1168, y: 599, w: 49, h: 28 },
  plus4,
  { x: 810, y: 600, w: 28, h: 26 },
];
const SHEET: StackWindow = {
  x: 650,
  y: 60,
  w: 600,
  h: 598,
  used: 658,
  controls: rowButtons,
};
const LOG: StackWindow = { x: 70, y: 510, w: 505, h: 195, used: 705 };
const PM: StackWindow = { x: 335, y: 150, w: 315, h: 355, used: 505 };
const INIT: StackWindow = { x: 70, y: 62, w: 276, h: 397, used: 459 };
const B08 = [INIT, PM, LOG, SHEET];

describe("FR-NOTE-83 a player's stack keeps off the sheet's row buttons", () => {
  test("FR-NOTE-83 BL-151 sim-17 b08 (1280×720, the sheet at 650, 60, 600 × 598): home sits on the +4; the card moves off every row button and stays off the Game log and the title bars", () => {
    const home = playerHome(vp720, CARD_H);
    expect(home).toEqual({ left: 944, top: 628 });
    expect(hit(box(home, CARD_H), plus4)).toBe(true);
    const at = playerStackSpot(vp720, CARD_H, B08);
    const r = box(at, CARD_H);
    for (const b of rowButtons) expect(hit(r, b)).toBe(false);
    expect(at.covers).toBe(0);
    expect(hit(r, LOG)).toBe(false);
    // Off the sheet's title bar, inside the viewport.
    expect(r.y).toBeGreaterThan(92);
    expect(r.y + r.h).toBeLessThanOrEqual(720 - 12);
    expect(r.x).toBeGreaterThanOrEqual(80);
  });

  test("FR-NOTE-83 BL-151 b06 (1280×800, the default sheet ending at 498): the corner is free, nothing moves", () => {
    const vp = { w: 1280, h: 800 };
    const sheet: StackWindow = { x: 950, y: 60, w: 318, h: 438, used: 498 };
    const log: StackWindow = { x: 68, y: 590, w: 510, h: 198, used: 788 };
    expect(playerStackSpot(vp, 92, [sheet, log])).toEqual({ ...playerHome(vp, 92), covers: 0 });
  });

  test("FR-NOTE-83 a window's empty body under the corner doesn't move it (FR-NOTE-75)", () => {
    const sheet: StackWindow = { x: 650, y: 60, w: 600, h: 650, used: 500, controls: [] };
    expect(playerStackSpot(vp720, CARD_H, [sheet])).toEqual({
      ...playerHome(vp720, CARD_H),
      covers: 0,
    });
  });

  test("FR-NOTE-83 free map beside the window: the nearest spot on no window (1440×900 and 1600×900, the sheet low on the right)", () => {
    for (const vp of [
      { w: 1440, h: 900 },
      { w: 1600, h: 900 },
    ]) {
      const sheet: StackWindow = { x: vp.w - 620, y: 240, w: 600, h: 598 };
      const at = playerStackSpot(vp, CARD_H, [sheet]);
      expect(hit(box(at, CARD_H), sheet)).toBe(false);
      expect(at.covers).toBe(0);
      expect(at.left).toBe(sheet.x - 12 - STACK_W);
    }
  });

  test("FR-NOTE-83 the slide never lands on a PC when another spot is clear", () => {
    const vp = { w: 1440, h: 900 };
    const sheet: StackWindow = { x: 820, y: 240, w: 600, h: 598 };
    const pc = { x: 600, y: 800, w: 44, h: 44 };
    const at = playerStackSpot(vp, CARD_H, [sheet], [], [], [pc]);
    expect(hit(box(at, CARD_H), pc)).toBe(false);
    expect(hit(box(at, CARD_H), sheet)).toBe(false);
  });

  test("FR-NOTE-83 a PC alone under the corner doesn't move it (BL-151 is about windows)", () => {
    const pc = { x: 1100, y: 640, w: 44, h: 44 };
    expect(playerStackSpot(vp720, CARD_H, [], [], [], [pc])).toEqual({
      ...playerHome(vp720, CARD_H),
      covers: 0,
    });
  });

  test("FR-NOTE-83 FR-NOTE-76 a modal dialog over the corner: the nearest spot off it (above, in the corner's column); the windows under its overlay don't count", () => {
    const dialog = { x: 700, y: 300, w: 560, h: 400 };
    const at = playerStackSpot(vp720, CARD_H, B08, [], [dialog]);
    expect(at).toMatchObject({ left: 944, top: 300 - 12 - CARD_H, covers: 0 });
    expect(hit(box(at, CARD_H), dialog)).toBe(false);
  });

  test("FR-NOTE-83 a tool bar is never covered: not at the corner, not in the slide", () => {
    const bar = { x: 900, y: 640, w: 360, h: 48 };
    const at = playerStackSpot(vp720, CARD_H, [], [bar]);
    expect(hit(box(at, CARD_H), bar)).toBe(false);
  });

  test("FR-NOTE-83 sibling, a stack too tall for any clear spot: `covers` > 0 lets the runtime fold; one card then fits (fold timing: each step re-places at its measured height)", () => {
    // One window over the whole work area, rows of buttons down its whole body.
    const rows: Rect[] = [];
    for (let y = 100; y < 700; y += 40) rows.push({ x: 80, y, w: 1180, h: 24 });
    const full: StackWindow = { x: 70, y: 60, w: 1200, h: 650, used: 710, controls: rows };
    const three = playerStackSpot(vp720, 3 * CARD_H + 16, [full]);
    expect(three.covers).toBeGreaterThan(0);
    const one = playerStackSpot(vp720, 30, [full]);
    expect(one.covers).toBeLessThan(three.covers);
  });

  test("FR-NOTE-83 no controls measured (the window not in the DOM yet): the whole window counts as content, still off its title bar", () => {
    const win: StackWindow = { x: 700, y: 60, w: 560, h: 650 };
    const r = box(playerStackSpot(vp720, CARD_H, [win]), CARD_H);
    expect(hit(r, win)).toBe(false);
    expect(r.x + r.w).toBeLessThanOrEqual(700);
  });

  test("FR-NOTE-83 stack height unmeasured: home", () => {
    expect(playerStackSpot(vp720, 0, B08)).toEqual({ ...playerHome(vp720, 0), covers: 0 });
  });
});
