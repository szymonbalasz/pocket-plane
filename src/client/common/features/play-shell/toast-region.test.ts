import { describe, expect, test } from "bun:test";
import { toastRegion } from "./toast-region";

describe("toast region", () => {
  test("FR-SHELL-01 DM top-centre below the top bar, player bottom-right", () => {
    expect(toastRegion("dm", 0)).toEqual({ position: "top-center", offset: { top: 60 } });
    expect(toastRegion("player", 0)).toEqual({
      position: "bottom-right",
      offset: { right: 16, bottom: 16 },
    });
  });

  test("FR-SHELL-01 one region: Toasts stack after the notifications stack, never under it", () => {
    // DM: below the 58 px stack (+ 8 gap); player: above it.
    expect(toastRegion("dm", 58).offset).toEqual({ top: 60 + 58 + 8 });
    expect(toastRegion("player", 58).offset).toEqual({ right: 16, bottom: 16 + 58 + 8 });
  });
});
