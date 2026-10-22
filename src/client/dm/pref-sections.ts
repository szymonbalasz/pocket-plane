// DM Preferences sections (FR-SHELL-72). APPEND-ONLY (AGENTS §9.9): a feature adds one import and
// one line; nothing else changes here. Contract: `PrefSection` in `@ui/features/play-shell/
// PreferencesWindow`; sections stack in `order`, ids `<spec prefix>.<name>` (FR-SHELL-75).
import { colorSection } from "@ui/features/campaign-management/ColorSection";
import { diceSection } from "@ui/features/dice-extras/DiceSection";
import { layoutSection, type PrefSection } from "@ui/features/play-shell/PreferencesWindow";
import { statsPrefSection } from "@ui/features/stats/PrefsSection";
import { accountSection } from "./features/campaign-management/AccountSection";

export const dmPrefSections: readonly PrefSection[] = [
  layoutSection, // shell.layout "Layout", 80 (play-shell, FR-SHELL-74)
  accountSection, // camp.account "Account", 90 (campaign-management, FR-CAMP-35)
  colorSection, // camp.color "Your colour", 10 (campaign-management, FR-CAMP-35)
  diceSection, // dicex.dice "Dice", 30 (dice-extras, FR-DICEX-57)
  statsPrefSection, // stats.prefs "Stats", 40 (stats, FR-STATS-30, -34)
];
