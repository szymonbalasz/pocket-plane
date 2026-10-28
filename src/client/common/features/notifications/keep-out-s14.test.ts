// Sprint 14 F2 (BL-130), exact rects from session-sim-16 (sprint 12 main, before DM #364's
// longer slide): the DM stack on the Rules text (r09) and on the older Roll requests card's rows
// (d03). The sim's window and token rects on today's default Initiative and Game log (the launcher
// moved to the top bar since, ADR-0070, so the log reaches the bottom: no free strip under it);
// #364 (K12) already moves both onto the free map left of the window.
import { describe, expect, test } from "bun:test";
import type { Rect } from "../play-shell/geometry";
import { dmStackSpot, STACK_W, type StackWindow } from "./keep-out";

const hit = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const box = (p: { left: number; top: number }, h: number): Rect => ({
  x: p.left,
  y: p.top,
  w: STACK_W,
  h,
});

/** The 58-px summary ("1 pending action", "7 pending actions"). */
const SUMMARY_H = 58;

describe("BL-130 sim-16 r09 / d03: the stack leaves window text for the free map", () => {
  test("FR-NOTE-77 BL-130 r09 (DM 1440×900, Rules at 576, 60 over the column, Initiative right): left of Rules at 244, 100, off its text, every PC and the card's target", () => {
    const vp = { w: 1440, h: 900 };
    const init = { x: 1028, y: 60, w: 400, h: 512 };
    // Rules (Cover open): tabs, search box, the Cover entry; its text fills the body.
    const rules: StackWindow = {
      x: 576,
      y: 60,
      w: 440,
      h: 512,
      used: 572,
      head: 268,
      primary: [
        { x: 598, y: 228, w: 396, h: 40 },
        { x: 606, y: 270, w: 380, h: 250 },
      ],
      controls: [
        { x: 600, y: 116, w: 58, h: 26 },
        { x: 598, y: 178, w: 396, h: 34 },
      ],
    };
    const log: StackWindow = { x: 68, y: 608, w: 1150, h: 280, used: 888, head: 664 };
    // Mira, Brakka, Thorn (footprints + 4 px) and the card's target, Goblin 2.
    const pcs = [
      { x: 374, y: 326, w: 46, h: 50 },
      { x: 288, y: 406, w: 50, h: 50 },
      { x: 331, y: 492, w: 48, h: 44 },
    ];
    const goblin2 = { x: 503, y: 160, w: 40, h: 40 };
    const at = dmStackSpot(vp, init, SUMMARY_H, STACK_W, [goblin2], [rules, log], [], [], [], pcs);
    // sim-16: 560, 296 on the Rules text (`settled=false`).
    expect(at).toMatchObject({ left: rules.x - 12 - STACK_W, top: 100, covers: 0 });
    const r = box(at, SUMMARY_H);
    for (const b of [rules, log, init, goblin2, ...pcs]) expect(hit(r, b)).toBe(false);
    expect(at.left).toBeGreaterThanOrEqual(80);
  });

  test("FR-NOTE-78 BL-130 d03 (DM 1280×720, Roll requests at 504, 60): left of it at 172, 100, off the older card's rows and names", () => {
    const vp = { w: 1280, h: 720 };
    const init = { x: 868, y: 60, w: 400, h: 583 };
    // The Perception card's title line and its rows (Brakka 12, Mira 9, Thorn 10).
    const heading = { x: 526, y: 381, w: 316, h: 19 };
    const rows = [
      { x: 526, y: 403, w: 316, h: 16 },
      { x: 526, y: 419, w: 316, h: 16 },
      { x: 526, y: 435, w: 316, h: 16 },
    ];
    const requests: StackWindow = {
      x: 504,
      y: 60,
      w: 358,
      h: 408,
      used: 468,
      head: 268,
      headings: [heading],
      records: rows,
      controls: [{ x: 517, y: 138, w: 128, h: 26 }],
    };
    const log: StackWindow = { x: 68, y: 508, w: 690, h: 200, used: 708, head: 564 };
    const pcs = [
      { x: 390, y: 290, w: 40, h: 45 },
      { x: 318, y: 355, w: 44, h: 44 },
      { x: 355, y: 428, w: 40, h: 40 },
    ];
    const goblin2 = { x: 492, y: 165, w: 30, h: 30 };
    const at = dmStackSpot(
      vp,
      init,
      SUMMARY_H,
      STACK_W,
      [goblin2],
      [requests, log],
      [],
      [],
      [],
      pcs,
    );
    // sim-16: 480, 407 over the rows' names.
    expect(at).toMatchObject({ left: requests.x - 12 - STACK_W, top: 100, covers: 0 });
    const r = box(at, SUMMARY_H);
    for (const b of [requests, log, init, goblin2, heading, ...rows, ...pcs])
      expect(hit(r, b)).toBe(false);
  });
});
