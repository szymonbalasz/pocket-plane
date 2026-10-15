// DM `char.sheet`: closed by default, launcher "Sheets" (CHAR §7, FR-CHAR-15). While it is open
// on a draft, that draft's "made a character" toast closes (P3 glitch 8).
import type { NotificationRecord } from "@shared/notifications/schemas";
import { CharacterSheet } from "@ui/features/character-sheet/CharacterSheet";
import { draftToastsShown } from "@ui/features/character-sheet/note-views";
import { sheetSelection } from "@ui/features/character-sheet/selection";
import { CHAR_SHEET_KIND, charSheetWindowBase } from "@ui/features/character-sheet/window";
import { hideToast } from "@ui/features/notifications/toasts";
import { defineWindow } from "@ui/features/play-shell/registry";
import { useShellState } from "@ui/features/play-shell/ShellContext";
import { useRecords } from "@ui/sync/store";
import { UserRoundIcon } from "lucide-react";
import { useEffect } from "react";
import { useStore } from "zustand";

function DmCharacterSheet() {
  const open = useShellState((s) =>
    s.windows.some((w) => w.kind === CHAR_SHEET_KIND && w.state === "open"),
  );
  const selectedId = useStore(sheetSelection, (s) => s.selectedId);
  const notes = useRecords<NotificationRecord>("notification");
  const ids = draftToastsShown(notes, open ? selectedId : null).join();
  useEffect(() => {
    for (const id of ids ? ids.split(",") : []) hideToast(id);
  }, [ids]);
  return <CharacterSheet />;
}

export const dmCharSheetWindow = defineWindow({
  ...charSheetWindowBase,
  clients: ["dm"],
  // CHAR §7: right edge (map-first, #162: never mid-map). Bottom-right, so below
  // `cbt.initiative`, shrunk (≥ min) where it is short; no room there (1280×720) → the left
  // edge (protocol §24). The sheet scrolls inside down to Damage / Heal.
  defaultPosition: { anchor: "bottom-right" },
  launcher: { icon: UserRoundIcon, label: "Sheets", order: 50 },
  component: DmCharacterSheet,
});
