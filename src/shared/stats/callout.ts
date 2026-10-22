// The overkill callout rule (FR-STATS-21, FR-CBT-137) and the kill-feed classification
// (FR-STATS-26, FR-CBT-152): stamped on the outcome line at apply, and re-derived by stats from the
// same `hp_change` facts (old lines carry no flag, OQ-STATS-13 A).

export interface CalloutFacts {
  hpBefore: number;
  hpAfter: number;
  /** `max(0, raw − absorbed − hpBefore)` (FR-STATS-08). */
  overkill: number;
  /** Damage temp HP took first (FR-CBTX-15). */
  absorbed: number;
}

/** OQ-STATS-05 A: the target went to 0 and the overkill is at least max(10, what was needed). */
export const isOverkillCallout = (f: CalloutFacts): boolean =>
  f.hpAfter === 0 && f.overkill >= Math.max(10, f.hpBefore + f.absorbed);

/** FR-CBT-152: an outcome line's `fell` flag. */
export type Fell = "kill" | "down";

/**
 * FR-CBT-152 / FR-STATS-26 (OQ-STATS-20 A): a damage row going `hpBefore > 0 → 0` is a `kill` on
 * a monster that is not a companion, a `down` on a PC or a companion, whoever the attacker; else
 * null.
 */
export function fellOf(
  target: { kind: "pc" | "monster"; ownerCharacterId?: string | null },
  hp: { hpBefore: number; hpAfter: number },
): Fell | null {
  if (!(hp.hpBefore > 0 && hp.hpAfter === 0)) return null;
  return target.kind === "monster" && (target.ownerCharacterId ?? null) === null ? "kill" : "down";
}
