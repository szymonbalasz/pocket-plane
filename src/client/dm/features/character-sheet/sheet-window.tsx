// DM `char.sheet`: closed by default, launcher "Sheets" (CHAR §7, FR-CHAR-15).
import { CharacterSheet } from "@ui/features/character-sheet/CharacterSheet";
import { charSheetWindowBase } from "@ui/features/character-sheet/window";
import { defineWindow } from "@ui/features/play-shell/registry";
import { UserRoundIcon } from "lucide-react";

export const dmCharSheetWindow = defineWindow({
  ...charSheetWindowBase,
  clients: ["dm"],
  // CHAR §7 says "right, below camp.players" (540×360 top-right). A 440-tall window can't sit
  // below it at 1280×720 and stay in the viewport (FR-SHELL-08), so: right edge, bottom-anchored
  // (y 204 at 720, 384 at 900). Not default-open, so it may overlap camp.players.
  defaultPosition: { anchor: "bottom-right" },
  launcher: { icon: UserRoundIcon, label: "Sheets", order: 50 },
  component: CharacterSheet,
});
