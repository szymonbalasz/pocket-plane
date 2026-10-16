// MOD's roll hook (FR-MOD-14, registered in dice-roll-log's `rollHooks`): the creature's active
// effects whose modifiers match the subject → parts. `dice` → its own roll row through
// `base.rollExtra` (doubled on a crit's damage), signed, keyed by its physical group (FR-MOD-18);
// `flat` → its value. Tier 2: `mode` → `modes()`, asked before the d20 is rolled (FR-MOD-17);
// `defense` and AC are target-side (MOD's apply hook, `target-facts.ts`).
//
// Imports stay to the schema and `@shared`: `roll-hooks.ts` (imported by `dice.evaluate`)
// imports this module, so feature helpers here would close an import cycle.
import { effectVisibleToPlayers } from "@shared/combat-extras/schemas";
import {
  bonusDieGroups,
  type CreatureRef,
  matchingMods,
  modeHints,
} from "@shared/effect-modifiers/rules";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import { combatant, effect } from "../../db/schema";
import type { RollHook, RollModeHint, RollPart, RollSubject } from "../dice-roll-log/roll-hooks";

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
export function activeEffects(env: CommandEnv, who: CreatureRef) {
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
  /** FR-MOD-17 (tier 2): the creature's active `mode` modifiers matching the roll. */
  modes(env, subject): RollModeHint[] {
    const who = creatureOf(env, subject);
    return modeHints(activeEffects(env, who), who, subject).map(({ effect: e, mode }) => ({
      effectId: e.id,
      mode,
      label: e.label ?? "",
      public: effectVisibleToPlayers(e),
    }));
  },
  adjust(env, subject, base) {
    const who = creatureOf(env, subject);
    const effects = activeEffects(env, who);
    const parts: RollPart[] = [];
    // FR-MOD-18: each bonus die's physical group, by effect id and modifier index.
    const groups = new Map(
      bonusDieGroups(effects, who, subject).map((g) => [`${g.effect.id}:${g.index}`, g]),
    );
    for (const { effect: e, modifier: m, index } of matchingMods(effects, who, subject)) {
      const label = e.label ?? "";
      const pub = effectVisibleToPlayers(e);
      if (m.kind === "dice") {
        const g = groups.get(`${e.id}:${index}`);
        if (!g) throw new Error("bonus-die group missing");
        const expression = g.dice;
        const r = base.rollExtra(expression, label, g.key);
        parts.push({
          effectId: e.id,
          label,
          public: pub,
          value: m.sign * r.total,
          expression,
          rollId: r.id,
          ...(base.manual && !r.manual ? { auto: true } : {}),
        });
      } else if (m.kind === "flat" && m.on.roll !== "ac") {
        parts.push({ effectId: e.id, label, public: pub, value: m.value });
      }
    }
    return { parts, modes: [] };
  },
};
