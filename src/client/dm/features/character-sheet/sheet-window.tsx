// DM `char.sheet`: closed by default, launcher "Sheets" (CHAR §7, FR-CHAR-15).
import { CharacterSheet } from "@ui/features/character-sheet/CharacterSheet";
import { charSheetWindowBase } from "@ui/features/character-sheet/window";
import { defineWindow } from "@ui/features/play-shell/registry";
import { UserRoundIcon } from "lucide-react";

export const dmCharSheetWindow = defineWindow({
  ...charSheetWindowBase,
  clients: ["dm"],
  // CHAR §7 says "right, below camp.players"; the right edge is `cbt.initiative`'s (protocol
  // §24). Top edge, left of it; the next free slot if taken (FR-SHELL-08).
  // At 1280×720 no 440-px slot is free beside the default windows: it opens shrunk (≥ min) in
  // the free slot and the sheet scrolls inside down to Damage / Heal.
  defaultPosition: { anchor: "top-right", dx: 412 },
  launcher: { icon: UserRoundIcon, label: "Sheets", order: 50 },
  component: CharacterSheet,
});
