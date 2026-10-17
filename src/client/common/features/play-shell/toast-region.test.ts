import { describe, expect, test } from "bun:test";
import { LAUNCHER_CLEAR } from "./geometry";
import { sonnerStackH } from "./ShellToaster";
import {
  KEEP_OUT_H,
  KEEP_OUT_W,
  popupRegion,
  ROLL_POPUP_H,
  ROLL_POPUP_W,
  ROLL_POPUPS_MAX,
  toastKeepOut,
  toastRegion,
} from "./toast-region";

describe("toast region", () => {
  test("FR-SHELL-01 DM top-centre below the top bar and window title bars, player bottom-right above the launcher", () => {
    // 48 top bar + 12 gap + 32 title bar + 8: a top-anchored window's close button stays clear.
    expect(toastRegion("dm", 0)).toEqual({ position: "top-center", offset: { top: 100 } });
    // 64 launcher strip + 8: a toast never covers a launcher button.
    expect(toastRegion("player", 0)).toEqual({
      position: "bottom-right",
      offset: { right: 16, bottom: 72 },
    });
    expect(toastRegion("player", 0).offset.bottom).toBeGreaterThan(LAUNCHER_CLEAR);
  });

  test("FR-SHELL-01 one region: Toasts stack after the notifications stack, never under it", () => {
    // DM: below the 58 px stack (+ 8 gap); player: above it.
    expect(toastRegion("dm", 58).offset).toEqual({ top: 100 + 58 + 8 });
    expect(toastRegion("player", 58).offset).toEqual({ right: 16, bottom: 72 + 58 + 8 });
  });
});

describe("roll-popup stack (FR-DICEX-39, seams S7)", () => {
  test("FR-DICEX-39 the third stack: players above the notifications + alert stacks, the DM below them; neither moves", () => {
    expect(popupRegion("player", 0, 0)).toEqual({ right: 16, bottom: 72 });
    // 58 px of notifications + 8, then 70 px of alerts + 8.
    expect(popupRegion("player", 58, 70)).toEqual({ right: 16, bottom: 72 + 66 + 78 });
    expect(popupRegion("dm", 0, 0)).toEqual({ top: 100 });
    expect(popupRegion("dm", 58, 0)).toEqual({ top: 100 + 66 });
    expect(popupRegion("dm", 58, 70)).toEqual({ top: 100 + 66 + 78 });
    // The other stacks' offsets don't depend on the popups at all.
    expect(toastRegion("player", 58).offset).toEqual({ right: 16, bottom: 72 + 66 });
  });

  test("FR-DICEX-39 sonner's collapsed stack height: the front toast + 14 px per toast behind (≤ 3)", () => {
    expect(sonnerStackH(0, 0)).toBe(0);
    expect(sonnerStackH(53, 1)).toBe(53);
    expect(sonnerStackH(53, 2)).toBe(67);
    expect(sonnerStackH(53, 5)).toBe(81);
  });

  test("FR-DICEX-39 DICEX §7 popup sizes: 280 × 160 max, ≤ 3 popups", () => {
    expect([ROLL_POPUP_W, ROLL_POPUP_H, ROLL_POPUPS_MAX]).toEqual([280, 160, 3]);
  });
});

describe("toast keep-out (FR-SHELL-40, seams S7, review A11)", () => {
  test("FR-SHELL-40 toast keep-out box: 3 toasts + one roll popup (DICEX §7), DM top-centre, player bottom-right above the launcher", () => {
    // 3 × 40 toasts + one 160 popup + 3 gaps of 8; as wide as the widest stack (sonner 356).
    expect(KEEP_OUT_H).toBe(3 * 40 + ROLL_POPUP_H + 3 * 8);
    expect(KEEP_OUT_W).toBeGreaterThanOrEqual(320); // notifications `w-80`
    expect(KEEP_OUT_W).toBeGreaterThanOrEqual(ROLL_POPUP_W);
    for (const vp of [
      { w: 1280, h: 720 },
      { w: 1280, h: 800 },
      { w: 1600, h: 900 },
    ]) {
      const dm = toastKeepOut("dm", vp);
      expect(dm).toEqual({
        x: Math.round((vp.w - KEEP_OUT_W) / 2),
        y: toastRegion("dm", 0).offset.top ?? -1,
        w: KEEP_OUT_W,
        h: KEEP_OUT_H,
      });
      const p = toastKeepOut("player", vp);
      const off = toastRegion("player", 0).offset;
      expect(p.x + p.w).toBe(vp.w - (off.right ?? -1));
      expect(p.y + p.h).toBe(vp.h - (off.bottom ?? -1));
      expect(p.y + p.h).toBeLessThanOrEqual(vp.h - LAUNCHER_CLEAR); // above the launcher
    }
  });
});
