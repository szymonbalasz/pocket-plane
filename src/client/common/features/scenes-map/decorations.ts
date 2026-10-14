// Applying the token overlay registry (FR-MAP-34, -43): results merged in registry order (first
// non-null `cross` wins); a throw is logged once per overlay and ignored (token drawn plain).
// DOM-free so it runs under `bun test`.
import type { RecordStore } from "@shared/protocol/store";
import type { TokenView } from "@shared/scenes-map/schemas";
import type { TokenBadge, TokenCross, TokenOverlay, TokenOverlayView } from "./token-overlays";

export interface MergedDecoration {
  dim: boolean;
  badges: TokenBadge[];
  ring: "target" | null;
  cross: TokenCross | null;
}

export const plainDecoration: MergedDecoration = {
  dim: false,
  badges: [],
  ring: null,
  cross: null,
};

export type OverlayErrorReporter = (overlayId: string, err: unknown) => void;

const reported = new Set<string>();

/** Default reporter: `console.error` once per overlay id. */
export const logOverlayErrorOnce: OverlayErrorReporter = (id, err) => {
  if (reported.has(id)) return;
  reported.add(id);
  console.error(`Token overlay "${id}" threw; ignored`, err);
};

export function decorateToken(
  overlays: readonly TokenOverlay[],
  token: TokenView,
  store: RecordStore,
  view: TokenOverlayView,
  report: OverlayErrorReporter = logOverlayErrorOnce,
): MergedDecoration {
  let out: MergedDecoration | null = null;
  for (const o of overlays) {
    if (!o.decorate) continue;
    let d: ReturnType<NonNullable<TokenOverlay["decorate"]>>;
    try {
      d = o.decorate(token, store, view);
    } catch (err) {
      report(o.id, err);
      continue;
    }
    if (!d) continue;
    out ??= { dim: false, badges: [], ring: null, cross: null };
    if (d.dim) out.dim = true;
    if (d.badges) out.badges.push(...d.badges);
    if (d.ring === "target") out.ring = "target";
    if (d.cross && !out.cross) out.cross = d.cross;
  }
  return out ?? plainDecoration;
}

/** FR-MAP-37: movement used this turn = the first non-null `movedFt`, else null. */
export function movedFtOf(
  overlays: readonly TokenOverlay[],
  token: TokenView,
  store: RecordStore,
  report: OverlayErrorReporter = logOverlayErrorOnce,
): number | null {
  for (const o of overlays) {
    if (!o.movedFt) continue;
    try {
      const v = o.movedFt(token, store);
      if (v !== null && v !== undefined) return v;
    } catch (err) {
      report(o.id, err);
    }
  }
  return null;
}
