// FR-DICE-13 roll guard (sprint 14 F4, BL-135, DM #367 / #371): a DM roll made as a **monster creature**
// that is hidden from players, or whose name isn't its definition's (renamed), is DM-only,
// whatever the `public` override, the category preset or a request's public audience says.
// `gameLog.append` asks it for every DM entry it would stamp public, so every roll path (dice.roll,
// char.roll, combat, macros, request answers, rerolls) gets the same rule from the roll rows'
// actor. Characters (every player sees them, FR-ENT-15) and players' own rolls are unchanged.
//
// The creature a roll is made as, from its `roll` row:
// - actor `token` → that token.
// - actor `entity` (a definition id): the entry's (else the started) encounter's combatants of
//   that entity carrying the roll's actor name (combat paths, `dice.roll {combatantId}`); else
//   the campaign's tokens of it carrying that name; else, for a definition roll (the stat block,
//   the NPC sheet), **every** instance: it may be made for any of them (K7 walkthrough F1).
//
// Hidden (#371) = the existing visibility rules on the players' shown scene: a combatant per
// `combatantVisibility`; a token on the active scene hidden for any player (`tokenHiddenFor`:
// `hidden` or fog). A token on a scene players aren't shown never hides a roll (rolls-1).
// Renamed = the name minus a numbering suffix (FR-MAP-16, "Goblin 2") isn't the definition's
// name; a player-owned companion is never renamed (its owner named it, players know it).

import { baseName } from "@shared/scenes-map/geometry";
import { TOKEN_NAME_MAX } from "@shared/scenes-map/schemas";
import { and, eq, inArray } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import { combatant, entity, player, roll, token } from "../../db/schema";
import { combatantVisibility } from "../combat-tracker/records";
import { startedEncounter, toCombatantRecord } from "../combat-tracker/rows";
import { activeSceneOf, toTokenRecord } from "../scenes-map/rows";
import { tokenHiddenFor } from "../scenes-map/visibility-hooks";

type TokenRow = typeof token.$inferSelect;
type CombatantRow = typeof combatant.$inferSelect;

/** FR-MAP-16: `name` is `def` or `def` numbered (its base cut to fit 40 code points). */
export function numberedFrom(name: string, def: string): boolean {
  if (name === def) return true;
  const stem = baseName(name);
  if (stem === name) return false;
  if (stem === def) return true;
  const suffix = [...name].length - [...stem].length;
  return [...def].length + suffix > TOKEN_NAME_MAX && def.startsWith(stem);
}

interface Scope {
  env: CommandEnv;
  cid: string;
  encounterId: string | null;
  playerIds: string[] | null;
  activeSceneId: string | null | undefined;
}

function playersOf(s: Scope): string[] {
  s.playerIds ??= s.env.tx
    .select({ id: player.id })
    .from(player)
    .where(eq(player.campaignId, s.cid))
    .all()
    .map((p) => p.id);
  return s.playerIds;
}

function activeScene(s: Scope): string | null {
  if (s.activeSceneId === undefined) s.activeSceneId = activeSceneOf(s.env.tx, s.cid)?.id ?? null;
  return s.activeSceneId;
}

function tokenGuarded(s: Scope, t: TokenRow, defName: string | null): boolean {
  if (t.characterId !== null) return false;
  if (defName !== null && t.ownerPlayerId === null && !numberedFrom(t.name, defName)) return true;
  // #371: off the shown scene, a token is ignored for hiding (only its name counts).
  if (t.sceneId !== activeScene(s)) return false;
  const rec = toTokenRecord(t);
  return playersOf(s).some((pid) => tokenHiddenFor(rec, pid, s.cid));
}

function combatantGuarded(c: CombatantRow, defName: string | null): boolean {
  if (c.kind !== "monster") return false;
  if (defName !== null && c.ownerPlayerId === null && !numberedFrom(c.name, defName)) return true;
  return combatantVisibility(toCombatantRecord(c)) === "hidden";
}

function definitionName(s: Scope, id: string | null): { name: string; monster: boolean } | null {
  if (!id) return null;
  const e = s.env.tx
    .select({ name: entity.name, kind: entity.kind })
    .from(entity)
    .where(eq(entity.id, id))
    .get();
  return e ? { name: e.name, monster: e.kind === "monster" } : null;
}

function tokenActorGuarded(s: Scope, tokenId: string): boolean {
  const t = s.env.tx
    .select()
    .from(token)
    .where(and(eq(token.id, tokenId), eq(token.campaignId, s.cid)))
    .get();
  if (!t) return false;
  return tokenGuarded(s, t, definitionName(s, t.definitionId)?.name ?? null);
}

function entityActorGuarded(s: Scope, entityId: string, actorName: string): boolean {
  const def = definitionName(s, entityId);
  if (!def?.monster) return false;
  const fighters = s.encounterId
    ? s.env.tx
        .select()
        .from(combatant)
        .where(and(eq(combatant.encounterId, s.encounterId), eq(combatant.entityId, entityId)))
        .all()
    : [];
  const named = fighters.filter((c) => c.name === actorName);
  if (named.length > 0) return named.some((c) => combatantGuarded(c, def.name));
  const tokens = s.env.tx
    .select()
    .from(token)
    .where(and(eq(token.definitionId, entityId), eq(token.campaignId, s.cid)))
    .all();
  const namedTokens = tokens.filter((t) => t.name === actorName);
  if (namedTokens.length > 0 && actorName !== def.name) {
    return namedTokens.some((t) => tokenGuarded(s, t, def.name));
  }
  // A definition roll (or a name no instance carries): any of its creatures.
  return (
    !numberedFrom(actorName, def.name) ||
    fighters.some((c) => combatantGuarded(c, def.name)) ||
    tokens.some((t) => tokenGuarded(s, t, def.name))
  );
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
  const s: Scope = {
    env,
    cid,
    encounterId: encounterId ?? startedEncounter(env.tx, cid)?.id ?? null,
    playerIds: null,
    activeSceneId: undefined,
  };
  const seen = new Set<string>();
  for (const a of actors) {
    if (!a.id || (a.kind !== "token" && a.kind !== "entity")) continue;
    const key = `${a.kind}:${a.id}:${a.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (a.kind === "token" ? tokenActorGuarded(s, a.id) : entityActorGuarded(s, a.id, a.name)) {
      return true;
    }
  }
  return false;
}
