// CHARX authorization (FR-CHARX-18, CHARX §10). Unknown, other campaign or (player) a monster →
// `not_found`; another player's character → `forbidden`; imported definition → `forbidden`
// read-only; custom monster → DM only; a locked sheet refuses the owner's edits only.
import type { CreatureSheetRecord } from "@shared/character-sheet/sheet";
import type { CharacterRecord, DefinitionRecord, EntityRecord } from "@shared/entities/schemas";
import type { CommandEnv } from "../../commands/commands";
import { conflict, forbidden, invalid, notFound } from "../../commands/errors";
import { READ_ONLY_MESSAGE, resolveDefinition } from "../entities/commands";
import { getRow, toEntityRecord } from "../entities/rows";
import { getSheet } from "./sheet-rows";

export const LOCKED_MESSAGE = "Locked by the DM";
export const NOT_YOURS = "Not your character";
const NOT_FOUND = "Character not found";

type Env = Pick<CommandEnv, "tx" | "actor">;

function campaignOf(env: Env): string {
  if (!env.actor.campaignId) throw conflict("No active campaign");
  return env.actor.campaignId;
}

/**
 * The campaign creature a CHARX write targets. Player: own character only (and, with `pets`, a
 * pet they own: FR-ENT-38, #288; another's pet → `forbidden`, any other monster → `not_found`).
 * DM: any character or custom monster of the campaign; imported → `forbidden`.
 */
function creatureFor(env: Env, id: string, opts: { pets?: boolean } = {}): EntityRecord {
  const cid = campaignOf(env);
  const row = getRow(env.tx, id);
  if (env.actor.role === "player") {
    if (opts.pets && row && row.campaignId === cid && row.companionOf !== null) {
      const pet = toEntityRecord(row);
      if (pet.ownerPlayerId !== env.actor.playerId) throw forbidden(NOT_YOURS);
      return pet;
    }
    if (!row || row.campaignId !== cid || row.kind !== "character") throw notFound(NOT_FOUND);
    const c = toEntityRecord(row);
    if (c.kind !== "character") throw notFound(NOT_FOUND);
    if (c.ownerPlayerId !== env.actor.playerId) throw forbidden(NOT_YOURS);
    return c;
  }
  if (row && row.campaignId === null) throw forbidden(READ_ONLY_MESSAGE);
  if (!row || row.campaignId !== cid) throw notFound(NOT_FOUND);
  return toEntityRecord(row);
}

/**
 * Fields and rows (FR-CHARX-15/16): the owner only while unlocked; the DM always. Sprint 6
 * (FR-ENT-38, #288 "B without a lock"): a pet's owner too, never locked; the callers limit the
 * fields (`PET_OWNER_FIELDS`, attack rows).
 */
export function editableCreature(
  env: Env,
  id: string,
): { creature: EntityRecord; sheet: CreatureSheetRecord | null } {
  const creature = creatureFor(env, id, { pets: true });
  const sheet = getSheet(env.tx, creature.id);
  const ownPet = creature.kind === "monster";
  if (env.actor.role === "player" && !ownPet && sheet?.locked) throw forbidden(LOCKED_MESSAGE);
  return { creature, sheet };
}

/** FR-ENT-38 (#288): what a pet's owner may edit on its card; the rest is the DM's. */
export const PET_OWNER_FIELDS = ["ac", "hpMax", "speed"] as const;

/** FR-ENT-38: a player editing a pet (only their own reaches here, `editableCreature`). */
export const petOwnerEdit = (env: Env, c: EntityRecord): boolean =>
  env.actor.role === "player" && c.kind === "monster";

/** Counters (FR-CHARX-17): characters only, the owner also on a locked sheet. */
export function counterCharacter(env: Env, id: string): CharacterRecord {
  const creature = creatureFor(env, id);
  if (creature.kind !== "character") throw invalid("No counters on NPC definitions");
  return creature;
}

/**
 * A roll's actor (FR-CHAR-09, FR-CHARX-22): player → own character; DM → any character, custom
 * or imported definition of the campaign (`not_found` otherwise).
 */
export function rollTarget(env: Env, id: string): DefinitionRecord {
  const cid = campaignOf(env);
  if (env.actor.role === "player") return creatureFor(env, id);
  const d = resolveDefinition(env, id);
  if (d.campaignId !== null && d.campaignId !== cid) throw notFound(NOT_FOUND);
  return d;
}
