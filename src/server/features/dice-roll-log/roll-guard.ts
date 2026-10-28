// FR-DICE-13 roll guard (sprint 14 F4, BL-135, DM #367 / #371): a DM roll made as a **monster creature**
// that is hidden from players, or whose name isn't its definition's (renamed), is DM-only,
// whatever the `public` override, the category preset or a request's public audience says.
// `gameLog.append` asks it for every DM entry it would stamp public, so every roll path (dice.roll,
// char.roll, combat, macros, request answers, rerolls) gets the same rule from the roll rows'
// actor. Characters (every player sees them, FR-ENT-15) and players' own rolls are unchanged.
//
// The creature a roll is made as, from its `roll` row:
// - actor `token` → that token.
// - actor `entity` (a definition id): on a combat path (the entry names its encounter) or under a
//   combatant's own name (`dice.roll {combatantId}`, "Goblin 2"), the encounter's combatants of
//   that entity carrying the roll's actor name; else the campaign's tokens of it carrying that
//   name; else, for a definition roll (the stat block, the NPC sheet, a raw `{entityId}`),
//   **every** instance, combatants and tokens: it may be made for any of them (K7 F1, F4 F1).
//
// Hidden (#371) = the existing visibility rules on the players' shown scene: a combatant per
// `combatantVisibility`, or its token hidden; a token on the active scene hidden for any player
// (`tokenHiddenFor`: `hidden` or fog, per player). A token on a scene players aren't shown never
// hides a roll (rolls-1).
// Renamed = the name minus a numbering suffix (FR-MAP-16, "Goblin 2") isn't the definition's
// name; a player-owned companion is never renamed (its owner named it, players know it).

// The rule itself is shared (`@shared/dice-roll-log/roll-guard`, sprint 14 F3): the DM's roll bar
// shows the public switch forced off from it (FR-DICE-22). This module is its server world: the
// campaign's rows, read lazily in the caller's transaction, and per-player fog (`tokenHiddenFor`,
// `seenBy` is server-only, FR-FOG-44).

import { actorGuarded, type GuardWorld } from "@shared/dice-roll-log/roll-guard";
import { and, eq, inArray } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import { combatant, entity, player, roll, token } from "../../db/schema";
import { combatantVisibility } from "../combat-tracker/records";
import { startedEncounter, toCombatantRecord } from "../combat-tracker/rows";
import { activeSceneOf, toTokenRecord } from "../scenes-map/rows";
import { tokenHiddenFor } from "../scenes-map/visibility-hooks";

export { numberedFrom } from "@shared/dice-roll-log/roll-guard";

type TokenRow = typeof token.$inferSelect;
type CombatantRow = typeof combatant.$inferSelect;

/** The rule's facts from the campaign's rows (each read once, on first use). */
function rowsWorld(
  env: CommandEnv,
  cid: string,
  encounterId: string | null,
): GuardWorld<TokenRow, CombatantRow> {
  let playerIds: string[] | null = null;
  let activeSceneId: string | null | undefined;
  const players = () => {
    playerIds ??= env.tx
      .select({ id: player.id })
      .from(player)
      .where(eq(player.campaignId, cid))
      .all()
      .map((p) => p.id);
    return playerIds;
  };
  return {
    definition(id) {
      const e = env.tx
        .select({ name: entity.name, kind: entity.kind })
        .from(entity)
        .where(eq(entity.id, id))
        .get();
      return e ? { name: e.name, monster: e.kind === "monster" } : null;
    },
    combatantsOf(entityId) {
      return encounterId
        ? env.tx
            .select()
            .from(combatant)
            .where(and(eq(combatant.encounterId, encounterId), eq(combatant.entityId, entityId)))
            .all()
        : [];
    },
    tokensOf(entityId) {
      return env.tx
        .select()
        .from(token)
        .where(and(eq(token.definitionId, entityId), eq(token.campaignId, cid)))
        .all();
    },
    token(id) {
      return (
        env.tx
          .select()
          .from(token)
          .where(and(eq(token.id, id), eq(token.campaignId, cid)))
          .get() ?? null
      );
    },
    activeSceneId() {
      if (activeSceneId === undefined) activeSceneId = activeSceneOf(env.tx, cid)?.id ?? null;
      return activeSceneId;
    },
    tokenHidden(t) {
      const rec = toTokenRecord(t);
      return players().some((pid) => tokenHiddenFor(rec, pid, cid));
    },
    combatantHidden(c) {
      return combatantVisibility(toCombatantRecord(c)) === "hidden";
    },
  };
}

/**
 * FR-DICE-13 (#367): true iff an entry listing `rollIds` must be DM-only because a roll was made
 * as a hidden or renamed monster creature. Reads only; in the caller's transaction.
 */
export function rollGuarded(
  env: CommandEnv,
  cid: string,
  rollIds: readonly string[],
  encounterId: string | null | undefined,
): boolean {
  if (rollIds.length === 0) return false;
  const actors = env.tx
    .select({ kind: roll.actorKind, id: roll.actorId, name: roll.actorName })
    .from(roll)
    .where(and(inArray(roll.id, [...rollIds]), eq(roll.campaignId, cid)))
    .all();
  const world = rowsWorld(env, cid, encounterId ?? startedEncounter(env.tx, cid)?.id ?? null);
  const seen = new Set<string>();
  for (const a of actors) {
    if (!a.id || (a.kind !== "token" && a.kind !== "entity")) continue;
    const key = `${a.kind}:${a.id}:${a.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (actorGuarded(world, { kind: a.kind, id: a.id, name: a.name }, Boolean(encounterId))) {
      return true;
    }
  }
  return false;
}
