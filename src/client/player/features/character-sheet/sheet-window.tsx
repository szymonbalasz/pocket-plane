// Player `char.sheet`: open by default, top-right below the top bar (CHAR §7, FR-CHAR-15).
import { CharacterSheet } from "@ui/features/character-sheet/CharacterSheet";
import { charSheetWindowBase } from "@ui/features/character-sheet/window";
import { defineWindow } from "@ui/features/play-shell/registry";
import { UserRoundIcon } from "lucide-react";

export const playerCharSheetWindow = defineWindow({
  ...charSheetWindowBase,
  clients: ["player"],
  defaultPosition: { anchor: "top-right" },
  defaultOpen: true,
  launcher: { icon: UserRoundIcon, label: "Sheet", order: 50 },
  component: CharacterSheet,
});
