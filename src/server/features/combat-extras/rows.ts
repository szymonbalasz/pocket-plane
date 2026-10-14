// Row ↔ record converters, loaders and target resolution for combat-extras. Campaign =
// `actor.campaignId`. Targets: a monster's active combatant or a PC's character (CBTX §6).

import type { TargetRef } from "@shared/combat-extras/intents";
import { EFFECT_TYPE, type EffectRecord } from "@shared/combat-extras/schemas";
import type { CombatantRecord, EncounterRecord } from "@shared/combat-tracker/schemas";
import { type CharacterRecord, ENTITY_TYPE } from "@shared/entities/schemas";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import { conflict, notFound } from "../../commands/errors";
import type { Tx } from "../../db/client";
import { combatant, effect, entity } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { getCharacter } from "../character-sheet/hp";
import { activeCombatant } from "../combat-tracker/guards";
import { campaignOf, startedEncounter, toCombatantRecord } from "../combat-tracker/rows";
import { getRow, toEntityRecord } from "../entities/rows";

type Read = Pick<Tx, "select">;
export type Env = CommandEnv;

export const toEffectRecord = (r: typeof effect.$inferSelect): EffectRecord => ({ ...r });

export const effectChange = (before: EffectRecord | null, after: EffectRecord | null) =>
  ({
    type: EFFECT_TYPE,
    id: (after ?? before)?.id as string,
    before,
    after,
  }) satisfies RecordChange;

export function readEffect(tx: Read, id: string): EffectRecord {
  return toEffectRecord(
    tx.select().from(effect).where(eq(effect.id, id)).get() as typeof effect.$inferSelect,
  );
}

/** An effect of the actor's campaign, or `not_found`. */
export function getEffect(env: Pick<Env, "tx" | "actor">, id: string): EffectRecord {
  const r = env.tx
    .select()
    .from(effect)
    .where(and(eq(effect.id, id), eq(effect.campaignId, campaignOf(env.actor))))
    .get();
  if (!r) throw notFound("Effect not found");
  return toEffectRecord(r);
}

export function readCharacter(tx: Read, id: string): CharacterRecord {
  const rec = toEntityRecord(getRow(tx as Tx, id) as NonNullable<ReturnType<typeof getRow>>);
  if (rec.kind !== "character") throw new Error(`Entity ${id} is not a character`);
  return rec;
}

export const characterChange = (before: CharacterRecord, after: CharacterRecord): RecordChange => ({
  type: ENTITY_TYPE,
  id: after.id,
  before,
  after,
});

/** A resolved effect target: a monster's combatant or a PC's character. */
export type Target =
  | { kind: "monster"; combatant: CombatantRecord; name: string }
  | { kind: "character"; character: CharacterRecord; name: string };

export const targetKey = (t: Target) =>
  t.kind === "monster" ? `k:${t.combatant.id}` : `c:${t.character.id}`;

/** Columns that point an effect at its target. */
export const targetColumns = (t: Target) =>
  t.kind === "monster"
    ? { targetCombatantId: t.combatant.id, targetCharacterId: null }
    : { targetCombatantId: null, targetCharacterId: t.character.id };

/**
 * CBTX §6 target ref: `{combatantId}` = an active, non-removed combatant of the started
 * encounter (a PC combatant resolves to its character; players: visible, else `not_found`);
 * `{characterId}` = any character of the campaign.
 */
export function resolveTarget(env: Env, ref: TargetRef): Target {
  if ("characterId" in ref) {
    const c = getCharacter(env, ref.characterId);
    return { kind: "character", character: c, name: c.name };
  }
  const { c } = activeCombatant(env, ref.combatantId, { allowRemoved: true });
  if (c.kind === "pc") {
    const ch = getCharacter(env, c.entityId);
    return { kind: "character", character: ch, name: ch.name };
  }
  return { kind: "monster", combatant: c, name: c.name };
}

/** The started encounter's active combatant bound to a character, if any. */
export function pcCombatant(tx: Read, cid: string, characterId: string): CombatantRecord | null {
  const enc = startedEncounter(tx, cid);
  if (!enc) return null;
  const r = tx
    .select()
    .from(combatant)
    .where(
      and(
        eq(combatant.encounterId, enc.id),
        eq(combatant.entityId, characterId),
        eq(combatant.kind, "pc"),
        eq(combatant.active, true),
      ),
    )
    .get();
  return r ? toCombatantRecord(r) : null;
}

/** The target's combatant in the started encounter: the monster's own, a PC's active one. */
export function combatantOf(tx: Read, cid: string, t: Target): CombatantRecord | null {
  if (t.kind === "monster") return t.combatant.active ? t.combatant : null;
  return pcCombatant(tx, cid, t.character.id);
}

/** The started encounter's combatant an effect sits on (monster: its own; PC: active one). */
export function effectCombatantId(
  tx: Read,
  cid: string,
  e: Pick<EffectRecord, "targetCombatantId" | "targetCharacterId">,
): string | null {
  if (e.targetCombatantId) return e.targetCombatantId;
  return pcCombatant(tx, cid, e.targetCharacterId as string)?.id ?? null;
}

/** FR-CBTX-13: `effect.hidden` = the target's bound combatant `hidden` (PCs: active one; none → false). */
export function hiddenOf(tx: Read, cid: string, t: Target): boolean {
  return combatantOf(tx, cid, t)?.hidden ?? false;
}

/** Active effects of a target (by column), oldest first. */
export function activeEffectsOf(
  tx: Read,
  cols: { targetCombatantId: string | null; targetCharacterId: string | null },
): EffectRecord[] {
  const where = cols.targetCombatantId
    ? eq(effect.targetCombatantId, cols.targetCombatantId)
    : eq(effect.targetCharacterId, cols.targetCharacterId as string);
  return tx
    .select()
    .from(effect)
    .where(and(where, isNull(effect.endedAt)))
    .orderBy(asc(effect.seq))
    .all()
    .map(toEffectRecord);
}

export const activeConcentrationOf = (
  tx: Read,
  cols: { targetCombatantId: string | null; targetCharacterId: string | null },
) => activeEffectsOf(tx, cols).find((e) => e.kind === "concentration") ?? null;

/** Target columns of the creature a combatant stands for (monster: itself; PC: its character). */
export const combatantTargetColumns = (c: CombatantRecord) =>
  c.kind === "monster"
    ? { targetCombatantId: c.id, targetCharacterId: null }
    : { targetCombatantId: null, targetCharacterId: c.entityId };

/** Active effects of a list of ids' rows. */
export function effectsByIds(tx: Read, ids: readonly string[]): EffectRecord[] {
  if (ids.length === 0) return [];
  return tx
    .select()
    .from(effect)
    .where(inArray(effect.id, [...ids]))
    .orderBy(asc(effect.seq))
    .all()
    .map(toEffectRecord);
}

/** Display name of an effect's target: the monster combatant's or the character's name. */
export function effectTargetName(tx: Read, e: EffectRecord): string {
  if (e.targetCombatantId) {
    return (
      tx
        .select({ name: combatant.name })
        .from(combatant)
        .where(eq(combatant.id, e.targetCombatantId))
        .get()?.name ?? "?"
    );
  }
  return (
    tx
      .select({ name: entity.name })
      .from(entity)
      .where(eq(entity.id, e.targetCharacterId as string))
      .get()?.name ?? "?"
  );
}

/** The started encounter, or `conflict` with the given message. */
export function requireStartedEncounter(env: Env, message: string): EncounterRecord {
  const enc = startedEncounter(env.tx, campaignOf(env.actor));
  if (!enc) throw conflict(message);
  return enc;
}
