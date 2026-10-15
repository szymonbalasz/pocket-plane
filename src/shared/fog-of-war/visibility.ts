// FR-FOG-11: fog-hidden = `fogged` and not exempt. Pure: reads only the record, the same answer
// for every player. Exempt: a token with an owner (OQ-FOG-03, decided #196); a template a player
// placed. Props are DM-placed, never exempt. Independent of a token's `hidden` flag.

/** Fields fog reads from any fog subject (token, prop, AoE template). */
export interface FogSubject {
  fogged?: boolean;
  ownerPlayerId?: string | null;
  placedByPlayerId?: string | null;
}

export const TOKEN_SUBJECT = "token";
export const TEMPLATE_SUBJECT = "aoe-template";

export function fogHidden(type: string, r: FogSubject): boolean {
  if (r.fogged !== true) return false;
  if (type === TOKEN_SUBJECT) return r.ownerPlayerId == null;
  if (type === TEMPLATE_SUBJECT) return r.placedByPlayerId == null;
  return true;
}
