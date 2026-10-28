import { describe, expect, test } from "bun:test";
import {
  MIN_LIST_H,
  MORE_H,
  PENDING_MAX_LINES,
  pendingLines,
  pendingMaxH,
  scrollToShow,
} from "./pending-cap";

// The DM Initiative as drawn today (kit, K6c `app-initiative`, 400 × 536 with 2 Pending lines):
// title bar, header, the Pending heading, footer and the gaps take 162 px beside the two lists and
// "↓ N more" (536 − 276 row list − 68 Pending − 30 more).
const FIXED = 162;
/** One combatant row (54) and the list's gap. */
const ROW = 58;
const listH = (windowH: number, lines: number) => windowH - FIXED - pendingMaxH(lines) - MORE_H;

describe("BL-131 the Pending block leaves combatant rows in view", () => {
  test("FR-CBT-77 BL-131 sim-16 h04 (DM 1440, Initiative squeezed to 400 × 380, 7 pending): 2 Pending lines (the rest scroll), the list holds 2 combatant rows; before: 3 lines, ~1.5 rows", () => {
    const before = listH(380, PENDING_MAX_LINES);
    expect(before).toBe(86);
    expect(before / ROW).toBeLessThan(1.6);
    const lines = pendingLines(380, FIXED, 7);
    expect(lines).toBe(2);
    expect(pendingMaxH(lines)).toBe(68);
    expect(listH(380, lines)).toBeGreaterThanOrEqual(MIN_LIST_H);
    expect(listH(380, lines)).toBeGreaterThanOrEqual(2 * ROW - 4);
  });

  test("FR-CBT-77 BL-131 lines by height: 3 down to 412, 2 at 400 and 380, 1 at the 320 minimum; never more than the cards", () => {
    expect(pendingLines(536, FIXED, 7)).toBe(3);
    expect(pendingLines(500, FIXED, 5)).toBe(3);
    expect(pendingLines(412, FIXED, 5)).toBe(3);
    expect(pendingLines(400, FIXED, 5)).toBe(2);
    expect(pendingLines(320, FIXED, 7)).toBe(1);
    expect(pendingLines(240, FIXED, 7)).toBe(1);
    expect(pendingLines(536, FIXED, 2)).toBe(2);
    expect(pendingMaxH(3)).toBe(104);
  });
});

describe("BL-137 Initiative scrolls to the active row", () => {
  // The list's box at 176..452 (the window at 60); rows 58 px apart.
  const view = { top: 236, bottom: 512 };
  test("FR-CBT-77 BL-137 K9 (Fire Elemental's turn in '↓ 7 more'): a row below the fold → centred in the list; visible → no scroll; above → back up, never below 0", () => {
    const below = { top: 700, bottom: 754 };
    const to = scrollToShow(below, view, 0);
    expect(to).toBe(353);
    // After the scroll the row sits inside the list's box.
    const at = { top: below.top - (to ?? 0), bottom: below.bottom - (to ?? 0) };
    expect(at.top).toBeGreaterThanOrEqual(view.top);
    expect(at.bottom).toBeLessThanOrEqual(view.bottom);
    expect(scrollToShow({ top: 300, bottom: 354 }, view, 120)).toBeNull();
    expect(scrollToShow({ top: 200, bottom: 254 }, view, 30)).toBe(0);
    expect(scrollToShow({ top: 120, bottom: 174 }, view, 400)).toBe(173);
  });
});
