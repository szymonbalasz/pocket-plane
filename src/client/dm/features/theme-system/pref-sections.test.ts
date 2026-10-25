// theme-system FR-THEME-02: the DM client's Preferences registry holds the Appearance section once.
import { expect, test } from "bun:test";
import { appearanceSection } from "@ui/themes/AppearanceSection";
import { dmPrefSections } from "../../pref-sections";

test("FR-THEME-02 appearance section (DM): registered once in the pref-sections registry", () => {
  expect(dmPrefSections.filter((s) => s.id === "theme.appearance")).toEqual([appearanceSection]);
});
