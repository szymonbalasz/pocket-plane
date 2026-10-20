// The overkill callout rule (FR-STATS-21, FR-CBT-137): stamped on the outcome line at apply, and
// re-derived by stats from the same `hp_change` facts (old lines carry no flag, OQ-STATS-13 A).

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
