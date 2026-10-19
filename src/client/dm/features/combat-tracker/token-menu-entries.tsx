// Combat's token menu entries (FR-CBT-30, FR-MAP-29): "Damage / heal…", "Set as ally / enemy"
// (FR-CBT-104, #252) and "Remove from combat" on a token bound to an active, non-removed combatant.
// Items render nothing otherwise.
import { COMBATANT_TYPE, type CombatantView } from "@shared/combat-tracker/schemas";
import { DropdownMenuItem, DropdownMenuSeparator } from "@ui/components/ui/menus";
import { useCbtIntent } from "@ui/features/combat-tracker/store";
import { useRecords } from "@ui/sync/store";
import { HeartPulseIcon, UserMinusIcon } from "lucide-react";
import type { TokenMenuEntry, TokenMenuItemProps } from "../scenes-map/token-menu";
import { useCombatDialogs } from "./popup-store";
import { SideMenu } from "./side-menu";

function useBound(tokenId: string): CombatantView | undefined {
  const all = useRecords<CombatantView>(COMBATANT_TYPE);
  return all.find((c) => c.tokenId === tokenId && c.active !== false && !c.removed);
}

export const combatTokenMenu: readonly TokenMenuEntry[] = [
  {
    id: "cbt.hp",
    order: 70,
    Item: function HpItem({ token }: TokenMenuItemProps) {
      const c = useBound(token.id);
      const openHp = useCombatDialogs((s) => s.openHp);
      if (!c) return null;
      return (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem data-testid="cbt-token-menu-hp" onSelect={() => openHp(c.id)}>
            <HeartPulseIcon /> Damage / heal…
          </DropdownMenuItem>
        </>
      );
    },
  },
  {
    id: "cbt.side",
    order: 70.5,
    Item: function SideItem({ token }: TokenMenuItemProps) {
      const c = useBound(token.id);
      if (!c) return null;
      return <SideMenu c={c} testId="cbt-token-menu-side" />;
    },
  },
  {
    id: "cbt.remove",
    order: 71,
    Item: function RemoveItem({ token }: TokenMenuItemProps) {
      const c = useBound(token.id);
      const { send, disabled } = useCbtIntent();
      if (!c) return null;
      return (
        <DropdownMenuItem
          data-testid="cbt-token-menu-remove"
          disabled={disabled}
          onSelect={() => void send("cbt.setRemoved", { combatantId: c.id, removed: true })}
        >
          <UserMinusIcon /> Remove from combat
        </DropdownMenuItem>
      );
    },
  },
];
