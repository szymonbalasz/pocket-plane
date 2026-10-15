// FR-SCN-29/30 client side: the store's `map-settings` row picks the rule (no row = 5/10/5); the
// ruler text and the movement indicator follow it.
import { describe, expect, test } from "bun:test";
import { distanceFt } from "@shared/scene-tools/geometry";
import { MAP_SETTINGS_TYPE } from "@shared/scene-tools/schemas";
import { movementIndicator } from "../scenes-map/movement";
import { DIAGONAL_OPTIONS, diagonalRuleIn, rulerText } from "./diagonal-rule";

const settings = (diagonalRule: unknown) => ({
  [MAP_SETTINGS_TYPE]: { c1: { id: "c1", diagonalRule } },
});

describe("FR-SCN-29 the rule in the store", () => {
  test("FR-SCN-29 no row = 5-10-5; the row's rule otherwise; a bad value falls back to 5-10-5", () => {
    expect(diagonalRuleIn({})).toBe("5-10-5");
    expect(diagonalRuleIn({ [MAP_SETTINGS_TYPE]: {} })).toBe("5-10-5");
    expect(diagonalRuleIn(settings("5"))).toBe("5");
    expect(diagonalRuleIn(settings("5-10-5"))).toBe("5-10-5");
    expect(diagonalRuleIn(settings("10"))).toBe("5-10-5");
  });

  test("FR-SCN-29 the Ruler panel offers 5/10/5 then 5 ft", () => {
    expect(DIAGONAL_OPTIONS.map((o) => [o.rule, o.label])).toEqual([
      ["5-10-5", "5/10/5"],
      ["5", "5 ft"],
    ]);
  });
});

describe("FR-SCN-30 ruler and movement indicator", () => {
  const a = { col: 2, row: 7 };
  const b = { col: 5, row: 9 };

  test("FR-SCN-30 ruler (2, 7) → (5, 9): 20 ft under 5/10/5, 15 ft under 5 (walkthrough step 9)", () => {
    expect(rulerText(a, b, diagonalRuleIn({}))).toBe("20 ft");
    expect(rulerText(a, b, diagonalRuleIn(settings("5")))).toBe("15 ft");
    expect(rulerText(a, a, "5")).toBe("0 ft");
  });

  test("FR-SCN-30 the drag's movement indicator uses the same distance", () => {
    const four = { col: 6, row: 11 };
    expect(movementIndicator(distanceFt(a, four, "5-10-5"), 0, 25)).toEqual({
      tone: "dash",
      text: "move 30 · 30 / 25 ft",
    });
    expect(movementIndicator(distanceFt(a, four, "5"), 0, 25)).toEqual({
      tone: "normal",
      text: "move 20 · 20 / 25 ft",
    });
  });
});
