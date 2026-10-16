// DM entry points for rule triggers (FR-MOD-28): token menu "Rule triggers…" (a monster token →
// its definition's triggers; a PC token → that character's Triggers block) and the Creatures
// window's row action (any monster definition, custom or imported). Both open one Dialog around
// the common Triggers block, which loads `rule-trigger` on open (FR-MOD-47). No new window.

import { ENTITY_TYPE, IMPORTED_ENTITY_TYPE } from "@shared/entities/schemas";
import type { RecordStore } from "@shared/protocol/store";
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
import type { TriggerOwnerRef } from "@ui/features/effect-modifiers/trigger-owner";
import { triggerOwnerFacts } from "@ui/features/effect-modifiers/trigger-owner";
import { TriggersBlock } from "@ui/features/effect-modifiers/triggers";
import { useSync } from "@ui/sync/store";
import { ZapIcon } from "lucide-react";
import { useState } from "react";
import type { CreatureAction } from "../entities/creature-actions";
import type { CreatureRow } from "../entities/list";
import type { TokenMenuDialogProps, TokenMenuItemProps } from "../scenes-map/token-menu";

/** The trigger owner a token stands for: its character, else its monster definition if held. */
export function tokenTriggerOwner(store: RecordStore, t: TokenRecord): TriggerOwnerRef | null {
  if (t.characterId) return { kind: "character", id: t.characterId };
  const def =
    (store.records[ENTITY_TYPE]?.[t.definitionId] as { kind?: string } | undefined) ??
    (store.records[IMPORTED_ENTITY_TYPE]?.[t.definitionId] as { kind?: string } | undefined);
  return def?.kind === "monster" ? { kind: "definition", id: t.definitionId } : null;
}

export function RuleTriggersDialog({
  owner,
  onClose,
}: {
  owner: TriggerOwnerRef | null;
  onClose(): void;
}) {
  const store = useSync((s) => s.store);
  const name = owner ? triggerOwnerFacts(store, owner).name : "";
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
  const store = useSync((s) => s.store);
  const owner = tokenTriggerOwner(store, token);
  if (!owner) return null;
  return (
    <DropdownMenuItem data-testid="mod-token-menu-triggers" onSelect={openDialog}>
      <ZapIcon /> Rule triggers…
    </DropdownMenuItem>
  );
}

export function TriggersMenuDialog({ token, close }: TokenMenuDialogProps) {
  const store = useSync((s) => s.store);
  return <RuleTriggersDialog owner={tokenTriggerOwner(store, token)} onClose={close} />;
}

function TriggersRowAction({ row }: { row: CreatureRow }) {
  const [open, setOpen] = useState(false);
  if (row.kind !== "monster") return null;
  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        className="size-6"
        data-testid="mod-creature-triggers"
        data-record-id={row.id}
        aria-label={`Rule triggers of ${row.name}`}
        title="Rule triggers…"
        onClick={() => setOpen(true)}
      >
        <ZapIcon className="size-3.5" />
      </Button>
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
