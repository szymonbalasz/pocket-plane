// The ally side in both clients (FR-CBT-104, #252): which side chip a row or token shows. Pure over
// the combatant each client holds: the DM's carries the true `side` and `publicSide`; a player's
// `side` is already the side they were last openly shown (FR-CBT-100), and no `publicSide`.
import { defaultSide, publicSideOf, sideOf } from "@shared/combat-tracker/rules";
import type { CombatantKind, Side } from "@shared/combat-tracker/schemas";

export interface SideChipView {
  side: Side;
  /** DM only: players see another side (`sideOf ≠ publicSideOf`); the chip is dashed. */
  secret: boolean;
}

export const SIDE_LABEL: Record<Side, string> = { ally: "Ally", enemy: "Enemy" };

export const otherSide = (s: Side): Side => (s === "ally" ? "enemy" : "ally");

/**
 * The chip: "Ally" on a monster set to ally, "Enemy" on a PC set to enemy; the kind's default shows
 * nothing, unless (DM) players see another side, then the true side, dashed.
 */
export function sideChip(c: {
  kind: CombatantKind;
  side?: Side | null;
  publicSide?: Side | null;
}): SideChipView | null {
  const side = sideOf(c);
  // DM rows carry `publicSide` (null = the kind's default); players' never do.
  const secret = c.publicSide !== undefined && publicSideOf(c) !== side;
  return side !== defaultSide(c.kind) || secret ? { side, secret } : null;
}

/**
 * The DM's "Set as …" entry (row and token menu): the other side than the true one; while
 * players see another side, `reveal` = the true side ("Set as enemy (show players)", an open set).
 */
export function sideMenuOf(c: {
  kind: CombatantKind;
  side?: Side | null;
  publicSide?: Side | null;
}) {
  const side = sideOf(c);
  const to = otherSide(side);
  return { to, label: `Set as ${to}`, reveal: sideChip(c)?.secret ? side : null };
}
