// DM `char.sheet`: closed by default, launcher "Sheets" (CHAR §7, FR-CHAR-15).
import { CharacterSheet } from "@ui/features/character-sheet/CharacterSheet";
import { charSheetWindowBase } from "@ui/features/character-sheet/window";
import { defineWindow } from "@ui/features/play-shell/registry";
import { UserRoundIcon } from "lucide-react";

export const dmCharSheetWindow = defineWindow({
  ...charSheetWindowBase,
  clients: ["dm"],
  // CHAR §7: right edge (map-first, #162: never mid-map). Bottom-right, so below
  // `cbt.initiative`, shrunk (≥ min) where it is short; no room there (1280×720) → the left
  // edge (protocol §24). The sheet scrolls inside down to Damage / Heal.
  defaultPosition: { anchor: "bottom-right" },
  launcher: { icon: UserRoundIcon, label: "Sheets", order: 50 },
  component: CharacterSheet,
});
