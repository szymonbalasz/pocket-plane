// Creatures window row action "Sheet" (FR-CHARX-31, DM): opens `char.sheet` on that definition
// (custom: editable NPC sheet; imported: read-only) or character.

import { Button } from "@ui/components/ui/button";
import { openSheetFor } from "@ui/features/character-sheet/selection";
import { CHAR_SHEET_KIND } from "@ui/features/character-sheet/window";
import { useOpenWindow } from "@ui/features/play-shell/ShellContext";
import type { CreatureAction } from "../entities/creature-actions";
import type { CreatureRow } from "../entities/list";

function SheetRowAction({ row }: { row: CreatureRow }) {
  const openWindow = useOpenWindow();
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-6 px-2 text-xs"
      data-testid="charx-open-sheet"
      data-record-id={row.id}
      onClick={() => {
        openSheetFor(row.id, row.kind);
        openWindow(CHAR_SHEET_KIND);
      }}
    >
      Sheet
    </Button>
  );
}

export const sheetCreatureAction: CreatureAction = {
  placement: "row",
  id: "charx.sheet",
  component: SheetRowAction,
};
