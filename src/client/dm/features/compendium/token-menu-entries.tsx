// DM token menu "Stat block" (FR-CMP-22, registry FR-MAP-29) on monster tokens: an imported
// definition → `cmp.compendium` on its entry; a custom (campaign) definition → its NPC sheet.
// Players get no token menu.
import { ENTITY_TYPE } from "@shared/entities/schemas";
import type { TokenRecord } from "@shared/scenes-map/schemas";
import { DropdownMenuItem } from "@ui/components/ui/menus";
import { openSheetFor } from "@ui/features/character-sheet/selection";
import { CHAR_SHEET_KIND } from "@ui/features/character-sheet/window";
import { CMP_KIND, statBlockRoute } from "@ui/features/compendium/logic";
import { openDefinition } from "@ui/features/compendium/nav";
import { useOpenWindow } from "@ui/features/play-shell/ShellContext";
import { useRecords } from "@ui/sync/store";
import { BookOpenIcon } from "lucide-react";
import { useMemo } from "react";
import type { TokenMenuEntry, TokenMenuItemProps } from "../scenes-map/token-menu";

/** Monster tokens: no character behind them (FR-MAP-50 `characterId`). */
export const isMonsterToken = (t: Pick<TokenRecord, "characterId">) => t.characterId === null;

function StatBlockItem({ token }: TokenMenuItemProps) {
  const openWindow = useOpenWindow();
  const entities = useRecords<{ id: string }>(ENTITY_TYPE);
  const campaignIds = useMemo(() => new Set(entities.map((e) => e.id)), [entities]);
  return (
    <DropdownMenuItem
      data-testid="cmp-token-menu-statblock"
      onSelect={() => {
        if (statBlockRoute(token.definitionId, campaignIds) === "sheet") {
          openSheetFor(token.definitionId, "monster");
          openWindow(CHAR_SHEET_KIND);
        } else {
          openDefinition(token.definitionId);
          openWindow(CMP_KIND);
        }
      }}
    >
      <BookOpenIcon /> Stat block
    </DropdownMenuItem>
  );
}

export const cmpTokenMenu: readonly TokenMenuEntry[] = [
  { id: "cmp.statblock", order: 5, available: isMonsterToken, Item: StatBlockItem },
];
