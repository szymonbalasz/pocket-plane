// FR-DICE-13 roll guard (sprint 14 F4, BL-135, DM #367 / #371), the pure rule: whether a roll made
// as a creature must be DM-only because that creature is a hidden or renamed monster. The server
// (`server/features/dice-roll-log/roll-guard.ts`) runs it over its rows when it stamps an entry;
// the DM's roll bar runs it over the store to show the public switch forced off (sprint 14 F3,
// FR-DICE-22). Where the data lives is the caller's (`GuardWorld`), the rule is this module's.
//
// The creature a roll is made as, from its actor:
// - actor `token` → that token.
// - actor `entity` (a definition id): on a combat path (the entry names its encounter) or under a
//   combatant's own name (`dice.roll {combatantId}`, "Goblin 2"), the encounter's combatants of
//   that entity carrying the roll's actor name; else the campaign's tokens of it carrying that
//   name; else, for a definition roll (the stat block, the NPC sheet, a raw `{entityId}`),
//   **every** instance, combatants and tokens: it may be made for any of them (K7 F1, F4 F1).
//
// Hidden (#371) = the existing visibility rules on the players' shown scene: a combatant per
// combat's visibility, or its token hidden; a token on the active scene hidden for players
// (`GuardWorld.tokenHidden`). A token on a scene players aren't shown never hides a roll (rolls-1).
// Renamed = the name minus a numbering suffix (FR-MAP-16, "Goblin 2") isn't the definition's
// name; a player-owned companion is never renamed (its owner named it, players know it).

import { baseName } from "@shared/scenes-map/geometry";
import { TOKEN_NAME_MAX } from "@shared/scenes-map/schemas";

/** FR-MAP-16: `name` is `def` or `def` numbered (its base cut to fit 40 code points). */
export function numberedFrom(name: string, def: string): boolean {
  if (name === def) return true;
  const stem = baseName(name);
  if (stem === name) return false;
  if (stem === def) return true;
  const suffix = [...name].length - [...stem].length;
  return [...def].length + suffix > TOKEN_NAME_MAX && def.startsWith(stem);
}

/** A token as the rule reads it. */
export interface GuardToken {
  name: string;
  /** Its definition (a token actor's renamed test); absent / null = unknown. */
  definitionId?: string | null;
  sceneId: string;
  characterId: string | null;
  ownerPlayerId: string | null;
}

/** A combatant as the rule reads it. */
export interface GuardCombatant {
  kind: string;
  name: string;
  ownerPlayerId: string | null;
  tokenId: string | null;
}

/** Where the rule's facts come from (the server's rows, the DM's store). */
export interface GuardWorld<T extends GuardToken, C extends GuardCombatant> {
  /** The definition's name and whether it's a monster; null = unknown. */
  definition(entityId: string): { name: string; monster: boolean } | null;
  /** The running encounter's combatants of `entityId` (none without one). */
  combatantsOf(entityId: string): readonly C[];
  /** The campaign's tokens of `entityId`. */
  tokensOf(entityId: string): readonly T[];
  token(tokenId: string): T | null;
  /** The scene players are shown (null = none). */
  activeSceneId(): string | null;
  /** The token is hidden for players (on its scene; `hidden`, fog). */
  tokenHidden(t: T): boolean;
  /** Combat's visibility says the combatant is hidden from players. */
  combatantHidden(c: C): boolean;
}

/** A roll's actor: `token` (a token id) or `entity` (a definition id) under `name`. */
export interface GuardActor {
  kind: "token" | "entity";
  id: string;
  name: string;
}

function tokenGuarded<T extends GuardToken, C extends GuardCombatant>(
  w: GuardWorld<T, C>,
  t: T,
  defName: string | null,
): boolean {
  if (t.characterId !== null) return false;
  if (defName !== null && t.ownerPlayerId === null && !numberedFrom(t.name, defName)) return true;
  // #371: off the shown scene, a token is ignored for hiding (only its name counts).
  if (t.sceneId !== w.activeSceneId()) return false;
  return w.tokenHidden(t);
}

/** Hidden (combat's rule, or its token's on the shown scene: fog per player, F4 F1) or renamed. */
function combatantGuarded<T extends GuardToken, C extends GuardCombatant>(
  w: GuardWorld<T, C>,
  c: C,
  defName: string | null,
): boolean {
  if (c.kind !== "monster") return false;
  if (defName !== null && c.ownerPlayerId === null && !numberedFrom(c.name, defName)) return true;
  if (w.combatantHidden(c)) return true;
  if (!c.tokenId) return false;
  const t = w.token(c.tokenId);
  return t ? tokenGuarded(w, t, defName) : false;
}

function entityActorGuarded<T extends GuardToken, C extends GuardCombatant>(
  w: GuardWorld<T, C>,
  entityId: string,
  actorName: string,
  combatPath: boolean,
): boolean {
  const def = w.definition(entityId);
  if (!def?.monster) return false;
  const fighters = w.combatantsOf(entityId);
  const named = fighters.filter((c) => c.name === actorName);
  if (named.length > 0 && (combatPath || actorName !== def.name)) {
    return named.some((c) => combatantGuarded(w, c, def.name));
  }
  const tokens = w.tokensOf(entityId);
  const namedTokens = tokens.filter((t) => t.name === actorName);
  if (namedTokens.length > 0 && actorName !== def.name) {
    return namedTokens.some((t) => tokenGuarded(w, t, def.name));
  }
  // A definition roll (or a name no instance carries): any of its creatures.
  return (
    !numberedFrom(actorName, def.name) ||
    fighters.some((c) => combatantGuarded(w, c, def.name)) ||
    tokens.some((t) => tokenGuarded(w, t, def.name))
  );
}

/**
 * FR-DICE-13 (#367): true iff a roll made as `a` must be DM-only (a hidden or renamed monster
 * creature). `combatPath`: the entry names its encounter (its actor is that fight's combatant).
 */
export function actorGuarded<T extends GuardToken, C extends GuardCombatant>(
  w: GuardWorld<T, C>,
  a: GuardActor,
  combatPath: boolean,
): boolean {
  if (a.kind === "token") {
    const t = w.token(a.id);
    if (!t) return false;
    const def = t.definitionId ? w.definition(t.definitionId) : null;
    return tokenGuarded(w, t, def?.name ?? null);
  }
  return entityActorGuarded(w, a.id, a.name, combatPath);
}
