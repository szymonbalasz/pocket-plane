// MOD's trigger-state lines (FR-MOD-54; ADR-0049, seams S6): the combat rule-hook points (in
// MOD's existing `combatRuleHooks` line, after CBTX's so expiries and restores count) and MOD's
// line in CBTX's `effectHooks` registry. Both rewrite rows through `triggerStates` in the causing
// transaction; the rows join the causing event's `changes`.

import type { EffectHook } from "../combat-extras/effect-hooks";
import type { CombatRuleHookSet } from "../combat-tracker/rule-hooks";
import { combatantsOfCreatures, triggerStates } from "./trigger-state-writes";

/** `started` / `added` create, `turnChanged` (Next and Prev) recharges, `ended` deletes all. */
export const triggerStateRuleHooks = {
  started: (env, enc, d) => triggerStates(env, enc, d.combatantIds),
  added: (env, enc, d) => triggerStates(env, enc, d.combatantIds),
  turnChanged: (env, enc) => triggerStates(env, enc),
  ended: (env, enc) => triggerStates(env, enc),
} satisfies Required<CombatRuleHookSet>;

/**
 * Effects changed (FR-CBTX-51): `armed` of the changed creatures' rows. Creatures without a
 * combatant in the started encounter, and every change out of combat, write nothing.
 */
export const modTriggerStateEffectHook: EffectHook = {
  id: "effect-modifiers.trigger-state",
  effectsChanged(env, { creatures, encounter }) {
    if (encounter?.status !== "started") return [];
    const ids = combatantsOfCreatures(env.tx, encounter, creatures);
    return triggerStates(env, encounter, ids);
  },
};
