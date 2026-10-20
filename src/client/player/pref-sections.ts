// Player Preferences sections (FR-SHELL-72). APPEND-ONLY (AGENTS §9.9): a feature adds one import
// and one line; nothing else changes here. Contract: `PrefSection` in `@ui/features/play-shell/
// PreferencesWindow`; sections stack in `order`, ids `<spec prefix>.<name>` (FR-SHELL-75).

import { colorSection } from "@ui/features/campaign-management/ColorSection";
import { soundSection } from "@ui/features/play-shell/AlertLayer";
import { layoutSection, type PrefSection } from "@ui/features/play-shell/PreferencesWindow";

export const playerPrefSections: readonly PrefSection[] = [
  soundSection, // shell.sound "Sound", 20 (play-shell, FR-SHELL-73)
  layoutSection, // shell.layout "Layout", 80 (play-shell, FR-SHELL-74)
  colorSection, // camp.color "Your colour", 10 (campaign-management, FR-CAMP-35)
];
