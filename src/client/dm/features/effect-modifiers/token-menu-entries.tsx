// effect-modifiers' token menu entries (FR-MOD-28, registry FR-MAP-29): "Apply effect ▸" (preset
// list: customised + built-in + campaign; acts on the selection as FR-CBTX-35) and "Effect
// modifiers…" (one token: its active custom effects, edit / end); both on tokens bound to an
// active combatant only. "Rule triggers…" (T): a monster token → its definition's triggers, a PC
// token → that character's (`./triggers-dialog`). Dialogs through the registry's Dialog mechanism.
import { CBTX_INTENTS } from "@shared/combat-extras/intents";
import { effectName } from "@shared/combat-extras/rules";
import type { EffectView } from "@shared/combat-extras/schemas";
import { COMBATANT_TYPE, type CombatantView } from "@shared/combat-tracker/schemas";
import { choiceValue, presetChoices } from "@shared/effect-modifiers/rules";
import type { TokenRecord } from "@shared/scenes-map/schemas";
import { Button } from "@ui/components/ui/button";
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@ui/components/ui/menus";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@ui/components/ui/overlays";
import { Tip } from "@ui/components/ui/tip";
import { activeEffects, creatureOf, effectsOn } from "@ui/features/combat-extras/logic";
import { modifiersText } from "@ui/features/effect-modifiers/describe";
import { EffectModifiersDialog } from "@ui/features/effect-modifiers/dialogs";
import { useModIntent, usePresets } from "@ui/features/effect-modifiers/store";
import { useRecords, useSync } from "@ui/sync/store";
import { SlidersHorizontalIcon, SparklesIcon, TrashIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { useMapSelection } from "../scenes-map/selection";
import type {
  TokenMenuDialogProps,
  TokenMenuEntry,
  TokenMenuItemProps,
} from "../scenes-map/token-menu";
import { ApplyDialog } from "./apply-dialog";
import { type ModTarget, useModDialogs } from "./store";
import { TriggersMenuDialog, TriggersMenuItem } from "./triggers-dialog";

const activeOn = (all: readonly CombatantView[], tokenId: string) =>
  all.find((c) => c.tokenId === tokenId && c.active !== false && !c.removed);

/** Bound combatants acted on: the selection if the right-clicked token is in it, else it alone. */
function useTargets(token: TokenRecord): CombatantView[] {
  const sel = useMapSelection();
  const all = useRecords<CombatantView>(COMBATANT_TYPE);
  return useMemo(() => {
    const ids = sel.tokenIds.includes(token.id) ? [...sel.tokenIds] : [token.id];
    if (!activeOn(all, token.id)) return [];
    return ids.flatMap((id) => {
      const c = activeOn(all, id);
      return c ? [c] : [];
    });
  }, [all, sel.tokenIds, token.id]);
}

const targetOf = (c: CombatantView): ModTarget => ({
  ref: c.kind === "pc" && c.entityId ? { characterId: c.entityId } : { combatantId: c.id },
  name: c.name,
});

function ApplyItem({ token, openDialog }: TokenMenuItemProps) {
  const cs = useTargets(token);
  const choices = presetChoices(usePresets());
  const open = useModDialogs((s) => s.openApply);
  if (cs.length === 0) return null;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-testid="mod-token-menu-apply">
        <SparklesIcon /> Apply effect
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {choices.map((c) => (
          <DropdownMenuItem
            key={choiceValue(c)}
            data-testid="mod-apply-preset"
            data-value={choiceValue(c)}
            onSelect={() => {
              open(cs.slice(0, 20).map(targetOf), c);
              openDialog();
            }}
          >
            {c.preset.name}
            {c.source === "customised" ? " (Customised)" : ""}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function ModifiersItem({ token, openDialog }: TokenMenuItemProps) {
  const all = useRecords<CombatantView>(COMBATANT_TYPE);
  if (!activeOn(all, token.id)) return null;
  return (
    <DropdownMenuItem data-testid="mod-token-menu-modifiers" onSelect={openDialog}>
      <SlidersHorizontalIcon /> Effect modifiers…
    </DropdownMenuItem>
  );
}

/** One token's active custom effects: their parts, Modifiers… (edit) and End. */
function ModifiersDialog({ token, close }: TokenMenuDialogProps) {
  const all = useRecords<CombatantView>(COMBATANT_TYPE);
  const store = useSync((s) => s.store);
  const { send, disabled } = useModIntent();
  const [editing, setEditing] = useState<EffectView | null>(null);
  const c = activeOn(all, token.id);
  const effects = c
    ? effectsOn(activeEffects(store), creatureOf(c)).filter((e) => e.kind === "custom")
    : [];
  return (
    <>
      <Dialog open onOpenChange={(o) => !o && close()}>
        <DialogContent data-testid="mod-token-modifiers" className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Effect modifiers</DialogTitle>
            <DialogDescription>{c?.name ?? token.name}</DialogDescription>
          </DialogHeader>
          {effects.length === 0 ? (
            <p className="text-sm text-muted-foreground">No custom effects</p>
          ) : (
            <div className="grid gap-2">
              {effects.map((e) => (
                <div
                  key={e.id}
                  data-testid="mod-active"
                  data-record-id={e.id}
                  data-value="custom"
                  className="flex items-center gap-2 text-sm"
                >
                  <div className="min-w-0 flex-1">
                    <div className="break-words">{effectName(e)}</div>
                    <div data-testid="mod-active-parts" className="text-xs text-muted-foreground">
                      {modifiersText(e.modifiers) || "No modifiers"}
                    </div>
                  </div>
                  <Tip content={`Modifiers of ${effectName(e)}`}>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      data-testid="mod-active-edit"
                      aria-label={`Modifiers of ${effectName(e)}`}
                      onClick={() => setEditing(e)}
                    >
                      <SlidersHorizontalIcon className="size-3.5" />
                    </Button>
                  </Tip>
                  <Tip content={`End ${effectName(e)}`} off={disabled}>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      data-testid="mod-active-end"
                      aria-label={`End ${effectName(e)}`}
                      disabled={disabled}
                      onClick={() => void send(CBTX_INTENTS.endEffect, { effectId: e.id })}
                    >
                      <TrashIcon className="size-3.5" />
                    </Button>
                  </Tip>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
      <EffectModifiersDialog effect={editing} onClose={() => setEditing(null)} />
    </>
  );
}

export const modTokenMenu: readonly TokenMenuEntry[] = [
  { id: "mod.apply", order: 80, Item: ApplyItem, Dialog: ApplyDialog },
  { id: "mod.modifiers", order: 81, Item: ModifiersItem, Dialog: ModifiersDialog },
  { id: "mod.triggers", order: 82, Item: TriggersMenuItem, Dialog: TriggersMenuDialog },
];
