// FR-FOG-11 (ADR-0042): fog-hidden for player P = P is not in the subject's server-written
// `seenBy` copy and it is not P's own token. Pure: reads only the record and the viewer's player
// id. `seenBy` null (a pre-v2 row before the boot backfill, FR-FOG-40) → hidden (fail closed).
// Exempt: a template a player placed (not a fog subject). Independent of a token's `hidden`.

/** Fields fog reads from any fog subject (token, prop, AoE template). */
export interface FogSubject {
  fogged?: boolean;
  seenBy?: readonly string[] | null;
  ownerPlayerId?: string | null;
  placedByPlayerId?: string | null;
}

export const TOKEN_SUBJECT = "token";
export const TEMPLATE_SUBJECT = "aoe-template";

export function fogHidden(type: string, r: FogSubject, playerId: string | null): boolean {
  if (type === TOKEN_SUBJECT && r.ownerPlayerId != null && r.ownerPlayerId === playerId) {
    return false;
  }
  if (type === TEMPLATE_SUBJECT && r.placedByPlayerId != null) return false;
  if (playerId === null || r.seenBy == null) return true;
  return !r.seenBy.includes(playerId);
}

/** FR-SCN-36 (per player): a door reaches P iff P is in `doorSeen[n]`; null → nobody. */
export function doorSeenBy(
  doorSeen: Readonly<Record<string, readonly string[]>> | null | undefined,
  n: number,
  playerId: string | null,
): boolean {
  if (playerId === null || doorSeen == null) return false;
  return doorSeen[String(n)]?.includes(playerId) ?? false;
}

/**
 * The DM's Fog badge (FR-FOG-20): seen by no player = `fogged` on a subject that is not exempt
 * (an owned token's `fogged` is its static copy; a player-placed template is no fog subject).
 * Reads the DM wire record only (no `seenBy` there).
 */
export function seenByNobody(type: string, r: FogSubject): boolean {
  if (r.fogged !== true) return false;
  if (type === TOKEN_SUBJECT) return r.ownerPlayerId == null;
  if (type === TEMPLATE_SUBJECT) return r.placedByPlayerId == null;
  return true;
}
