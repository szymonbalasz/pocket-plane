// `char.roll`'s actor (FR-CHAR-09, FR-CHARX-22) and, sprint 6, a pet's owner rolling its attacks
// out of a fight (FR-CHARX-69, OQ-CHARX-35; ADR-0056): allowed for a player iff the monster is a
// pet they own, kinds `toHit` / `damage` / `attack` only; the log entry is DM + owner only.
import { petRollKindError } from "@shared/character-sheet/rolls";
import type { SheetRollKind } from "@shared/character-sheet/schemas";
import { type DefinitionRecord, isPet } from "@shared/entities/schemas";
import type { CommandEnv } from "../../commands/commands";
import { invalid, notFound } from "../../commands/errors";
import { getRow, toEntityRecord } from "../entities/rows";
import { rollTarget } from "./access";

type Env = Pick<CommandEnv, "tx" | "actor">;

export interface RollActor {
  creature: DefinitionRecord;
  /** FR-CHARX-69: the pet owner's own roll → its entry reaches the DM and this player only. */
  audiencePlayerId: string | null;
}

/**
 * The creature a `char.roll` rolls as. Player: own character, or (FR-CHARX-69) a pet with
 * `ownerPlayerId = actor`; another's pet or any other monster → `not_found` (never `forbidden`:
 * a player can't learn which monsters are pets); a pet with a non-attack kind → `invalid`.
 * DM: as before (FR-CHARX-22: any definition; its entry stays DM-only).
 */
export function rollActor(env: Env, id: string, kind: SheetRollKind): RollActor {
  if (env.actor.role === "player") {
    const row = getRow(env.tx, id);
    if (row && row.campaignId === env.actor.campaignId && row.kind === "monster") {
      const pet = toEntityRecord(row);
      if (!isPet(pet) || pet.ownerPlayerId !== env.actor.playerId) {
        throw notFound("Character not found");
      }
      const error = petRollKindError(kind);
      if (error) throw invalid(error, [{ path: ["kind"], message: error }]);
      return { creature: pet, audiencePlayerId: env.actor.playerId };
    }
  }
  return { creature: rollTarget(env, id), audiencePlayerId: null };
}
