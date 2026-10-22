// Sheet sections registry (CHARX §7.1, FR-CHARX-34). APPEND-ONLY (AGENTS §9.9): a feature adds
// one import and one line; nothing else changes here. Contract: `SheetSection` in `./sections`.
// combat-extras adds `cbtx.temp-hp`, `cbtx.death-saves` (vitals) and `cbtx.effects` (header).
import {
  cbtxDeathSavesSection,
  cbtxEffectsSection,
  cbtxTempHpSection,
} from "../combat-extras/sheet-sections";
import { modEffectsSection } from "../effect-modifiers/section";
import { gemCountsSection } from "../gems/GemBlock";
import { statsTrophiesSection } from "../stats/trophies/TrophiesTab";
import type { SheetSection } from "./sections";

export const sheetSections: readonly SheetSection[] = [
  cbtxTempHpSection, // cbtx.temp-hp, vitals (combat-extras, FR-CBTX-41)
  cbtxDeathSavesSection, // cbtx.death-saves, vitals (combat-extras, FR-CBTX-41)
  cbtxEffectsSection, // cbtx.effects, header (combat-extras, FR-CBTX-41)
  modEffectsSection, // mod.effects, tab "Active effects" (effect-modifiers, FR-MOD-26)
  gemCountsSection, // gem.counts, header after cbtx.effects (gems, FR-CHARX-71)
  statsTrophiesSection, // stats.trophies, tab "Trophies", order 100, last (stats, FR-CHARX-97)
];
