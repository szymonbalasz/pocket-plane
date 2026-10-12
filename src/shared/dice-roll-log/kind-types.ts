// Log-entry kind contract (FR-DICE-18). A kind = payload schema (+ optional DM-only payload
// schema) + a pure `formatLine`. Registered in `./kinds.ts` (append-only).
import type { z } from "zod";

/** One styled run of a log line; clients map styles to markup, tests read `lineText`. */
export interface LineSegment {
  text: string;
  /** actor / total: bold; dropped: struck through; badge: small Badge; muted: muted text. */
  style?: "actor" | "total" | "dropped" | "badge" | "muted";
}

export interface LineInput<P, D> {
  actorName: string;
  payload: P;
  /** DM only; absent / null for players. */
  dmPayload?: D | null;
}

export interface LogKindDef<P = unknown, D = unknown> {
  /** `roll` (dice) or `<prefix>.<name>` (other features, e.g. `cbt.attack`). */
  kind: string;
  /** Player-safe payload. */
  payload: z.ZodType<P>;
  /** DM-only extras, stripped for players. No schema → `dmPayload` must be null. */
  dmPayload?: z.ZodType<D>;
  formatLine(entry: LineInput<P, D>): LineSegment[];
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
