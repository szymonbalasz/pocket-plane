// Person-coloured marks on the map (FR-MAP-68–73, FR-SCN-47, FR-NOTE-40; ADR-0055): every mark
// resolves its colour at draw time from the person it already carries (a signal's `from`, a
// token's `ownerPlayerId`, a template's `placedByPlayerId`) via CAMP's `colorOf`, so a colour change
// redraws them all and nothing colour-shaped is stored or sent. Coloured strokes draw over an
// opaque dark casing (FR-MAP-72); Konva attrs `color` (the drawn hex) and `by` (player id | `dm`).
// DOM-free (testable).
import type { PlayerRecord } from "@shared/campaign-management/schemas";
import type { RecordStore } from "@shared/protocol/store";
import {
  colorOf,
  type ReadVar,
  ROLE_ACCENT_FALLBACK,
  readCssVar,
} from "../campaign-management/colors";

/** A person behind a mark (never the system actor: no map mark is the system's). */
export interface MarkPerson {
  role: "dm" | "player";
  playerId?: string | null;
}

type Records = Pick<RecordStore, "you" | "records">;

/** FR-MAP-72: opaque casing under every coloured mark, 2 screen px wider than its stroke. */
export const CASING_COLOR = "#000";
export const CASING_EXTRA_PX = 2;
/** Konva `name` of every casing node (its `id` = its mark's id). */
export const CASING_NAME = "map-casing";

/** Casing stroke width in map px for a mark stroked `strokePx` screen px at camera `scale`. */
export const casingWidth = (strokePx: number, scale: number) =>
  (strokePx + CASING_EXTRA_PX) / scale;

/** Konva `by` attr: the player id, or `dm` (also on this client's own marks: no `self`). */
export const byAttr = (p: MarkPerson): string => (p.role === "dm" ? "dm" : (p.playerId ?? ""));

/** FR-MAP-68 / -69 chip and FR-SCN-47 "by ‹name›": the player's name, or "DM". */
export function personName(store: Records, p: MarkPerson): string {
  if (p.role === "dm") return "DM";
  const r = store.records.player?.[p.playerId ?? ""] as PlayerRecord | undefined;
  return r?.name ?? "Player";
}

/**
 * The mark's hex: `colorOf` (unknown player / key → the role accent, FR-MAP-72). Never null: a map
 * mark always has a person.
 */
export function markColor(store: Records, p: MarkPerson, read: ReadVar = readCssVar): string {
  return colorOf(store, p, read) ?? ROLE_ACCENT_FALLBACK[p.role];
}

/** FR-MAP-70 (OQ-MAP-52 A): a token's paths and trail are its owner's; no owner → the DM's. */
export const ownerOf = (t: { ownerPlayerId: string | null }): MarkPerson =>
  t.ownerPlayerId ? { role: "player", playerId: t.ownerPlayerId } : { role: "dm" };

/** FR-SCN-47: a kept template is its placer's; `placedByPlayerId` null → the DM's. */
export const placerOf = (r: { placedByPlayerId: string | null }): MarkPerson =>
  r.placedByPlayerId ? { role: "player", playerId: r.placedByPlayerId } : { role: "dm" };

/** This client's own person (own marks draw in the own colour). */
export const selfOf = (client: "dm" | "player", myPlayerId: string | null): MarkPerson =>
  client === "dm" ? { role: "dm" } : { role: "player", playerId: myPlayerId };
