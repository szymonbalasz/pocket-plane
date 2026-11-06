// Turn reaction (FR-VFX-15, OQ-VFX-03 A; pure, client only): when the turn the viewer is shown
// passes to a combatant on the other side whose token the viewer has and whose footprint is inside
// a `turnInside` aura's radius, that aura strikes it. FR-VFX-40: a template aura (Black
// Tentacles) grabs any creature whose footprint is in its square, either side. DOM-free.
import type { CombatantView } from "@shared/combat-tracker/schemas";
import type { TokenView } from "@shared/scenes-map/schemas";
import { type AuraSpec, insideAura, insideSquare, sideOfCombatant } from "./anchors";
import type { DrawnBox } from "./engine";

export interface Strike {
  /** The striking aura's key. */
  key: string;
  tokenId: string;
}

/**
 * The strikes for the turn passing to `c` (its token as this canvas draws it): every aura with
 * `turnInside` on the other side (party aura → monster; monster aura → party) whose radius holds
 * the token's footprint (VFX §8: centre distance ≤ radius + half the target's side).
 */
export function turnStrikes(
  auras: readonly AuraSpec[],
  c: CombatantView,
  token: TokenView | undefined,
  position: (tokenId: string) => DrawnBox | null,
  cell: number,
): Strike[] {
  if (!token) return [];
  const target = position(token.id);
  if (!target) return [];
  const side = sideOfCombatant(c, token);
  const out: Strike[] = [];
  for (const a of auras) {
    if (!a.preset.reactions?.includes("turnInside")) continue;
    if (a.templateId !== null) {
      // FR-VFX-40: the area holds everyone in it, friend or foe.
      const square = position(a.tokenId);
      if (square && insideSquare(square, target, cell)) out.push({ key: a.key, tokenId: token.id });
      continue;
    }
    if (a.radiusFt === null) continue;
    if (a.tokenId === token.id || a.side === side) continue;
    const anchor = position(a.tokenId);
    if (!anchor) continue;
    if (insideAura(anchor, a.radiusFt, target, cell)) out.push({ key: a.key, tokenId: token.id });
  }
  return out;
}
