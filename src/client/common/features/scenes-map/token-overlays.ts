// Token overlay registry (FR-MAP-34, protocol §26). APPEND-ONLY (AGENTS §9.9): a feature adds
// one import and one line; nothing else changes here. scenes-map draws the results inside the
// token's group, merged in registry order. combat-tracker adds `cbt` (Out, Down, target ring,
// `movedFt`; FR-CBT-38/39).

import type { RecordStore } from "@shared/protocol/store";
import type { TokenView } from "@shared/scenes-map/schemas";

export interface TokenOverlayView {
  client: "dm" | "player";
  /** The token is in the DM selection (FR-MAP-31); always false on the player client. */
  selected: boolean;
  /** Targeting mode is on (FR-MAP-33); always false on the player client. */
  targeting: boolean;
}

export interface TokenBadge {
  /** Test id; Konva `name` of the badge (its `id` = token id). */
  id: string;
  /** Icon name (lucide). */
  icon: string;
  /** Palette tone (visual-direction): `down` = `hp.down`, `bloodied` = `hp.bloodied`. */
  tone: "neutral" | "bloodied" | "down";
  label: string;
}

export interface TokenDecoration {
  /** Opacity × 0.5. */
  dim?: boolean;
  /** In a row on the footprint's bottom edge. */
  badges?: readonly TokenBadge[];
  /** Replaces the selection ring. */
  ring?: "target";
}

/** Pure functions; a throw is logged once and ignored (token drawn plain). */
export interface TokenOverlay {
  id: string;
  decorate?(token: TokenView, store: RecordStore, view: TokenOverlayView): TokenDecoration | null;
  /** Movement used this turn, ft; first non-null wins (FR-MAP-37). */
  movedFt?(token: TokenView, store: RecordStore): number | null;
}

export const tokenOverlays: readonly TokenOverlay[] = [];
