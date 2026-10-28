// Cast / End on spell rows (FR-VFX-06, OQ-VFX-01 A; spell-row actions registry, OQ-VFX-06 A): a
// row with `fx` shows **Cast** after its roll buttons (view and Main's Spells box) while no
// active effect on the creature carries `fx.spellId` = the row, else **End** (`cbtx.endEffect`)
// beside CBTX's chip for that effect. Cast sends `vfx.cast` (DM any sheet; the owner on theirs,
// locked or not, like counters). Disabled while not live; a reject toasts. Test ID `vfx-cast`
// (`data-record-id` = spell id, `data-state` = `cast` | `end`).
import { CBTX_INTENTS } from "@shared/combat-extras/intents";
import type { EffectView } from "@shared/combat-extras/schemas";
import { COMBATANT_TYPE, type CombatantView } from "@shared/combat-tracker/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { VFX_INTENTS } from "@shared/spell-fx/intents";
import { SparklesIcon, SquareIcon } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useSync } from "../../sync/store";
import { useSheet, useSheetScope } from "../character-sheet/sheet-context";
import type { SpellRowAction, SpellRowActionProps } from "../character-sheet/spell-row-actions";
import { activeEffects } from "../combat-extras/logic";
import { EffectChips } from "../combat-extras/parts";
import { useCbtIntent, useStartedEncounter } from "../combat-tracker/store";

/**
 * FR-VFX-06: the active effect cast from this row on the creature (a character: its own effects;
 * a monster, DM: effects on its combatants), else null.
 */
export function castEffectOf(
  store: RecordStore,
  creatureId: string,
  spellId: string,
): EffectView | null {
  const combatants = store.records[COMBATANT_TYPE] ?? {};
  return (
    activeEffects(store).find((e) => {
      if (e.fx?.spellId !== spellId) return false;
      if (e.targetCharacterId) return e.targetCharacterId === creatureId;
      const c = e.targetCombatantId
        ? (combatants[e.targetCombatantId] as CombatantView | undefined)
        : undefined;
      return c?.entityId === creatureId;
    }) ?? null
  );
}

function CastButton({ creatureId, row }: SpellRowActionProps) {
  const ctx = useSheet();
  const kit = useSheetScope() === "main";
  const active = useSync((s) => castEffectOf(s.store, creatureId, row.id));
  const enc = useStartedEncounter();
  const { send, disabled } = useCbtIntent();
  // OQ-VFX-01 A: the DM and the owner (who may count on the sheet, locked or not).
  if (!ctx.canCount) return null;
  const state = active ? "end" : "cast";
  return (
    <span className="inline-flex items-center gap-1">
      {active && active.kind === "concentration" && (
        <EffectChips effects={[active]} round={enc?.round ?? null} testId="vfx-cast-chip" />
      )}
      <Button
        size="sm"
        variant="outline"
        className={kit ? "h-6 px-[9px] text-[13px]" : "h-7 gap-1 px-2 text-xs"}
        data-testid="vfx-cast"
        data-record-id={row.id}
        data-state={state}
        disabled={disabled}
        onClick={() =>
          void (active
            ? send(CBTX_INTENTS.endEffect, { effectId: active.id })
            : send(VFX_INTENTS.cast, { creatureId, spellId: row.id }))
        }
      >
        {active ? <SquareIcon className="size-3" /> : <SparklesIcon className="size-3" />}
        {active ? "End" : "Cast"}
      </Button>
    </span>
  );
}

export const vfxCastAction: SpellRowAction = {
  id: "vfx.cast",
  order: 10,
  kinds: ["character", "monster"],
  available: (_store, _creatureId, row) => row.fx !== undefined,
  component: CastButton,
};
