// Weapon damage parts in combat (FR-CBT-81, -83; sprint 4): an attack row's extra damage parts
// (CHARX's `attackRollSpecs` / `characterRolls` specs with `part.extra`) rolled as their own roll
// rows of the entry, without a roll subject (effect mods attach to the base part), dice doubled
// on a crit; physical entries one per part (`manualExtra`, row order). The card stores them on
// `damage.extra`.
import type { CharacterRollSpec } from "@shared/character-sheet/logic";
import { critExpression } from "@shared/combat-tracker/rules";
import type { CardExtraPart } from "@shared/combat-tracker/schemas";
import type { ManualEntry } from "@shared/dice-roll-log/schemas";
import type { PartDamageType } from "@shared/effect-modifiers/schemas";
import type { z } from "zod";
import type { CommandEnv } from "../../commands/commands";
import { invalid } from "../../commands/errors";
import { dice, type EvaluatedRoll } from "../dice-roll-log";
import { critLabel } from "./attack";
import { cardRollOf } from "./card-kind";

/** The damage specs of a row split into its base part and its extra parts (row order). */
export function splitParts(specs: readonly CharacterRollSpec[]): {
  base: CharacterRollSpec | undefined;
  extra: CharacterRollSpec[];
} {
  return {
    base: specs.find((s) => !s.part?.extra),
    extra: specs.filter((s) => s.part?.extra === true),
  };
}

/**
 * FR-CBT-81: one physical entry per extra part, sent with the base part's `manual` (the schema
 * checks that pairing); a count other than the row's parts → `invalid`.
 */
export function checkManualExtra(
  extra: readonly CharacterRollSpec[],
  manual: unknown,
  manualExtra: readonly ManualEntry[] | undefined,
): void {
  if (manual === undefined) return;
  const n = manualExtra?.length ?? 0;
  if (n === extra.length) return;
  const message = `Enter ${extra.length} physical damage part${extra.length === 1 ? "" : "s"}`;
  throw invalid(message, [{ path: ["manualExtra"], message }]);
}

/** FR-CBT-81, -83: roll every extra part (doubled dice on a crit), no hooks. */
export function rollExtraParts(
  env: CommandEnv,
  extra: readonly CharacterRollSpec[],
  o: {
    crit: boolean;
    actor: { kind: "entity"; id: string; name: string };
    manual?: readonly ManualEntry[];
  },
): EvaluatedRoll[] {
  return extra.map((spec, i) => {
    const m = o.manual?.[i];
    return dice.evaluate(env, {
      expression: o.crit ? critExpression(spec.expression) : spec.expression,
      mode: "normal",
      category: spec.category,
      label: o.crit ? critLabel(spec.label) : spec.label,
      actor: o.actor,
      ...(m ? { manual: m } : {}),
      source: "cbt",
    });
  });
}

/** The card's `damage.extra` (absent = none). */
export function cardExtraOf(
  extra: readonly CharacterRollSpec[],
  rolls: readonly EvaluatedRoll[],
): { extra?: CardExtraPart[] } {
  if (rolls.length === 0) return {};
  return {
    extra: rolls.map((r, i) => ({
      type: extra[i]?.part?.type as z.infer<typeof PartDamageType>,
      ...cardRollOf(r),
    })),
  };
}
