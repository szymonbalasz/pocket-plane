// Log-entry kind contract (FR-DICE-18). A kind = payload schema (+ optional DM-only payload
// schema) + a pure `formatLine`. Registered in `./kinds.ts` (append-only).
import type { RollCategory } from "@shared/events/dice-roll-log";
import type { z } from "zod";

/**
 * One die of a line (FR-DICE-35, -36; seams S8 / ruling B5): drawn as a die-shape chip
 * (FR-DICEX-42) in place of the segment's text. `faces` null = no single die type (a physical
 * total of several dice, an unparsable expression) → a round chip. `kept: false` = dropped (adv /
 * dis) only; `offered: true` = an offered trigger die (dashed, never struck). `label` = the part's
 * name for trigger / weapon extra parts ("Divine Fury").
 */
export interface LineDie {
  faces: number | null;
  value: number;
  kept: boolean;
  offered?: true;
  label?: string;
}

/** One styled run of a log line; clients map styles to markup, tests read `lineText`. */
export interface LineSegment {
  /** Always set, also on a `die` segment ("13"): `lineText`, copy and screen readers read it. */
  text: string;
  /** actor / total: bold; dropped: struck through; badge: small Badge; muted: muted text. */
  style?: "actor" | "total" | "dropped" | "badge" | "muted";
  /** One die per segment (seams S8); DM-only exactly when its text is (FR-DICE-28). */
  die?: LineDie;
  /** A number from dice that is not a die (a rolled part's sum): "…" on a held line (FR-DICE-40). */
  numeric?: true;
  /** FR-DICE-95: the segment's own Tooltip text ("Dice changed in the tray"). */
  tip?: string;
}

export interface LineInput<P, D> {
  actorName: string;
  payload: P;
  /** DM only; absent / null for players. */
  dmPayload?: D | null;
  /** The entry's category, when known (FR-DICE-29: no natural marker on initiative). */
  category?: RollCategory;
}

/** The entry fields a trace reads (a `game-log-entry` row; ADR-0058). */
export interface TracedEntry {
  supersededBy: string | null;
  payload: unknown;
}

/**
 * ADR-0058 trace (FR-DICE-69): what another feature left on this kind's entries. While the
 * campaign's `feature` is off, `hides` true → the entry is hidden for every viewer; `strip` → the
 * entry as sent (pure: record in, record out). Applied by the hub.
 */
export interface LogKindTrace {
  feature: string;
  hides?(entry: TracedEntry): boolean;
  strip?<E extends TracedEntry>(entry: E): E;
}

export interface LogKindDef<P = unknown, D = unknown> {
  /** `roll` (dice) or `<prefix>.<name>` (other features, e.g. `cbt.attack`). */
  kind: string;
  /** Player-safe payload. */
  payload: z.ZodType<P>;
  /** DM-only extras, stripped for players. No schema → `dmPayload` must be null. */
  dmPayload?: z.ZodType<D>;
  formatLine(entry: LineInput<P, D>): LineSegment[];
  /**
   * FR-DICE-69 (ADR-0058): a key of the feature registry (`@shared/campaign-management/features`).
   * Entries of the kind are hidden for every viewer (DM too) while the campaign's feature is off.
   */
  feature?: string;
  /** FR-DICE-69: other features' traces on this kind's entries (e.g. gems' supersede on `roll`). */
  traces?: readonly LogKindTrace[];
}

export type AnyLogKind = LogKindDef<unknown, unknown>;

/** Typed definition helper; erases types for the registry. */
export function defineLogKind<P, D = never>(def: LogKindDef<P, D>): AnyLogKind {
  return def as unknown as AnyLogKind;
}

/** Plain text of a line; dropped dice as `~v~`, badges in parentheses. */
export function lineText(segments: readonly LineSegment[]): string {
  return segments
    .map((s) =>
      s.style === "dropped" ? `~${s.text}~` : s.style === "badge" ? `(${s.text})` : s.text,
    )
    .join("");
}
