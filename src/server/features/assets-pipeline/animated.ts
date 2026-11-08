// Animated tokens (ANIM, ADR-0080). Leaf module (no imports): the token and mirror row builders
// read it.

/**
 * FR-ANIM-06: asset IDs known to be animated, for the token and mirror wire rows (whose builders
 * read the row only, ADR-0021). Process-wide is safe: a real ID is a 128-bit CSPRNG draw, and a
 * seeded one mixes in the source bytes' hash, so one ID never names a still image somewhere and
 * a video elsewhere. Filled at ingest and at start; an entry outliving its row (rolled back,
 * deleted) names an asset nothing can reference.
 */
const animated = new Set<string>();

export function markAnimated(id: string): void {
  animated.add(id);
}

export function isAnimatedAsset(id: string | null | undefined): boolean {
  return id != null && animated.has(id);
}
