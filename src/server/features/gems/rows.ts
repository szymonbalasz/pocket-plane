// `character_gems` rows ↔ `character-gems` records (GEM §8), and the character a gem command targets.
import { CHARACTER_GEMS_TYPE, type CharacterGemsRecord, type GemKind } from "@shared/gems/schemas";
import { and, asc, eq } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import { conflict, forbidden, notFound } from "../../commands/errors";
import type { Db, Tx } from "../../db/client";
import { characterGems, entity } from "../../db/schema";
import type { RecordChange } from "../../events/types";

type Row = typeof characterGems.$inferSelect;
type Env = Pick<CommandEnv, "tx" | "actor">;

export const toGemsRecord = (row: Row): CharacterGemsRecord => ({
  id: row.id,
  campaignId: row.campaignId,
  characterId: row.id,
  inspiration: row.inspiration,
  fortune: row.fortune,
  combat: row.combat,
  divine: row.divine,
  action: row.action,
});

export function listGems(db: Db | Tx, campaignId: string): CharacterGemsRecord[] {
  return db
    .select()
    .from(characterGems)
    .where(eq(characterGems.campaignId, campaignId))
    .orderBy(asc(characterGems.id))
    .all()
    .map(toGemsRecord);
}

export function campaignOf(env: Env): string {
  if (!env.actor.campaignId) throw conflict("No active campaign");
  return env.actor.campaignId;
}

/**
 * The character a gem command targets: a character of the actor's campaign (else `not_found`; pets
 * and monsters have no gems, OQ-GEM-15 A). `owner`: a player must own it (FR-GEM-11: the entity's
 * `ownerPlayerId`, no copy on the gem row) else `forbidden`; the DM may act for anyone (OQ-GEM-14).
 */
export function characterFor(env: Env, id: string, opts: { owner?: boolean } = {}) {
  const cid = campaignOf(env);
  const row = env.tx
    .select({ id: entity.id, name: entity.name, ownerPlayerId: entity.ownerPlayerId })
    .from(entity)
    .where(and(eq(entity.id, id), eq(entity.campaignId, cid), eq(entity.kind, "character")))
    .get();
  if (!row) throw notFound("Character not found");
  if (opts.owner && env.actor.role === "player" && row.ownerPlayerId !== env.actor.playerId) {
    throw forbidden("Not your character");
  }
  return { ...row, campaignId: cid };
}

/**
 * Sets one count (FR-GEM-06: the row is created on first write, every other count 0). Returns the
 * `character-gems` change for the caller's event.
 */
export function writeCount(
  env: Pick<CommandEnv, "tx" | "ctx">,
  ch: { id: string; campaignId: string },
  gem: GemKind,
  held: number,
): RecordChange {
  const row = env.tx.select().from(characterGems).where(eq(characterGems.id, ch.id)).get();
  const now = env.ctx.clock.iso();
  if (row) {
    env.tx
      .update(characterGems)
      .set({ [gem]: held, updatedAt: now })
      .where(eq(characterGems.id, ch.id))
      .run();
  } else {
    env.tx
      .insert(characterGems)
      .values({ id: ch.id, campaignId: ch.campaignId, [gem]: held, updatedAt: now })
      .run();
  }
  const after = env.tx.select().from(characterGems).where(eq(characterGems.id, ch.id)).get() as Row;
  return {
    type: CHARACTER_GEMS_TYPE,
    id: ch.id,
    before: row ? toGemsRecord(row) : null,
    after: toGemsRecord(after),
  };
}

/** A character's count of one gem (no row = 0). */
export function heldOf(tx: Pick<Tx, "select">, characterId: string, gem: GemKind): number {
  const row = tx.select().from(characterGems).where(eq(characterGems.id, characterId)).get();
  return row ? row[gem] : 0;
}
