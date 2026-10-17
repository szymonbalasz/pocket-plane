// Token overlay registry (FR-MAP-34, protocol §26). APPEND-ONLY (AGENTS §9.9): a feature adds
// one import and one line; nothing else changes here. scenes-map merges the results in registry
// order and draws dim, ring, cross, bar, icons and cue inside the token's group, badges in the
// label row (FR-MAP-43; bar + icons: OQ-CBTX-21; cue + subscribe: FR-MAP-49). combat-tracker adds
// `cbt` (Out, Down, target ring, `movedFt`; FR-CBT-38/39).

import type { RecordStore } from "@shared/protocol/store";
import type { TokenView } from "@shared/scenes-map/schemas";
import { cbtxTokenOverlay } from "../combat-extras/token-overlay";
import { cbtTokenOverlay } from "../combat-tracker/token-overlay";
import { modTriggersOverlay } from "../effect-modifiers/trigger-badges";
import { fogTokenOverlay } from "../fog-of-war/token-overlay";
import { noteCueOverlay } from "../notifications/token-cue";

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

/** A translucent X over the footprint (FR-MAP-43), e.g. combat's Down. */
export interface TokenCross {
  /** Test id; Konva `name` of the cross (its `id` = token id). */
  id: string;
  tone: TokenBadge["tone"];
}

/**
 * A bar on the footprint's top edge, inside the token group (OQ-CBTX-21, FR-CBTX-28), e.g.
 * combat-extras' HP bar. Konva `name` = `id`, `id` attr = token id, attrs `tone`, `fraction`.
 */
export interface TokenBar {
  /** Test id; Konva `name` of the bar. */
  id: string;
  /** Filled share 0–1 over a muted track; null = full width with no track (no proportion). */
  fraction: number | null;
  /** A neutral segment after the fill, as a share of the width; fill + temp capped at 1. */
  temp?: number;
  /** `full` = `hp.full`, `bloodied` = `hp.bloodied`. */
  tone: "full" | "bloodied";
}

/**
 * A small icon in a row below the bar, top-left (FR-CBTX-29). At most 4 are drawn, then "+N".
 * Konva `name` = `id`, `id` attr = token id, attrs `value`, `icon`, `tone`, `label`, `muted`;
 * hovering it shows `label` as a tooltip (FR-MAP-57, S9).
 */
export interface TokenIcon {
  /** Test id; Konva `name` of the icon. */
  id: string;
  /** Icon name (lucide); kept as an attribute, drawn as the label's initials. */
  icon: string;
  tone: TokenBadge["tone"];
  /** Full text (hover tooltip / tests); also the source of the drawn initials, e.g. "Exhaustion 2" → "E2". */
  label: string;
  /** Konva attr `value`, e.g. a condition key (`data-value` for tests). */
  value?: string;
  /** Drawn in the muted tone whatever `tone` says, e.g. a trigger with every use spent (FR-CBTX-53). */
  muted?: boolean;
}

/**
 * A transient cue (FR-MAP-49): pulsing accent ring + bell glyph in the token group, above the
 * image, bar and icons; steady under `prefers-reduced-motion`. Konva `name` = `id`, `id` attr =
 * token id, attr `label` (no tooltip: the owning feature's UI explains it).
 */
export interface TokenCue {
  /** Test id; Konva `name` of the cue. */
  id: string;
  label: string;
}

export interface TokenDecoration {
  /** Token group opacity × 0.5 (the label row stays at full opacity). */
  dim?: boolean;
  /**
   * In rows above the name, inside the footprint, overflow as "+N", on the labels layer (FR-MAP-43,
   * BL-04); one whose label doesn't fit is an icon chip (`icon`) with the label on hover (FR-MAP-57).
   */
  badges?: readonly TokenBadge[];
  /** Replaces the selection ring. */
  ring?: "target";
  /** Centred X inside the token group, above the image; first non-null wins. */
  cross?: TokenCross;
  /** Top-edge bar inside the token group; first non-null wins. */
  bar?: TokenBar;
  /** Icon row below the bar; concatenated in registry order. */
  icons?: readonly TokenIcon[];
  /** Transient cue above everything in the group; first non-null wins (FR-MAP-49). */
  cue?: TokenCue;
}

/** Pure functions; a throw is logged once and ignored (token drawn plain). */
export interface TokenOverlay {
  id: string;
  decorate?(token: TokenView, store: RecordStore, view: TokenOverlayView): TokenDecoration | null;
  /** Movement used this turn, ft; first non-null wins (FR-MAP-37). */
  movedFt?(token: TokenView, store: RecordStore): number | null;
  /**
   * FR-MAP-49: client-only state changed (e.g. a 4 s cue timer), so `decorate` may answer
   * differently without a record change. scenes-map subscribes once per overlay while the canvas
   * is mounted and re-runs decorations on `onChange`. A throw is logged once and ignored.
   */
  subscribe?(onChange: () => void): () => void;
}

export const tokenOverlays: readonly TokenOverlay[] = [
  cbtTokenOverlay, // combat-tracker (FR-CBT-38/39)
  cbtxTokenOverlay, // combat-extras: HP bar, effect icons, death badge (FR-CBTX-28/29/30)
  noteCueOverlay, // notifications: the DM's 4 s action cue (FR-NOTE-30)
  fogTokenOverlay, // fog-of-war: DM "Fog" / "Invisible" badges, View-as dimming (FR-FOG-20, -47)
  modTriggersOverlay, // effect-modifiers: one trigger icon, last in the icon row (FR-CBTX-53, S9)
];
