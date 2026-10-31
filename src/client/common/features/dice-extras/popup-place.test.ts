// Sprint 14 F2 (BL-132), session-sim-16 at DM 1440×900 (`.verify/20261026-234022-session-sim-16/`):
// g01, the DM's tray roll popup (496, 100) on Party Manager's tabs and pot for ~6 s; d01, three
// quick player rolls stacked 448-wide popups from 104, 354 down over the Game log's title bar.
// Window rects as in the shots, the Game log and Initiative at today's defaults (the launcher sits
// in the top bar since ADR-0070). The popup size is #348's (448 × 138 a one-row card).
import { describe, expect, test } from "bun:test";
import type { Rect } from "../play-shell/geometry";
import {
  columnPlanH,
  dmColumnTop,
  dmPopupAt,
  dmPopupClear,
  dmStackAt,
  HEAD_MAX,
  HEAD_MIN,
  POPUP_BIG,
  popupHeight,
  popupRoom,
  popupsThatFit,
  windowHeads,
} from "./popup-logic";

const vp = { w: 1440, h: 900 };
const CARD_H = popupHeight(1, 1, POPUP_BIG);
const W = POPUP_BIG.w;
const hit = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const column = (at: { left: number; top: number }, h: number): Rect => ({
  x: at.left,
  y: at.top,
  w: W,
  h,
});

const LOG = { x: 68, y: 608, w: 1150, h: 280 };
/** The DM column's home at 1440 with no toast (centred, below the home row). */
const HOME = { left: 496, top: 100 };
/** The Game log's first entry row ends 62 px under its top. */
const LOG_ROW = { x: 68, y: 608, bottom: 670 };

