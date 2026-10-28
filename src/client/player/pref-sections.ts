// Player Preferences sections (FR-SHELL-72). APPEND-ONLY (AGENTS §9.9): a feature adds one import
// and one line; nothing else changes here. Contract: `PrefSection` in `@ui/features/play-shell/
// PreferencesWindow`; sections stack in `order`, ids `<spec prefix>.<name>` (FR-SHELL-75).

import { colorSection } from "@ui/features/campaign-management/ColorSection";
import { diceSection } from "@ui/features/dice-extras/DiceSection";
import { soundSection } from "@ui/features/play-shell/AlertLayer";
import { layoutSection, type PrefSection } from "@ui/features/play-shell/PreferencesWindow";
import { keyboardSection } from "@ui/features/play-shell/palette/KeyboardSection";
import { vfxPrefSection } from "@ui/features/spell-fx/PrefsSection";
import { statsPrefSection } from "@ui/features/stats/PrefsSection";
import { appearanceSection } from "@ui/themes/AppearanceSection";

export const playerPrefSections: readonly PrefSection[] = [
  soundSection, // shell.sound "Sound", 20 (play-shell, FR-SHELL-73)
  layoutSection, // shell.layout "Layout", 80 (play-shell, FR-SHELL-74)
  colorSection, // camp.color "Your colour", 10 (campaign-management, FR-CAMP-35)
  diceSection, // dicex.dice "Dice", 30 (dice-extras, FR-DICEX-57)
  statsPrefSection, // stats.prefs "Stats", 40 (stats, FR-STATS-30, -34)
  keyboardSection, // shell.keys "Keyboard", 70 (play-shell, FR-SHELL-193)
  appearanceSection, // theme.appearance "Appearance", 15 (theme-system, FR-THEME-02)
  vfxPrefSection, // vfx.level "Map effects", 35 (spell-fx, FR-VFX-25)
];
