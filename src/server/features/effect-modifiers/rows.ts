// Row ↔ record converters and loaders for `effect-preset` (MOD §8.2). Campaign = `actor.campaignId`.
import { EFFECT_PRESET_TYPE, type EffectPresetRecord } from "@shared/effect-modifiers/schemas";
import { and, asc, count, eq, isNull } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import { conflict, notFound } from "../../commands/errors";
import type { Tx } from "../../db/client";
import { effectPreset } from "../../db/schema";
import type { RecordChange } from "../../events/types";

type Read = Pick<Tx, "select">;

export const PRESET_NOT_FOUND = "Preset not found";

export const toPresetRecord = (r: typeof effectPreset.$inferSelect): EffectPresetRecord => ({
  ...r,
});

export const presetChange = (
  before: EffectPresetRecord | null,
  after: EffectPresetRecord | null,
): RecordChange => ({
  type: EFFECT_PRESET_TYPE,
  id: (after ?? before)?.id as string,
  before,
  after,
});

export function campaignOf(env: Pick<CommandEnv, "actor">): string {
  if (!env.actor.campaignId) throw conflict("No active campaign");
  return env.actor.campaignId;
}

export function readPreset(tx: Read, id: string): EffectPresetRecord {
  return toPresetRecord(
    tx
      .select()
      .from(effectPreset)
      .where(eq(effectPreset.id, id))
      .get() as typeof effectPreset.$inferSelect,
  );
}

/** A preset of the actor's campaign, or `not_found` (players: their own rows only). */
export function getPreset(env: Pick<CommandEnv, "tx" | "actor">, id: string): EffectPresetRecord {
  const r = env.tx
    .select()
    .from(effectPreset)
    .where(and(eq(effectPreset.id, id), eq(effectPreset.campaignId, campaignOf(env))))
    .get();
  if (!r) throw notFound(PRESET_NOT_FOUND);
  const p = toPresetRecord(r);
  if (env.actor.role === "player" && p.ownerPlayerId !== env.actor.playerId) {
    throw notFound(PRESET_NOT_FOUND);
  }
  return p;
}

/** The campaign row customising a built-in key, if any. */
export function customisedPreset(tx: Read, cid: string, key: string): EffectPresetRecord | null {
  const r = tx
    .select()
    .from(effectPreset)
    .where(and(eq(effectPreset.campaignId, cid), eq(effectPreset.key, key)))
    .get();
  return r ? toPresetRecord(r) : null;
}

/** Campaign presets (`characterId` null) or one character's presets. */
export function presetCount(tx: Read, cid: string, characterId: string | null): number {
  return (
    tx
      .select({ n: count() })
      .from(effectPreset)
      .where(
        and(
          eq(effectPreset.campaignId, cid),
          characterId === null
            ? isNull(effectPreset.characterId)
            : eq(effectPreset.characterId, characterId),
        ),
      )
      .get()?.n ?? 0
  );
}

/** A character's presets, `seq` order (owner-copy hook, FR-MOD-07). */
export function presetsOfCharacter(tx: Read, characterId: string): EffectPresetRecord[] {
  return tx
    .select()
    .from(effectPreset)
    .where(eq(effectPreset.characterId, characterId))
    .orderBy(asc(effectPreset.seq))
    .all()
    .map(toPresetRecord);
}
