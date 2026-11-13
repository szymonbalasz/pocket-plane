// FR-FORM-06 (ADR-0081): token forms' line in combat-extras' `effectHooks` registry (ADR-0049 D2).
// Any effect insert, end, update or restore on a character (toggle, expiry, Down, encounter End,
// undo / Prev) re-derives that character's shown form, so no end path needs its own case. Monsters
// have no forms: a combatant target changes nothing. No top-level use of imports.
import type { EffectHook } from "../combat-extras/effect-hooks";
import { rederiveForms } from "./derive";

export const tokenFormsEffectHook: EffectHook = {
  id: "token-forms.shown-form",
  effectsChanged(env, { creatures }) {
    const chars = creatures.flatMap((c) => ("characterId" in c ? [c.characterId] : []));
    return chars.length === 0 ? [] : rederiveForms(env, chars);
  },
};
