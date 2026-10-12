// `characters.adjustHp(env, characterId, delta)` (FR-CHAR-13, protocol §21): the shared writer of
// a character's `hpCurrent`. Runs in the caller's transaction, clamps 0…hpMax, emits nothing and
// returns the `entity` change for the caller's event (I15). The caller authorizes.
import { clampHp } from "@shared/character-sheet/logic";
import { type CharacterRecord, ENTITY_TYPE } from "@shared/entities/schemas";
import { and, eq } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import { conflict, notFound } from "../../commands/errors";
import { entity } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { getRow, toEntityRecord } from "../entities/rows";

export interface AdjustHpResult {
  hpBefore: number;
  hpAfter: number;
  /** The `entity` upsert for the caller's event; null when the clamp leaves HP unchanged. */
  change: RecordChange | null;
}

function campaignOf(env: CommandEnv): string {
  if (!env.actor.campaignId) throw conflict("No active campaign");
  return env.actor.campaignId;
}

/** A character of the actor's campaign, else `not_found` (unknown, monster, other campaign). */
export function getCharacter(env: CommandEnv, characterId: string): CharacterRecord {
  const cid = campaignOf(env);
  const row = env.tx
    .select()
    .from(entity)
    .where(and(eq(entity.id, characterId), eq(entity.campaignId, cid)))
    .get();
  if (row?.kind !== "character") throw notFound("Character not found");
  const rec = toEntityRecord(row);
  if (rec.kind !== "character") throw notFound("Character not found");
  return rec;
}

export function adjustHp(env: CommandEnv, characterId: string, delta: number): AdjustHpResult {
  if (!Number.isInteger(delta)) throw new Error("adjustHp: delta must be an integer");
  const before = getCharacter(env, characterId);
  const hpBefore = before.hpCurrent;
  const hpAfter = clampHp(hpBefore, delta, before.statBlock.hpMax);
  if (hpAfter === hpBefore) return { hpBefore, hpAfter, change: null };
  env.tx
    .update(entity)
    .set({ hpCurrent: hpAfter, updatedAt: env.ctx.clock.iso() })
    .where(eq(entity.id, characterId))
    .run();
  const after = toEntityRecord(
    getRow(env.tx, characterId) as NonNullable<ReturnType<typeof getRow>>,
  );
  return { hpBefore, hpAfter, change: { type: ENTITY_TYPE, id: characterId, before, after } };
}
