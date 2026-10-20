// FR-CAMP-35 (a) / FR-DICEX-57 (dm): "Your colour" and "Dice" registered in this client's
// Preferences registry with their FR-SHELL-72 order.
import { expect, test } from "bun:test";
import { colorSection } from "@ui/features/campaign-management/ColorSection";
import { diceSection } from "@ui/features/dice-extras/DiceSection";
import { dmPrefSections } from "../../pref-sections";

test("FR-CAMP-35 picker (dm): camp.color 'Your colour' registered once at order 10", () => {
  expect(dmPrefSections.filter((s) => s.id === "camp.color")).toEqual([colorSection]);
  expect(colorSection).toMatchObject({ title: "Your colour", order: 10 });
});

test("FR-DICEX-57 dice section (dm): dicex.dice 'Dice' registered once at order 30", () => {
  expect(dmPrefSections.filter((s) => s.id === "dicex.dice")).toEqual([diceSection]);
  expect(diceSection).toMatchObject({ title: "Dice", order: 30 });
});
