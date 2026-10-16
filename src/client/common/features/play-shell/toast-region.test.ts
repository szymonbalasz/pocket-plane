import { describe, expect, test } from "bun:test";
import { LAUNCHER_CLEAR } from "./geometry";
import { toastRegion } from "./toast-region";

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
