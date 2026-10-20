// `colorOf` (CAMP FR-CAMP-28, -36, ADR-0055): a person's player colour, looked up from the
// `player` / `campaign` records the store already holds: a stored `#rrggbb` as is; an old palette
// key via the theme token `--player-<key>` (fallback: the palette). Every surface that marks a
// person (laser, pings, templates, drag paths, log names, notification stripes) calls this with
// the person it already carries; nothing copies a colour onto its own rows or frames, and no
// caller switches on palette keys (seams S8).
import {
  isPaletteKey,
  normalizeColor,
  type PaletteKey,
  PLAYER_COLORS,
  paletteKeyOf,
} from "@shared/campaign-management/colors";
import type { CampaignRecord, PlayerRecord } from "@shared/campaign-management/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { useSync } from "@ui/sync/store";
import { useCallback } from "react";

/** Who made a mark: the DM, a player, or the system actor (no person, no colour). */
export interface ColorPerson {
  role: "dm" | "player" | "system";
  playerId?: string | null;
}

/** Today's role accents (`--warning` / `--success`): the fallback for an unknown person or key. */
export const ROLE_ACCENT_FALLBACK = { dm: "#eab308", player: "#22c55e" } as const;
const ROLE_ACCENT_VAR = { dm: "--warning", player: "--success" } as const;

/** Reads a CSS custom property; "" when unset (or outside a browser). */
export type ReadVar = (name: string) => string;

const cssCache = new Map<string, string>();

/** Theme tokens are fixed for the page's life (dark only): read once, then from memory. */
export const readCssVar: ReadVar = (name) => {
  const hit = cssCache.get(name);
  if (hit !== undefined) return hit;
  if (typeof document === "undefined") return "";
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (v) cssCache.set(name, v);
  return v;
};

export const playerColorVar = (key: PaletteKey) => `--player-${key}`;

type Records = Pick<RecordStore, "you" | "records">;

/** The DM colour: the store's campaign (the connection's own; a client holds only that one). */
function dmColorKey(store: Records): string | undefined {
  const byId = store.records.campaign as Record<string, CampaignRecord> | undefined;
  if (!byId) return undefined;
  const own = store.you?.campaignId ? byId[store.you.campaignId] : undefined;
  return (own ?? Object.values(byId)[0])?.dmColor;
}

/** The person's stored colour as the record holds it (hex, or an old key), or undefined. */
function storedColor(store: Records, person: ColorPerson): unknown {
  if (person.role === "system") return undefined;
  return person.role === "dm"
    ? dmColorKey(store)
    : (store.records.player?.[person.playerId ?? ""] as PlayerRecord | undefined)?.color;
}

/**
 * The person's colour as a `data-color` value: a palette colour (or an old key) → its palette
 * name ("rose"), any other valid colour → its lowercase hex; null for the system actor, an
 * unknown player or an unreadable value. Feed it to `colorHex` to paint.
 */
export function colorKeyOf(store: Records, person: ColorPerson): string | null {
  const hex = normalizeColor(storedColor(store, person));
  return hex ? (paletteKeyOf(hex) ?? hex) : null;
}

/**
 * The CSS colour of a hex or a palette key (FR-CAMP-36): a key → its theme token, else the
 * palette value; a hex → lowercase as is; anything else is returned unchanged (callers pass
 * `colorKeyOf`'s result, already checked).
 */
export function colorHex(color: string, read: ReadVar = readCssVar): string {
  if (isPaletteKey(color)) return read(playerColorVar(color)) || PLAYER_COLORS[color];
  return normalizeColor(color) ?? color;
}

/**
 * FR-CAMP-36: the person's colour as a CSS colour string: a stored `#rrggbb` as is; an old
 * palette key → its palette hex (theme token); anything else (old client, deleted row, unknown
 * value) → the role accent; the system actor → null (neutral: draw nothing person-coloured).
 */
export function colorOf(
  store: Records,
  person: ColorPerson,
  read: ReadVar = readCssVar,
): string | null {
  if (person.role === "system") return null;
  const stored = storedColor(store, person);
  if (isPaletteKey(stored)) return colorHex(stored, read);
  const hex = normalizeColor(stored);
  if (hex) return hex;
  return read(ROLE_ACCENT_VAR[person.role]) || ROLE_ACCENT_FALLBACK[person.role];
}

/**
 * `colorOf` bound to the live store: re-renders when a `player` / `campaign` record changes (a
 * colour change recolours every mark, OQ-CAMP-21), not on other events.
 */
export function useColorOf(): (person: ColorPerson) => string | null {
  const player = useSync((s) => s.store.records.player);
  const campaign = useSync((s) => s.store.records.campaign);
  const you = useSync((s) => s.store.you);
  return useCallback(
    (person: ColorPerson) =>
      colorOf({ you, records: { player: player ?? {}, campaign: campaign ?? {} } }, person),
    [player, campaign, you],
  );
}
