// MOD's definition-changed hook line (FR-MOD-07, -47, FR-ENT-19): keeps each character preset's
// and rule trigger's `ownerPlayerId` copy equal to the character's owner, in the owner change's
// transaction. The changes are listed in the entity event, so the old owner gets deletes and the
// new one upserts (`rule-trigger` is lazy: live changes as any type, ADR-0045). The character's
// `trigger-state` rows follow (FR-MOD-54, review B17): same rule, the rows move owners.
import type { EntityRecord } from "@shared/entities/schemas";
import { eq } from "drizzle-orm";
import { effectPreset, ruleTrigger } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { startedEncounter } from "../combat-tracker/rows";
import type { HookEnv } from "../entities/definition-hooks";
import { presetChange, presetsOfCharacter, readPreset } from "./rows";
import { readTrigger, triggerChange, triggersOfCharacter } from "./trigger-commands";
import { combatantsOfCreatures, triggerStates } from "./trigger-state-writes";

export function presetOwnerHook(
  env: HookEnv,
  _before: EntityRecord,
  after: EntityRecord,
): RecordChange[] {
  if (after.kind !== "character") return [];
  const owner = after.ownerPlayerId;
  const triggers = triggersOfCharacter(env.tx, after.id)
    .filter((t) => t.ownerPlayerId !== owner)
    .map((t) => {
      env.tx
        .update(ruleTrigger)
        .set({ ownerPlayerId: owner, updatedAt: env.ctx.clock.iso() })
        .where(eq(ruleTrigger.id, t.id))
        .run();
      return triggerChange(t, readTrigger(env.tx, t.id));
    });
  const presets = presetsOfCharacter(env.tx, after.id)
    .filter((p) => p.ownerPlayerId !== owner)
    .map((p) => {
      env.tx
        .update(effectPreset)
        .set({ ownerPlayerId: owner, updatedAt: env.ctx.clock.iso() })
        .where(eq(effectPreset.id, p.id))
        .run();
      return presetChange(p, readPreset(env.tx, p.id));
    });
  const enc = triggers.length ? startedEncounter(env.tx, after.campaignId) : null;
  const states = enc
    ? triggerStates(env, enc, combatantsOfCreatures(env.tx, enc, [{ characterId: after.id }]))
    : [];
  return [...presets, ...triggers, ...states];
}
