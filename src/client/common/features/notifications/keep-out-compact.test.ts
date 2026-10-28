// Sprint 14 F3 (BL-141, kit parity K6c §3 gap 1; F2 walkthrough side finding): with no clear
// spot the folded "N pending actions" summary sat on a window (the 680-px NPC sheet beside
// Initiative at 1440×900, `.verify/20261028-k6c-parity/app-dm-npc-sheet-screen.png`) and on a
// modal Edit dialog's Name field (1280×720, `.verify/20261028-s14f2/05-edit-form-stack-on-cmp-dm.png`).
// FR-NOTE-79: the fold's last step draws the summary compact (`COMPACT_W`), placed by the same
// rules at that width. Rects read off the screenshots.
import { describe, expect, test } from "bun:test";
import type { Rect } from "../play-shell/geometry";
import { COMPACT_W, dmStackSpot, STACK_W, type StackWindow } from "./keep-out";
import { compactSummaryText, summaryText } from "./logic";
import { canFold, foldCap, MAX_VISIBLE, settleStack, UNSETTLED } from "./toasts";

const hit = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const box = (p: { left: number; top: number }, w: number, h: number): Rect => ({
  x: p.left,
  y: p.top,
  w,
  h,
});

/** The 58-px summary, and the compact one-line summary as drawn. */
const SUMMARY_H = 58;
const COMPACT_H = 38;

describe("FR-NOTE-79 the compact summary", () => {
  test("FR-NOTE-79 FR-NOTE-76 F2 side finding (DM 1280×720, the modal Edit dialog at 386, 68 over the home column): the summary covers the dialog; compact, it sits left of it, off its Name field", () => {
    const vp = { w: 1280, h: 720 };
    const init = { x: 868, y: 60, w: 400, h: 578 };
    const log = { x: 68, y: 508, w: 688, h: 200 };
    const dialog = { x: 386, y: 68, w: 507, h: 582 };
    const name = { x: 409, y: 144, w: 459, h: 34 };
    // The repro: no spot left of (386 − 12 − 320 < 80), above or below the dialog holds the
    // summary, so it takes home, over the dialog's title and Name field.
    const full = dmStackSpot(vp, init, SUMMARY_H, STACK_W, [], [log], [], [], [dialog]);
    expect(full).toMatchObject({ left: 480, top: 100 });
    expect(full.covers).toBeGreaterThan(0);
    expect(hit(box(full, STACK_W, SUMMARY_H), name)).toBe(true);
    // Compact: the left-of shift holds it (FR-NOTE-76: the dialog counts like Initiative).
    const compact = dmStackSpot(vp, init, COMPACT_H, COMPACT_W, [], [log], [], [], [dialog]);
    expect(compact).toMatchObject({ left: 386 - 12 - COMPACT_W, top: 100, covers: 0 });
    expect(hit(box(compact, COMPACT_W, COMPACT_H), dialog)).toBe(false);
    expect(compact.left).toBeGreaterThanOrEqual(80);
  });

  test("FR-NOTE-79 K6c gap 1 (DM 1440×900, the 680-px NPC sheet at 68, 60 + Initiative right): compact, the summary takes the map between them, off both and the Game log", () => {
    const vp = { w: 1440, h: 900 };
    const init = { x: 1030, y: 60, w: 398, h: 512 };
    // The sheet's content fills it; its header and tabs are its first rows.
    const sheet: StackWindow = { x: 68, y: 60, w: 680, h: 828, used: 888, head: 236 };
    const log: StackWindow = { x: 748, y: 610, w: 468, h: 278, used: 888 };
    const full = dmStackSpot(vp, init, SUMMARY_H, STACK_W, [], [sheet, log]);
    expect(full.covers).toBeGreaterThan(0);
    const at = dmStackSpot(vp, init, COMPACT_H, COMPACT_W, [], [sheet, log]);
    expect(at.covers).toBe(0);
    const r = box(at, COMPACT_W, COMPACT_H);
    for (const b of [sheet, log, init]) expect(hit(r, b)).toBe(false);
    expect(at.top).toBe(100);
  });

  test("FR-NOTE-79 the fold's last step: the summary alone goes compact once, only when it shows alone", () => {
    // The summary alone (no card shown: cap folded to 0), still covering: one step to compact.
    const o = { need: true, min: 0, stackH: SUMMARY_H, shown: 0, compactable: true };
    const s0 = { cap: 0, foldedAt: 120 };
    expect(canFold(s0, o)).toBe(true);
    const s1 = foldCap(s0, o);
    expect(s1).toEqual({ cap: 0, foldedAt: SUMMARY_H, compact: true });
    // Done: no further step, at any height.
    expect(canFold(s1, { ...o, stackH: COMPACT_H })).toBe(false);
    expect(foldCap(s1, { ...o, stackH: COMPACT_H })).toBe(s1);
    // A card, an alert, the turn card or a callout shows (not compactable) → no compact step.
    expect(foldCap(s0, { ...o, compactable: false })).toBe(s0);
    // Fits (no need) → stays full.
    expect(foldCap(s0, { ...o, need: false })).toBe(s0);
    // A fresh summary (cap 3, nothing to fold) folds its cap and goes compact in the same step.
    const fresh = foldCap({ cap: MAX_VISIBLE, foldedAt: null }, o);
    expect(fresh.compact).toBe(true);
  });

  test("FR-NOTE-79 BL-115 the compact step holds the drawn spot until the compact height is measured, then moves once", () => {
    const spot = { left: 480, top: 100 };
    const base = { need: true, min: 0, shown: 0, compactable: true, now: 0 };
    const a = settleStack(UNSETTLED, { ...base, stackH: SUMMARY_H, spot });
    expect(a.fold.compact).toBe(true);
    // The compact spot is computed at once; the drawn one holds while the height is stale.
    const b = settleStack(a, {
      ...base,
      stackH: SUMMARY_H,
      spot: { left: 174, top: 100 },
      now: 16,
    });
    expect(b.drawn).toEqual(spot);
    // Measured compact (and clear: no need) → moves to the compact spot.
    const c = settleStack(b, {
      ...base,
      need: false,
      stackH: COMPACT_H,
      spot: { left: 174, top: 100 },
      now: 32,
    });
    expect(c.drawn).toEqual({ left: 174, top: 100 });
    expect(c.hold).toBe(false);
  });

  test("FR-NOTE-79 the compact line: N pending, else N waiting; the full text stays for its title", () => {
    expect(compactSummaryText(1)).toBe("1 pending");
    expect(compactSummaryText(3, 2)).toBe("3 pending");
    expect(compactSummaryText(0, 2)).toBe("2 waiting");
    expect(summaryText(3, 2)).toBe("3 pending actions · 2 waiting for players");
  });
});
