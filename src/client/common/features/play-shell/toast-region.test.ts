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
  reportShownStack,
  SUMMARY_STRIP_H,
  SUMMARY_STRIP_W,
  shownStack,
  shownStacks,
  summaryStrip,
  toastKeepOut,
  toastRegion,
} from "./toast-region";

describe("toast region", () => {
  test("FR-SHELL-01 DM top-centre below the top bar and window title bars, player bottom-right, 20 px above the bottom edge", () => {
    // 48 top bar + 12 gap + 32 title bar + 8: a top-anchored window's close button stays clear.
    expect(toastRegion("dm", 0)).toEqual({ position: "top-center", offset: { top: 100 } });
    // FR-KIT-14: the 12 px bottom gap + 8 (the launcher sits in the top bar).
    expect(toastRegion("player", 0)).toEqual({
      position: "bottom-right",
      offset: { right: 16, bottom: 20 },
    });
    expect(toastRegion("player", 0).offset.bottom).toBeGreaterThan(LAUNCHER_CLEAR);
  });

  test("FR-SHELL-01 one region: Toasts stack after the notifications stack, never under it", () => {
    // DM: below the 58 px stack (+ 8 gap); player: above it.
    expect(toastRegion("dm", 58).offset).toEqual({ top: 100 + 58 + 8 });
    expect(toastRegion("player", 58).offset).toEqual({ right: 16, bottom: 20 + 58 + 8 });
  });
});

describe("roll-popup stack (FR-DICEX-39, seams S7)", () => {
  test("FR-DICEX-39 the third stack: players above the notifications + alert stacks, the DM below them; neither moves", () => {
    expect(popupRegion("player", 0, 0)).toEqual({ right: 16, bottom: 20 });
    // 58 px of notifications + 8, then 70 px of alerts + 8.
    expect(popupRegion("player", 58, 70)).toEqual({ right: 16, bottom: 20 + 66 + 78 });
    expect(popupRegion("dm", 0, 0)).toEqual({ top: 100 });
    expect(popupRegion("dm", 58, 0)).toEqual({ top: 100 + 66 });
    expect(popupRegion("dm", 58, 70)).toEqual({ top: 100 + 66 + 78 });
    // The other stacks' offsets don't depend on the popups at all.
    expect(toastRegion("player", 58).offset).toEqual({ right: 16, bottom: 20 + 66 });
  });

  test("FR-DICEX-39 sonner's collapsed stack height: the front toast + 14 px per toast behind (≤ 3)", () => {
    expect(sonnerStackH(0, 0)).toBe(0);
    expect(sonnerStackH(53, 1)).toBe(53);
    expect(sonnerStackH(53, 2)).toBe(67);
    expect(sonnerStackH(53, 5)).toBe(81);
  });

  test("FR-SHELL-49 popup sizes from D's spec (FR-DICEX-46/47, seams S2): 320 × 190, ≤ 3 popups", () => {
    expect([ROLL_POPUP_W, ROLL_POPUP_H, ROLL_POPUPS_MAX]).toEqual([320, 190, 3]);
  });
});

describe("toast regions (FR-SHELL-40, -49; seams S2, S7)", () => {
  test("FR-SHELL-49 toast regions: both boxes 356 × 238 (1 toast + 1 popup + 8), players at (vw − 372, vh − 258), the DM at ((vw − 356) / 2, 100), at the four sizes", () => {
    expect([KEEP_OUT_W, KEEP_OUT_H]).toEqual([356, 40 + ROLL_POPUP_H + 8]);
    const sizes = [
      { w: 1280, h: 720 },
      { w: 1280, h: 800 },
      { w: 1440, h: 900 },
      { w: 1600, h: 900 },
    ];
    for (const vp of sizes) {
      expect(toastKeepOut("player", vp)).toEqual({ x: vp.w - 372, y: vp.h - 258, w: 356, h: 238 });
      expect(toastKeepOut("dm", vp)).toEqual({ x: (vp.w - 356) / 2, y: 100, w: 356, h: 238 });
    }
    // Regions unchanged from sprint 4 (#256, OQ-SHELL-32 C): DM top-centre, players bottom-right;
    // player stack order notifications → alerts → popups (each beyond the one before).
    expect(toastRegion("dm", 0).position).toBe("top-center");
    expect(toastRegion("player", 0).position).toBe("bottom-right");
    expect(popupRegion("player", 40, 53)).toEqual({ right: 16, bottom: 20 + 48 + 61 });
  });

  test("FR-SHELL-40 the box sits where each client's stacks start", () => {
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
      expect(p.y + p.h).toBeLessThanOrEqual(vp.h - LAUNCHER_CLEAR); // inside the work area
    }
  });
});

test("FR-SHELL-59 shown stack rect: no reports → null; two reports → their bounding box; a cleared report is gone; players always null; the summary strip at the DM stack home", () => {
  expect(shownStack("dm")).toBeNull();
  const toasts = { x: 560, y: 100, w: 320, h: 57 };
  const popups = { x: 540, y: 165, w: 360, h: 190 };
  reportShownStack("note.toasts", toasts);
  try {
    expect(shownStack("dm")).toEqual(toasts);
    const before = shownStacks();
    reportShownStack("note.toasts", { ...toasts }); // same rect: no change
    expect(shownStacks()).toBe(before);
    reportShownStack("dicex.popups", popups);
    expect(shownStack("dm")).toEqual({ x: 540, y: 100, w: 360, h: 255 });
    expect(shownStack("player")).toBeNull();
    reportShownStack("note.toasts", null);
    expect(shownStack("dm")).toEqual(popups);
  } finally {
    reportShownStack("note.toasts", null);
    reportShownStack("dicex.popups", null);
  }
  expect(shownStack("dm")).toBeNull();
  // OQ-MAP-57 D: the 320 × 57 strip at the stack home (FR-NOTE-42's 480 / 560 / 640, y 100).
  expect([SUMMARY_STRIP_W, SUMMARY_STRIP_H]).toEqual([320, 57]);
  for (const [vp, x] of [
    [{ w: 1280, h: 720 }, 480],
    [{ w: 1280, h: 800 }, 480],
    [{ w: 1440, h: 900 }, 560],
    [{ w: 1600, h: 900 }, 640],
  ] as const) {
    expect(summaryStrip(vp)).toEqual({ x, y: 100, w: 320, h: 57 });
  }
});
