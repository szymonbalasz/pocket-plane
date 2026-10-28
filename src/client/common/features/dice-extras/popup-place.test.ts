// Sprint 14 F2 (BL-132), session-sim-16 at DM 1440×900 (`.verify/20261026-234022-session-sim-16/`):
// g01, the DM's tray roll popup (496, 100) on Party Manager's tabs and pot for ~6 s; d01, three
// quick player rolls stacked 448-wide popups from 104, 354 down over the Game log's title bar.
// Window rects as in the shots, the Game log and Initiative at today's defaults (the launcher sits
// in the top bar since ADR-0070). The popup size is #348's (448 × 138 a one-row card).
import { describe, expect, test } from "bun:test";
import type { Rect } from "../play-shell/geometry";
import {
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
