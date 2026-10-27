// FR-KIT-101: the stat block's openers (DM only), each opening the one window on its creature
// with `by: "user"`: (1) the Initiative row ⋯ → Stat block on monster rows (bound to the row);
// (2) the token menu's Stat block (FR-CMP-22, amended: `compendium/token-menu-entries.tsx`) and
// (3) a double-click on a monster token (bound when the token is a combatant of the running
// encounter); (4) the compendium monster entry's **Open at the table**.
import type { CombatantView } from "@shared/combat-tracker/schemas";
import type { RecordStore } from "@shared/protocol/store";
import type { TokenRecord } from "@shared/scenes-map/schemas";
import { Button } from "@ui/components/ui/button";
import { DropdownMenuItem } from "@ui/components/ui/menus";
import { boundCombatant } from "@ui/features/combat-tracker/token-overlay";
import { SyncContext } from "@ui/sync/store";
import { ScrollTextIcon } from "lucide-react";
import { useContext, useEffect, useRef } from "react";
import type { TokenDoubleClick, TokenMenuDialogProps } from "../../scenes-map/token-menu";
import type { StatBlockTarget } from "./logic";
import { useOpenStatBlock } from "./store";

/** Monster tokens: no character behind them (FR-MAP-50 `characterId`). */
export const isMonsterToken = (t: Pick<TokenRecord, "characterId">) => t.characterId === null;

/** A token's target: its definition, bound to its monster combatant in the running encounter. */
export function tokenTarget(
  store: RecordStore | undefined,
  token: Pick<TokenRecord, "id" | "definitionId">,
): StatBlockTarget {
  const c = store ? boundCombatant(store, token.id) : null;
  return c && c.kind === "monster" && !c.removed
    ? { definitionId: token.definitionId, combatantId: c.id }
    : { definitionId: token.definitionId };
}

/** A monster combatant's target (bound); null for PCs or a row without a definition. */
export function rowTarget(
  c: Pick<CombatantView, "id" | "kind" | "entityId">,
): StatBlockTarget | null {
  return c.kind === "monster" && c.entityId
    ? { definitionId: c.entityId, combatantId: c.id }
    : null;
}

/** (1) Initiative row ⋯ → **Stat block** (FR-KIT-29, -101), on monster rows. */
export function StatBlockMenuItem({ c }: { c: CombatantView }) {
  const open = useOpenStatBlock();
  const target = rowTarget(c);
  if (!target) return null;
  return (
    <DropdownMenuItem
      data-testid="cbt-init-row-statblock"
      data-record-id={c.id}
      onSelect={() => open(target)}
    >
      <ScrollTextIcon /> Stat block
    </DropdownMenuItem>
  );
}

/** Opens the stat block for a token (the token menu item and the double-click). */
export function useOpenTokenStatBlock(): (token: TokenRecord) => void {
  const sync = useContext(SyncContext);
  const open = useOpenStatBlock();
  return (token) => open(tokenTarget(sync?.getState().store, token));
}

/** (3) The registry's dialog mechanism runs it once on mount and closes at once (no dialog). */
function OpenOnDoubleClick({ token, close }: TokenMenuDialogProps) {
  const open = useOpenTokenStatBlock();
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    open(token);
    close();
  }, [open, token, close]);
  return null;
}

/** (3) After the companion card's entry: an owned companion still opens its card (FR-MAP-77). */
export const statBlockDoubleClick: TokenDoubleClick = {
  id: "ent.statblock",
  order: 20,
  available: isMonsterToken,
  Dialog: OpenOnDoubleClick,
};

/** (4) The compendium monster entry's **Open at the table** (in `cmp-entry-actions`). */
export function OpenAtTable({
  definitionId,
  entryId,
  open,
}: {
  definitionId: string;
  entryId: string;
  open: (target: StatBlockTarget) => void;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-7 px-2 text-xs"
      data-testid="cmp-statblock-open"
      data-record-id={definitionId}
      onClick={() => open({ definitionId, entryId })}
    >
      <ScrollTextIcon className="size-3.5" /> Open at the table
    </Button>
  );
}
