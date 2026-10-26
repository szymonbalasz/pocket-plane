// theme-system FR-THEME-02: the player client's Preferences registry holds the Appearance section once.
import { expect, test } from "bun:test";
import { appearanceSection } from "@ui/themes/AppearanceSection";
import { playerPrefSections } from "../../pref-sections";

test("FR-THEME-02 appearance section (player): registered once in the pref-sections registry", () => {
  expect(playerPrefSections.filter((s) => s.id === "theme.appearance")).toEqual([
    appearanceSection,
  ]);
});
