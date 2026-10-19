// `colorOf` (CAMP FR-CAMP-28, ADR-0055): a person's player colour, looked up from the `player` /
// `campaign` records the store already holds; the hex comes from the theme token
// `--player-<key>` (fallback: the palette). Every surface that marks a person (laser, pings,
// templates, drag paths, log names, notification stripes) calls this with the person it already
// carries; nothing copies a colour onto its own rows or frames.
import { isPlayerColor, PLAYER_COLORS, type PlayerColor } from "@shared/campaign-management/colors";
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

export const playerColorVar = (key: PlayerColor) => `--player-${key}`;

type Records = Pick<RecordStore, "you" | "records">;

/** The DM colour: the store's campaign (the connection's own; a client holds only that one). */
function dmColorKey(store: Records): string | undefined {
  const byId = store.records.campaign as Record<string, CampaignRecord> | undefined;
  if (!byId) return undefined;
  const own = store.you?.campaignId ? byId[store.you.campaignId] : undefined;
  return (own ?? Object.values(byId)[0])?.dmColor;
}

/** The person's palette key, or null (system actor, unknown player, unknown key). */
export function colorKeyOf(store: Records, person: ColorPerson): PlayerColor | null {
  if (person.role === "system") return null;
  const key =
    person.role === "dm"
      ? dmColorKey(store)
      : (store.records.player?.[person.playerId ?? ""] as PlayerRecord | undefined)?.color;
  return isPlayerColor(key) ? key : null;
}

/** The hex of a palette key: the theme token, else the palette value. */
export function colorHex(key: PlayerColor, read: ReadVar = readCssVar): string {
  return read(playerColorVar(key)) || PLAYER_COLORS[key];
}

/**
 * FR-CAMP-28: the person's colour; an unknown player or key (old client, deleted row) → the role
 * accent; the system actor → null (neutral: draw nothing person-coloured).
 */
export function colorOf(
  store: Records,
  person: ColorPerson,
  read: ReadVar = readCssVar,
): string | null {
  if (person.role === "system") return null;
  const key = colorKeyOf(store, person);
  if (key) return colorHex(key, read);
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
