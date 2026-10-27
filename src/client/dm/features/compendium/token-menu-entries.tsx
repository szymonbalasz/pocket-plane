// DM token menu "Stat block" (FR-CMP-22, registry FR-MAP-29) on monster tokens, imported or
// custom. Kit parity K7 (FR-KIT-101, amends FR-CMP-22): it opens the rollable stat-block window
// `ent.statblock`, bound to the token's combatant in a running fight; the window's footer links
// on to the compendium entry (imported) or the NPC sheet (custom). Players get no token menu.
import { DropdownMenuItem } from "@ui/components/ui/menus";
import { BookOpenIcon } from "lucide-react";
import { isMonsterToken, useOpenTokenStatBlock } from "../entities/statblock/openers";
import type { TokenMenuEntry, TokenMenuItemProps } from "../scenes-map/token-menu";

function StatBlockItem({ token }: TokenMenuItemProps) {
  const open = useOpenTokenStatBlock();
  return (
    <DropdownMenuItem data-testid="cmp-token-menu-statblock" onSelect={() => open(token)}>
      <BookOpenIcon /> Stat block
    </DropdownMenuItem>
  );
}

export const cmpTokenMenu: readonly TokenMenuEntry[] = [
  { id: "cmp.statblock", order: 5, available: isMonsterToken, Item: StatBlockItem },
];
