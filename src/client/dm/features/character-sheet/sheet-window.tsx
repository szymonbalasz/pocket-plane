// DM `char.sheet`: closed by default, launcher "Sheets" (CHAR §7, FR-CHAR-15).
import { CharacterSheet } from "@ui/features/character-sheet/CharacterSheet";
import { charSheetWindowBase } from "@ui/features/character-sheet/window";
import { defineWindow } from "@ui/features/play-shell/registry";
import { UserRoundIcon } from "lucide-react";

export const dmCharSheetWindow = defineWindow({
  ...charSheetWindowBase,
  clients: ["dm"],
  // CHAR §7 says "right, below camp.players"; that spot is `cbt.initiative`'s (protocol §24).
  // Right side, left of the right column; the next free slot if taken (FR-SHELL-08).
  defaultPosition: { anchor: "top-right", dx: 412 },
  launcher: { icon: UserRoundIcon, label: "Sheets", order: 50 },
  component: CharacterSheet,
});
