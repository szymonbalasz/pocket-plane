import { describe, expect, test } from "bun:test";
import { popupPlacement } from "./popup-placement";

const viewport = { w: 1440, h: 900 };
const base = { viewport, initiative: null, width: 440 };

describe("FR-CBT-55 popup placement", () => {
  test("FR-CBT-55 targets right of centre → left edge, clear of the tool rail", () => {
    const p = popupPlacement({ ...base, tokenXs: [1000, 1100] });
    expect(p).toMatchObject({ side: "left", x: 68 });
    // Vertically: the work area below the top bar, above the launcher.
    expect([p.top, p.bottom]).toEqual([60, 836]);
  });

  test("FR-CBT-55 targets left of centre → right edge, just left of an open Initiative window", () => {
    expect(popupPlacement({ ...base, tokenXs: [200, 500] })).toMatchObject({
      side: "right",
      x: 1440 - 12 - 440,
    });
    const initiative = { x: 1028, w: 400 };
    const p = popupPlacement({ ...base, tokenXs: [200], initiative });
    expect(p.side).toBe("right");
    expect(p.x + 440).toBeLessThanOrEqual(initiative.x);
  });

  test("FR-CBT-55 no token → left; the mean decides for spread targets", () => {
    expect(popupPlacement({ ...base, tokenXs: [] }).side).toBe("left");
    expect(popupPlacement({ ...base, tokenXs: [100, 1300, 1350] }).side).toBe("left");
    // Never past the left edge when the Initiative window is wide on a narrow screen.
    const narrow = popupPlacement({
      viewport: { w: 600, h: 700 },
      tokenXs: [100],
      initiative: { x: 300, w: 288 },
      width: 440,
    });
    expect(narrow.x).toBe(68);
  });
});
