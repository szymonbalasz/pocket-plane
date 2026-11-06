// FR-VFX-40: a cast template ends with its effect. An effect-changed hook (`effectHooks`, ADR-0049):
// for every creature whose effects changed, the ended effects that carry `fx.templateId` lose
// that kept template if it is still there (End, a concentration drop, a replaced concentration,
// any effect path). The template's record change rides the causing event; no event of its own.
import type { TargetRef } from "@shared/combat-extras/intents";
import { and, eq, isNotNull, or, type SQL } from "drizzle-orm";
import { effect } from "../../db/schema";
import type { EffectHook } from "../combat-extras/effect-hooks";
import { removeKeptTemplates } from "../scene-tools/templates";

const targetOf = (c: TargetRef): SQL =>
  "characterId" in c
    ? eq(effect.targetCharacterId, c.characterId)
    : eq(effect.targetCombatantId, c.combatantId);

export const spellFxTemplateEffectHook: EffectHook = {
  id: "spell-fx.cast-template",
  effectsChanged(env, { creatures }) {
    if (creatures.length === 0) return [];
    const targets = creatures.map(targetOf);
    const ids = env.tx
      .select({ fx: effect.fx })
      .from(effect)
      .where(and(or(...targets), isNotNull(effect.endedAt), isNotNull(effect.fx)))
      .all()
      .flatMap((r) => (r.fx?.templateId ? [r.fx.templateId] : []));
    return ids.length === 0 ? [] : removeKeptTemplates(env.tx, ids);
  },
};
