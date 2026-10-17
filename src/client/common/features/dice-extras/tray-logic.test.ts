import { describe, expect, test } from "bun:test";
import { toNotation } from "@shared/dice-roll-log/grammar";
import {
  addDie,
  chipsOf,
  type FreeFields,
  paletteRequest,
  previewMode,
  removeDie,
  setConstant,
  termsOf,
  throwZone,
  ZONE_MAX,
} from "./tray-logic";

const t = (s: string) => termsOf(s) ?? [];
const n = (terms: ReturnType<typeof t>) => toNotation(terms);

describe("FR-DICEX-04 compose", () => {
  test("one chip per die, grouped by term", () => {
    expect(chipsOf(t("2d6+1d8+3")).map((c) => [c.faces, c.term])).toEqual([
      [6, 0],
      [6, 0],
      [8, 1],
    ]);
  });

  test("palette joins a same-faces term without keep; a new term goes before the constants", () => {
    expect(n(addDie(t("1d12+5"), 6))).toBe("1d12+1d6+5");
    expect(n(addDie(t("1d12+1d6+5"), 6))).toBe("1d12+2d6+5");
    expect(n(addDie(t("4d6kh3"), 6))).toBe("4d6kh3+1d6");
    expect(n(addDie(t("2-1d6"), 6))).toBe("1d6+2-1d6");
    expect(n(addDie([], 20))).toBe("1d20");
    expect(n(addDie(t("50d6"), 6))).toBe("50d6"); // FR-DICE-01: at most 50 dice
  });

  test("clicking a chip removes one die; the term goes with its last die; keep fits", () => {
    expect(n(removeDie(t("2d6+1d8"), 0))).toBe("1d6+1d8");
    expect(n(removeDie(t("1d6+1d8"), 0))).toBe("1d8");
    expect(n(removeDie(t("4d6kh3"), 0))).toBe("3d6");
    expect(n(removeDie(t("1d6+3"), 1))).toBe("1d6+3"); // not a dice term
  });

  test("constant Input replaces every constant term", () => {
    expect(n(setConstant(t("1d12+5-2"), 6))).toBe("1d12+6");
    expect(n(setConstant(t("1d12+5"), -1))).toBe("1d12-1");
    expect(n(setConstant(t("1d12+5"), 0))).toBe("1d12");
  });

  test("the walkthrough step 4 compose: 1d12+5 + d6, constant 6", () => {
    expect(n(setConstant(addDie(t("1d12+5"), 6), 6))).toBe("1d12+1d6+6");
  });
});

describe("FR-DICEX-08 e adv / dis preview", () => {
  test("adv via the toggle → the 1d20 term shows two d20 chips tagged adv", () => {
    const chips = chipsOf(t("1d20+5"), "advantage");
    expect(chips.map((c) => [c.faces, c.tag])).toEqual([
      [20, "adv"],
      [20, "adv"],
    ]);
  });

  test("a request whose previewMode is dis → two d20 chips tagged dis; the toggle wins when set", () => {
    expect(chipsOf(t("1d20+5"), previewMode("normal", "disadvantage")).map((c) => c.tag)).toEqual([
      "dis",
      "dis",
    ]);
    expect(previewMode("advantage", "disadvantage")).toBe("advantage");
    expect(previewMode("normal")).toBe("normal");
  });

  test("no plain 1d20 → no tags; only the first 1d20 is doubled", () => {
    expect(chipsOf(t("2d6"), "advantage").some((c) => c.tag)).toBe(false);
    expect(chipsOf(t("1d20+1d20"), "advantage").map((c) => c.tag ?? null)).toEqual([
      "adv",
      "adv",
      null,
    ]);
  });
});

describe("FR-DICEX-17 throw zone", () => {
  test("bottom centre of the free area, at most 720×420", () => {
    const z = throwZone({ x: 68, y: 48, w: 1200, h: 700 }, []);
    expect(z).toEqual({ x: 68 + 240, y: 48 + 700 - 420, w: ZONE_MAX.w, h: ZONE_MAX.h });
    expect(throwZone({ x: 0, y: 0, w: 400, h: 300 }, [])).toEqual({ x: 0, y: 0, w: 400, h: 300 });
  });

  test("never over a window: a free area that overlaps a window (the fallback) → no zone", () => {
    const win = { x: 100, y: 100, w: 300, h: 300 };
    expect(throwZone({ x: 0, y: 0, w: 1000, h: 800 }, [win])).toBeNull();
    expect(throwZone({ x: 400, y: 0, w: 600, h: 800 }, [win])).not.toBeNull();
  });
});

describe("BL-18 palette after a result", () => {
  const notation: FreeFields = {
    expression: "1d12+5",
    mode: "normal" as const,
    category: "damage" as const,
    label: "Notation test",
    actor: { combatantId: "c1" },
  };

  test("FR-DICEX-04 BL-18 a fresh palette roll after a result keeps no label, actor or category", () => {
    expect(paletteRequest(notation, "1d6", "normal", true)).toEqual({
      expression: "1d6",
      mode: "normal",
      category: "other",
    });
  });

  test("FR-DICEX-04 adding to a staged request keeps its label", () => {
    expect(paletteRequest(notation, "1d12+1d6+5", "normal", false)).toEqual({
      ...notation,
      expression: "1d12+1d6+5",
    });
    expect(paletteRequest(null, "1d4", "advantage", false)).toEqual({
      expression: "1d4",
      mode: "advantage",
      category: "other",
    });
  });
});
