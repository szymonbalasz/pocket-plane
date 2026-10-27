// Creatures window row action "Sheet" (FR-CHARX-31, DM): opens `char.sheet` on that definition
// (custom: editable NPC sheet; imported: read-only) or character. K10 (K6 §5): an icon button like
// the row's other actions, "Sheet" in its Tooltip.

import { Button } from "@ui/components/ui/button";
import { Tooltip } from "@ui/components/ui/overlays";
import { openSheetFor } from "@ui/features/character-sheet/selection";
import { CHAR_SHEET_KIND } from "@ui/features/character-sheet/window";
import { useOpenWindow } from "@ui/features/play-shell/ShellContext";
import { ScrollTextIcon } from "lucide-react";
import type { CreatureAction } from "../entities/creature-actions";
import type { CreatureRow } from "../entities/list";

function SheetRowAction({ row }: { row: CreatureRow }) {
  const openWindow = useOpenWindow();
  return (
    <Tooltip content="Sheet">
      <Button
        size="icon"
        variant="ghost"
        className="size-6"
        data-testid="charx-open-sheet"
        data-record-id={row.id}
        aria-label={`Sheet of ${row.name}`}
        onClick={() => {
          openSheetFor(row.id, row.kind);
          openWindow(CHAR_SHEET_KIND);
        }}
      >
        <ScrollTextIcon className="size-3.5" />
      </Button>
    </Tooltip>
  );
}

export const sheetCreatureAction: CreatureAction = {
  placement: "row",
  id: "charx.sheet",
  component: SheetRowAction,
};
