// DM entry points for rule triggers (FR-MOD-28): token menu "Rule triggers…" (a monster token →
// its definition's triggers; a PC token → that character's Triggers block) and the Creatures
// window's row action (any monster definition, custom or imported). Both open one Dialog around
// the common Triggers block, which loads `rule-trigger` on open (FR-MOD-47). No new window.

import type { DefinitionRecord } from "@shared/entities/schemas";
import type { TokenRecord } from "@shared/scenes-map/schemas";
import { Button } from "@ui/components/ui/button";
import { DropdownMenuItem } from "@ui/components/ui/menus";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@ui/components/ui/overlays";
import { Tip } from "@ui/components/ui/tip";
import { useDefinitions } from "@ui/features/compendium/definitions";
import type { TriggerOwnerRef } from "@ui/features/effect-modifiers/trigger-owner";
import {
  triggerOwnerFacts,
  useOwnerDefinitions,
} from "@ui/features/effect-modifiers/trigger-owner";
import { TriggersBlock } from "@ui/features/effect-modifiers/triggers";
import { useSync } from "@ui/sync/store";
import { ZapIcon } from "lucide-react";
import { useState } from "react";
import type { CreatureAction } from "../entities/creature-actions";
import type { CreatureRow } from "../entities/list";
import type { TokenMenuDialogProps, TokenMenuItemProps } from "../scenes-map/token-menu";

/**
 * The trigger owner a token stands for: its character, else its monster definition if held.
 * `definitions`: `useDefinitions([token.definitionId]).byId` (an imported one loads, FR-CMP-16).
 */
export function tokenTriggerOwner(
  t: TokenRecord,
  definitions: ReadonlyMap<string, DefinitionRecord>,
): TriggerOwnerRef | null {
  if (t.characterId) return { kind: "character", id: t.characterId };
  const def = definitions.get(t.definitionId);
  return def?.kind === "monster" ? { kind: "definition", id: t.definitionId } : null;
}

/** The token's trigger owner, loading an imported definition on demand. */
function useTokenTriggerOwner(t: TokenRecord): TriggerOwnerRef | null {
  const defs = useDefinitions(t.characterId ? [] : [t.definitionId]).byId;
  return tokenTriggerOwner(t, defs);
}

export function RuleTriggersDialog({
  owner,
  onClose,
}: {
  owner: TriggerOwnerRef | null;
  onClose(): void;
}) {
  const store = useSync((s) => s.store);
  const definitions = useOwnerDefinitions(owner);
  const name = owner ? triggerOwnerFacts(store, owner, definitions).name : "";
  return (
    <Dialog open={owner !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent data-testid="mod-triggers-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rule triggers</DialogTitle>
          <DialogDescription>
            {owner?.kind === "definition" ? `${name} (every combatant of it)` : name}
          </DialogDescription>
        </DialogHeader>
        {owner && <TriggersBlock owner={owner} />}
      </DialogContent>
    </Dialog>
  );
}

export function TriggersMenuItem({ token, openDialog }: TokenMenuItemProps) {
  const owner = useTokenTriggerOwner(token);
  if (!owner) return null;
  return (
    <DropdownMenuItem data-testid="mod-token-menu-triggers" onSelect={openDialog}>
      <ZapIcon /> Rule triggers…
    </DropdownMenuItem>
  );
}

export function TriggersMenuDialog({ token, close }: TokenMenuDialogProps) {
  return <RuleTriggersDialog owner={useTokenTriggerOwner(token)} onClose={close} />;
}

function TriggersRowAction({ row }: { row: CreatureRow }) {
  const [open, setOpen] = useState(false);
  if (row.kind !== "monster") return null;
  return (
    <>
      <Tip content={`Rule triggers of ${row.name}`}>
        <Button
          size="icon"
          variant="ghost"
          className="size-6"
          data-testid="mod-creature-triggers"
          data-record-id={row.id}
          aria-label={`Rule triggers of ${row.name}`}
          onClick={() => setOpen(true)}
        >
          <ZapIcon className="size-3.5" />
        </Button>
      </Tip>
      {open && (
        <RuleTriggersDialog
          owner={{ kind: "definition", id: row.id }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** Creatures window row action (`creatureActions`, append-only registry). */
export const modCreatureTriggersAction: CreatureAction = {
  placement: "row",
  id: "mod.triggers",
  component: TriggersRowAction,
};