describe("FR-NOTE-82 the DM's roll popups keep off the PCs where a clear spot exists", () => {
  // Sim-17 b02 (1440×900): Party Manager 580, 148, Dice tray 618, 560, Game log 70, 690, Initiative
  // 1030, 62; the toasts left of Party Manager. Tokens from the DM's captured records at b02's
  // camera (40-px cells; FE2 at 280, 438), PCs footprint + 4 px.
  const init = { x: 1030, y: 62, w: 398, h: 825 };
  const pm = { x: 580, y: 148, w: 435, h: 395 };
  const tray = { x: 618, y: 560, w: 370, h: 327 };
  const log = { x: 70, y: 690, w: 457, h: 197 };
  const toasts = { x: 247, y: 100, w: 320, h: 208 };
  const mira = { x: 316, y: 312, w: 48, h: 48 };
  const brakka = { x: 316, y: 394, w: 48, h: 48 };
  const thorn = { x: 556, y: 551, w: 48, h: 48 };
  const windows = [pm, tray, log];
  const heads = windowHeads(windows, []);
  const clear = dmPopupClear(init, [], [], new Map([["note.toasts", toasts]]), "dicex.popups");
  const start = dmColumnTop(toasts.h);

  test("FR-NOTE-82 sim-17 b02: before, the column left of Party Manager on Mira + Brakka for its ~6 s; now off them, off every window and off the toasts, the size unchanged (#348)", () => {
    const size = { w: W, h: CARD_H };
    expect(W).toBe(448);
    const before = dmPopupAt(vp, start, size, clear, windows, heads);
    expect(before).toEqual({ left: 120, top: start });
    expect(hit(column(before, CARD_H), mira)).toBe(true);
    const at = dmPopupAt(vp, start, size, clear, windows, heads, [mira, brakka, thorn]);
    for (const p of [mira, brakka, thorn]) expect(hit(column(at, CARD_H), p)).toBe(false);
    for (const w of [...windows, init, toasts]) expect(hit(column(at, CARD_H), w)).toBe(false);
    expect(at.left).toBeGreaterThanOrEqual(68);
    // No window head below it stops the card (FR-DICEX-47's count holds).
    expect(popupRoom(vp.h, at, W, heads, { left: 496, top: start })).toBeGreaterThanOrEqual(CARD_H);
  });

  test("FR-NOTE-82 BL-118 x1 (a card leaves, the toasts settle): the showing column holds its spot while that stays clear of the rects and the PCs, and moves when a PC or a window reaches it", () => {
    const pcs = [mira, brakka, thorn];
    const size = { w: W, h: CARD_H };
    const first = dmPopupAt(vp, start, size, clear, windows, heads, pcs);
    // Shorter (a card left), the toasts' start elsewhere: same spot.
    const shorter = { w: W, h: CARD_H - 40 };
    expect(dmPopupAt(vp, start - 60, shorter, clear, windows, heads, pcs, first)).toEqual(first);
    // A PC walks under it: it moves off.
    const onIt = { x: first.left + 10, y: first.top + 10, w: 48, h: 48 };
    const moved = dmPopupAt(vp, start, size, clear, windows, heads, [...pcs, onIt], first);
    expect(moved).not.toEqual(first);
    expect(hit(column(moved, CARD_H), onIt)).toBe(false);
    // No PCs: no hold, the rules as they were.
    expect(dmPopupAt(vp, start, size, clear, windows, heads, [], first)).toEqual(
      dmPopupAt(vp, start, size, clear, windows, heads),
    );
  });

  test("FR-NOTE-85 walkthrough step B (one card up, stack 248, 100 h140): the rolling card first shows where it will stay: before, 120, 248 h59 then 496, 312; now 496, 312 from the first frame, and it holds at rest", () => {
    const stack = { x: 248, y: 100, w: 320, h: 140 };
    const board = { x: 580, y: 148, w: 472, h: 536 };
    const trayB = { x: 618, y: 560, w: 360, h: 316 };
    const logB = { x: 68, y: 608, w: 1150, h: 280 };
    const initB = { x: 1028, y: 60, w: 400, h: 512 };
    const mid = { x: 336, y: 334, w: 53, h: 53 };
    const bra = { x: 246, y: 424, w: 53, h: 53 };
    const tho = { x: 291, y: 514, w: 53, h: 53 };
    const pcsB = [mid, bra, tho];
    const winsB = [board, trayB, logB];
    const headsB = windowHeads(winsB, [{ x: 580, y: 148, bottom: 300 }]);
    const clearB = dmPopupClear(initB, [], [], new Map([["note.toasts", stack]]), "dicex.popups");
    const startB = dmColumnTop(stack.h);
    expect(startB).toBe(248);
    const place = (h: number, held: { left: number; top: number } | null = null) =>
      dmPopupAt(vp, startB, { w: W, h }, clearB, winsB, headsB, pcsB, held);
    const rolling = popupHeight(1, 0, POPUP_BIG);
    expect(rolling).toBe(59);
    // Before: placed at the rolling card's height, then the rest card's.
    expect(place(rolling)).toEqual({ left: 120, top: 248 });
    const rest = place(CARD_H);
    expect(rest).toEqual({ left: 496, top: 312 });
    // Now: from the first render (nothing measured) and the first measure, then at rest.
    expect(place(columnPlanH(0, true, POPUP_BIG))).toEqual(rest);
    expect(place(columnPlanH(rolling, true, POPUP_BIG))).toEqual(rest);
    expect(place(columnPlanH(CARD_H, false, POPUP_BIG), rest)).toEqual(rest);
  });

  test("FR-NOTE-85 columnPlanH: only an own roll in flight counts as a card; other cards as drawn", () => {
    const rolling = popupHeight(1, 0, POPUP_BIG);
    expect(columnPlanH(CARD_H, false, POPUP_BIG)).toBe(CARD_H);
    expect(columnPlanH(0, false, POPUP_BIG)).toBe(0);
    expect(columnPlanH(0, true, POPUP_BIG)).toBe(CARD_H);
    expect(columnPlanH(CARD_H + 8 + rolling, true, POPUP_BIG)).toBe(2 * CARD_H + 8);
  });

  test("FR-NOTE-82 BL-132 a home spot already off the PCs doesn't move: default layout, up to 3 cards", () => {
    const three = 3 * CARD_H + 2 * 8;
    const initD = { x: 1028, y: 60, w: 400, h: 512 };
    const c = dmPopupClear(initD, [], [], new Map(), "dicex.popups");
    const h = windowHeads([LOG], [LOG_ROW]);
    const pcs = [{ x: 200, y: 300, w: 44, h: 44 }];
    expect(dmPopupAt(vp, dmColumnTop(0), { w: W, h: three }, c, [LOG], h, pcs)).toEqual({
      left: 496,
      top: 100,
    });
  });

  test("FR-NOTE-82 a PC under the home column: the nearest spot off it", () => {
    const initD = { x: 1028, y: 60, w: 400, h: 512 };
    const c = dmPopupClear(initD, [], [], new Map(), "dicex.popups");
    const h = windowHeads([LOG], [LOG_ROW]);
    const pc = { x: 700, y: 150, w: 44, h: 44 };
    const at = dmPopupAt(vp, dmColumnTop(0), { w: W, h: CARD_H }, c, [LOG], h, [pc]);
    expect(hit(column(at, CARD_H), pc)).toBe(false);
    for (const r of [initD, LOG]) expect(hit(column(at, CARD_H), r)).toBe(false);
  });

  test("FR-NOTE-82 no clear spot (PCs everywhere the column can go): the rules before stand", () => {
    const initD = { x: 1028, y: 60, w: 400, h: 512 };
    const c = dmPopupClear(initD, [], [], new Map(), "dicex.popups");
    const h = windowHeads([LOG], [LOG_ROW]);
    const wall = [{ x: 0, y: 0, w: vp.w, h: vp.h }];
    expect(dmPopupAt(vp, dmColumnTop(0), { w: W, h: CARD_H }, c, [LOG], h, wall)).toEqual(
      dmPopupAt(vp, dmColumnTop(0), { w: W, h: CARD_H }, c, [LOG], h),
    );
  });

  test("FR-NOTE-82 round trip: 1280×720 (a toast up) and 1600×900 with a PC under the column", () => {
    for (const [v, initR, logR] of [
      [
        { w: 1280, h: 720 },
        { x: 868, y: 60, w: 400, h: 500 },
        { x: 68, y: 508, w: 690, h: 200 },
      ],
      [
        { w: 1600, h: 900 },
        { x: 1188, y: 60, w: 400, h: 512 },
        { x: 68, y: 608, w: 1150, h: 280 },
      ],
    ] as const) {
      const toast = { x: Math.round((v.w - 320) / 2), y: 100, w: 320, h: 46 };
      const c = dmPopupClear(initR, [], [], new Map([["note.toasts", toast]]), "dicex.popups");
      const h = windowHeads([logR], []);
      const top = dmColumnTop(toast.h);
      const pc = { x: Math.round(v.w / 2) - 22, y: top + 40, w: 44, h: 44 };
      const at = dmPopupAt(v, top, { w: W, h: CARD_H }, c, [logR], h, [pc]);
      const r = column(at, CARD_H);
      expect(hit(r, pc)).toBe(false);
      for (const b of [initR, logR, toast]) expect(hit(r, b)).toBe(false);
    }
  });
});

