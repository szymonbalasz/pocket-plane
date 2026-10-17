import { describe, expect, test } from "bun:test";
import { LAUNCHER_CLEAR } from "./geometry";
import { KEEP_OUT_H, KEEP_OUT_W, toastKeepOut, toastRegion } from "./toast-region";

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

describe("toast keep-out (FR-SHELL-40, seams S7, review A11)", () => {
  test("FR-SHELL-40 toast keep-out box: 3 toasts + one roll popup (DICEX §7), DM top-centre, player bottom-right above the launcher", () => {
    // 3 × 40 toasts + one 160 popup + 3 gaps of 8; as wide as the widest stack (sonner 356).
    expect(KEEP_OUT_H).toBe(3 * 40 + 160 + 3 * 8);
    expect(KEEP_OUT_W).toBeGreaterThanOrEqual(320); // notifications `w-80`; popup 280
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
