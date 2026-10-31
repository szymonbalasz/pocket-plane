// FR-SHARE-02: the Send to game log button on a character sheet's rows: the DM and the owner (who
// may count on the sheet, `canCount`, locked or not); not in edit mode, not on NPC sheets, not on a
// legacy row without an id. Spell rows register through `spell-row-actions` (OQ-VFX-06 A).
import type { ShareSheetList } from "@shared/log-share/schemas";
import { useSheet, useSheetScope } from "../character-sheet/sheet-context";
import type { SpellRowAction, SpellRowActionProps } from "../character-sheet/spell-row-actions";
import { ShareButton } from "./ShareButton";

export function SheetShare({ list, rowId }: { list: ShareSheetList; rowId: string | undefined }) {
  const ctx = useSheet();
  const kit = useSheetScope() === "main";
  if (!rowId || ctx.npc || ctx.creature.kind !== "character") return null;
  if (!ctx.canCount || (ctx.editing && ctx.canEdit)) return null;
  return (
    <ShareButton
      source={{ from: "sheet", creatureId: ctx.creature.id, list, rowId }}
      className={kit ? "size-6 shrink-0" : "size-7 shrink-0"}
    />
  );
}

function ShareSpell({ row }: SpellRowActionProps) {
  return <SheetShare list="spells" rowId={row.id} />;
}

export const shareSpellAction: SpellRowAction = {
  id: "share.send",
  order: 20,
  component: ShareSpell,
};