describe("BL-132 the DM's roll popups keep off window heads where a clear spot is", () => {
  test("FR-DICEX-55 BL-132 windowHeads: title bar + tabs + first record from the frame's report, 72..152 px deep", () => {
    const pm = { x: 424, y: 60, w: 438, h: 398 };
    const [h] = windowHeads([pm], [{ x: 424, y: 60, bottom: 205 }]);
    expect(h).toEqual({ ...pm, h: 145 });
    // No report → the title bar + 40 px; a first "record" that is a whole panel → capped.
    expect(windowHeads([pm], [])[0]?.h).toBe(HEAD_MIN);
    expect(windowHeads([pm], [{ x: 424, y: 60, bottom: 440 }])[0]?.h).toBe(HEAD_MAX);
  });

  test("FR-DICEX-55 BL-132 g01 (tray popup, Stats + Party Manager Loot + Dice tray + sheet open): below Party Manager on the map at 496, 470, off every window; before: 496, 100 on its tabs and pot", () => {
    const stats = { x: 70, y: 60, w: 316, h: 280 };
    const pm = { x: 424, y: 60, w: 438, h: 398 };
    const tray = { x: 978, y: 65, w: 449, h: 373 };
    const sheet = { x: 1110, y: 455, w: 317, h: 368 };
    const log = { x: 70, y: 668, w: 455, h: 155 };
    const windows = [stats, pm, tray, sheet, log];
    const heads = windowHeads(windows, [{ x: 424, y: 60, bottom: 205 }]);
    const start = dmColumnTop(0);
    const before = dmStackAt(vp, start, { w: W, h: CARD_H }, []);
    expect(before).toEqual({ left: 496, top: 100 });
    expect(hit(column(before, CARD_H), heads[1] as Rect)).toBe(true);
    const at = dmPopupAt(vp, start, { w: W, h: CARD_H }, [], windows, heads);
    expect(at).toEqual({ left: 496, top: pm.y + pm.h + 12 });
    for (const w of windows) expect(hit(column(at, CARD_H), w)).toBe(false);
    expect(popupRoom(vp.h, at, W, heads, HOME)).toBeGreaterThanOrEqual(CARD_H);
  });

  test("FR-DICEX-47 BL-132 d01 (3 quick player rolls, toast stack 560, 300 × 246, Party Manager at 424, 60): only the newest popup shows, at 104, 354 above the Game log's head; before: 3 popups down over it", () => {
    const init = { x: 1028, y: 60, w: 400, h: 512 };
    const toasts = { x: 560, y: 300, w: 320, h: 246 };
    const pm = { x: 424, y: 60, w: 438, h: 398 };
    const windows = [pm, LOG];
    const heads = windowHeads(windows, [{ x: 424, y: 60, bottom: 238 }, LOG_ROW]);
    const clear = dmPopupClear(init, [], [], new Map([["note.toasts", toasts]]), "dicex.popups");
    const start = dmColumnTop(toasts.h);
    expect(start).toBe(354);
    const three = 3 * CARD_H + 2 * 8;
    // Before: the old column, three cards over the log's title bar (608).
    const before = dmStackAt(vp, start, { w: W, h: three }, clear);
    expect(before).toEqual({ left: 104, top: 354 });
    expect(hit(column(before, three), { ...LOG, h: 32 })).toBe(true);
    // Now: no spot holds three off the windows or the heads → the column stays and its room ends
    // at the log's head: the newest card only (the oldest drop, FR-DICEX-47).
    const at3 = dmPopupAt(vp, start, { w: W, h: three }, clear, windows, heads);
    expect(at3).toEqual(before);
    const room = popupRoom(vp.h, at3, W, heads, { left: 496, top: start });
    expect(room).toBe(608 - 354);
    expect(popupsThatFit([CARD_H, CARD_H, CARD_H], room)).toBe(1);
    // With one card: off every head (it may sit over Party Manager's empty body).
    const at1 = dmPopupAt(vp, start, { w: W, h: CARD_H }, clear, windows, heads);
    expect(at1).toEqual({ left: 104, top: 354 });
    for (const h of heads) expect(hit(column(at1, CARD_H), h)).toBe(false);
    for (const c of clear) expect(hit(column(at1, CARD_H), c)).toBe(false);
  });

  test("FR-DICEX-55 BL-132 default layout (Initiative + Game log): unchanged, home at 496, 100 with up to 3 cards", () => {
    const init = { x: 1028, y: 60, w: 400, h: 512 };
    const clear = dmPopupClear(init, [], [], new Map(), "dicex.popups");
    const heads = windowHeads([LOG], [LOG_ROW]);
    const three = 3 * CARD_H + 2 * 8;
    const at = dmPopupAt(vp, dmColumnTop(0), { w: W, h: three }, clear, [LOG], heads);
    expect(at).toEqual(dmStackAt(vp, dmColumnTop(0), { w: W, h: three }, clear));
    expect(at).toEqual({ left: 496, top: 100 });
    expect(popupsThatFit([CARD_H, CARD_H, CARD_H], popupRoom(vp.h, at, W, heads, HOME))).toBe(3);
  });

  test("FR-DICEX-47 BL-132 at home #347's counts stand: 1280×720 with a toast up, two 206-px cards at 416, 154 though the second reaches the Game log's head (508); moved off home, it stops there", () => {
    const small = { w: 1280, h: 720 };
    const log = { x: 68, y: 508, w: 690, h: 200 };
    const heads = windowHeads([log], [{ x: 68, y: 508, bottom: 564 }]);
    const home = { left: 416, top: dmColumnTop(46) };
    expect(home.top).toBe(154);
    const card = popupHeight(1, 2, POPUP_BIG);
    expect(card).toBe(206);
    expect(popupsThatFit([card, card, card], popupRoom(small.h, home, W, heads, home))).toBe(2);
    const moved = { left: 100, top: 154 };
    expect(popupsThatFit([card, card, card], popupRoom(small.h, moved, W, heads, home))).toBe(1);
  });

  test("FR-DICEX-47 BL-132 a nudge clear of Initiative stays home (CI popup-line, Linux: Initiative 868, 60, 400 × 500): the column at 408, 154 keeps #347's two cards", () => {
    const small = { w: 1280, h: 720 };
    const log = { x: 68, y: 508, w: 690, h: 200 };
    const test = { x: 948, y: 488, w: 320, h: 220 };
    const init = { x: 868, y: 60, w: 400, h: 500 };
    const heads = windowHeads([log, test], [{ x: 68, y: 508, bottom: 564 }]);
    const clear = dmPopupClear(init, [], [], new Map(), "dicex.popups");
    const card = popupHeight(1, 2, POPUP_BIG);
    const start = dmColumnTop(46);
    const at = dmPopupAt(small, start, { w: W, h: 3 * card + 16 }, clear, [log, test], heads);
    expect(at).toEqual({ left: 408, top: 154 });
    const home = { left: Math.round((small.w - W) / 2), top: start };
    expect(home.left).toBe(416);
    expect(popupsThatFit([card, card, card], popupRoom(small.h, at, W, heads, home))).toBe(2);
  });
});
