// MOD's roll hook (FR-MOD-14, registered in dice-roll-log's `rollHooks`): the creature's active
// effects whose modifiers match the subject → parts. `dice` → its own roll row through
// `base.rollExtra` (doubled on a crit's damage), signed; `flat` → its value. Tier 2 kinds
// (`mode`, `defense`, AC) never reach a stored row in tier 1 and are ignored here.
//
// Imports stay to the schema and `@shared`: `roll-hooks.ts` (imported by `dice.evaluate`)
// imports this module, so feature helpers here would close an import cycle.
import { effectVisibleToPlayers } from "@shared/combat-extras/schemas";
import { type CreatureRef, matchingMods, partDice } from "@shared/effect-modifiers/rules";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import { combatant, effect } from "../../db/schema";
import type { RollHook, RollPart, RollSubject } from "../dice-roll-log/roll-hooks";

/** A PC combatant's subject is its character (FR-MOD-15). */
function creatureOf(env: CommandEnv, s: RollSubject): CreatureRef {
  if ("characterId" in s.creature) return s.creature;
  const c = env.tx
    .select({ kind: combatant.kind, entityId: combatant.entityId })
    .from(combatant)
    .where(eq(combatant.id, s.creature.combatantId))
    .get();
  return c?.kind === "pc" ? { characterId: c.entityId } : s.creature;
}

/** One indexed read: the creature's active effects, `seq` order (FR-MOD-04). */
function activeEffects(env: CommandEnv, who: CreatureRef) {
  const target =
    "characterId" in who
      ? eq(effect.targetCharacterId, who.characterId)
      : eq(effect.targetCombatantId, who.combatantId);
  return env.tx
    .select()
    .from(effect)
    .where(and(target, isNull(effect.endedAt)))
    .orderBy(asc(effect.seq))
    .all();
}

export const modRollHook: RollHook = {
  id: "effect-modifiers.parts",
  adjust(env, subject, base) {
    const who = creatureOf(env, subject);
    const parts: RollPart[] = [];
    for (const { effect: e, modifier: m } of matchingMods(activeEffects(env, who), who, subject)) {
      const label = e.label ?? "";
      const pub = effectVisibleToPlayers(e);
      if (m.kind === "dice") {
        const expression = partDice(m.dice, subject);
        const r = base.rollExtra(expression, label);
        parts.push({
          effectId: e.id,
          label,
          public: pub,
          value: m.sign * r.total,
          expression,
          rollId: r.id,
          ...(base.manual ? { auto: true } : {}),
        });
      } else if (m.kind === "flat" && m.on.roll !== "ac") {
        parts.push({ effectId: e.id, label, public: pub, value: m.value });
      }
    }
    return { parts, modes: [] };
  },
};
