// Shared lookups / guards for combat intents: the started encounter, its combatants, what a
// player may see (FR-CBT-27) and own (FR-CBT-11, FR-CBT-16).
import type { CombatantRecord, EncounterRecord } from "@shared/combat-tracker/schemas";
import { effectiveStats, type StatBlock } from "@shared/entities/schemas";
import { eq } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import { conflict, forbidden, notFound } from "../../commands/errors";
import { entity } from "../../db/schema";
import { combatantVisibility } from "./records";
import { campaignOf, getCombatant, readEncounter, startedEncounter } from "./rows";

export function requireStarted(env: Pick<CommandEnv, "tx" | "actor">): EncounterRecord {
  const enc = startedEncounter(env.tx, campaignOf(env.actor));
  if (!enc) throw conflict("No encounter is running");
  return enc;
}

/**
 * An active combatant of the started encounter, or `not_found`. For a player, also visible
 * (else `not_found`, #130); `own` → a PC owned by them (else `forbidden`).
 */
export function activeCombatant(
  env: Pick<CommandEnv, "tx" | "actor">,
  id: string,
  opts: { own?: boolean; allowRemoved?: boolean } = {},
): { c: CombatantRecord; enc: EncounterRecord } {
  const cid = campaignOf(env.actor);
  const c = getCombatant(env.tx, cid, id);
  const enc = readEncounter(env.tx, c.encounterId);
  if (enc.status !== "started" || !c.active) throw notFound("Combatant not found");
  if (env.actor.role === "player") {
    if (combatantVisibility(c) === "hidden") throw notFound("Combatant not found");
    if (opts.own && (c.kind !== "pc" || ownerOf(env, c.entityId) !== env.actor.playerId)) {
      throw forbidden("Not your character");
    }
  }
  if (c.removed && !opts.allowRemoved) throw notFound("Combatant not found");
  return { c, enc };
}

function ownerOf(env: Pick<CommandEnv, "tx">, entityId: string): string | null {
  return (
    env.tx.select({ owner: entity.ownerPlayerId }).from(entity).where(eq(entity.id, entityId)).get()
      ?.owner ?? null
  );
}

/** The combatant's effective stat block (ADR-0009, FR-ENT-13). */
export function statsOf(env: Pick<CommandEnv, "tx">, c: CombatantRecord): StatBlock {
  const row = env.tx
    .select({ statBlock: entity.statBlock })
    .from(entity)
    .where(eq(entity.id, c.entityId))
    .get();
  if (!row) throw new Error(`Combatant ${c.id}: entity ${c.entityId} missing`);
  return effectiveStats({ statBlock: row.statBlock as StatBlock });
}
