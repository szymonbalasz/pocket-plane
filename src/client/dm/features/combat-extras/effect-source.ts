// FR-CBTX-55 (OQ-CBTX-28 A, sim-8 #10): the Effect… dialog's default source never names a hidden
// monster. Display only: the chosen `sourceCombatantId` is sent as is (FR-CBTX-04, -05).
import type { TargetRef } from "@shared/combat-extras/intents";
import type { CombatantView } from "@shared/combat-tracker/schemas";

/** Why the source was picked (`data-default` on the Source select). */
export type SourceDefault = "turn" | "target" | "none";

/** The started encounter's row of a target creature (its own active combatant). */
const rowOf = (rows: readonly CombatantView[], ref: TargetRef) =>
  rows.find(
    (c) =>
      !c.removed &&
      c.active !== false &&
      ("combatantId" in ref
        ? c.id === ref.combatantId
        : c.kind === "pc" && c.entityId === ref.characterId),
  );

/**
 * The turn combatant if it is neither hidden nor removed; else the first target's own active
 * combatant in `rows` (the started encounter's); else none.
 */
export function defaultEffectSource(
  rows: readonly CombatantView[],
  turnCombatantId: string | null | undefined,
  targets: readonly TargetRef[],
): { id: string | null; why: SourceDefault } {
  const turn = rows.find((c) => c.id === turnCombatantId);
  if (turn && !turn.hidden && !turn.removed) return { id: turn.id, why: "turn" };
  const first = targets[0] ? rowOf(rows, targets[0]) : undefined;
  return first ? { id: first.id, why: "target" } : { id: null, why: "none" };
}
