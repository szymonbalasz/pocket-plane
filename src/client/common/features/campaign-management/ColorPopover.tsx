// FR-CAMP-27 colour picker (CAMP §7): a swatch Button opening a Popover of the 8 palette swatches
// (4 × 2). Used by the player's header dot and the DM's Players panel. Taken keys (another
// player's, or the DM's) are disabled with "‹Key› — taken by ‹name›"; the target's own key is
// checked. A click sends `camp.setColor`; nothing is optimistic (ADR-0021 E): every swatch and the
// trigger read the `player` / `campaign` records, so a reject (Toast) leaves the server's colour.
import {
  colorLabel,
  isPlayerColor,
  PLAYER_COLOR_KEYS,
  type PlayerColor,
} from "@shared/campaign-management/colors";
import type {
  CampaignRecord,
  PlayerRecord,
  SetColorInput,
} from "@shared/campaign-management/schemas";
import { CheckIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/menus";
import { Tooltip } from "../../components/ui/overlays";
import { cn } from "../../lib/utils";
import { useSync } from "../../sync/store";
import { toastReject } from "../scenes-map/intents";
import { colorHex, colorOf } from "./colors";

export const SET_COLOR_INTENT = "camp.setColor";

/** Whose colour a picker sets: a player's id, or `null` = the DM colour (FR-CAMP-25). */
export type ColorTarget = string | null;

export interface Swatch {
  key: PlayerColor;
  hex: string;
  /** "Rose", or "Rose — taken by Player 2" (aria-label and Tooltip). */
  label: string;
  /** Who holds the key besides the target: a player id, `dm`, or null (free). */
  takenBy: string | null;
  checked: boolean;
}

export interface ColorHolders {
  players: readonly Pick<PlayerRecord, "id" | "name" | "color">[];
  dmColor: string | undefined;
}

/** FR-CAMP-26 as the picker shows it: a key held by anyone but the target is taken. */
export function colorSwatches(
  { players, dmColor }: ColorHolders,
  target: ColorTarget,
  hex: (key: PlayerColor) => string = colorHex,
): Swatch[] {
  const own = target === null ? dmColor : players.find((p) => p.id === target)?.color;
  return PLAYER_COLOR_KEYS.map((key) => {
    // The own key is never taken, even when a repeated default (past 8) shares it.
    const mine = own === key;
    const byPlayer = mine ? undefined : players.find((p) => p.id !== target && p.color === key);
    const byDm = !mine && target !== null && dmColor === key;
    const takenBy = byDm ? "dm" : (byPlayer?.id ?? null);
    const name = byDm ? "DM" : byPlayer?.name;
    const label = name ? `${colorLabel(key)} — taken by ${name}` : colorLabel(key);
    return { key, hex: hex(key), label, takenBy, checked: mine };
  });
}

/** Sends FR-CAMP-25; a reject goes to `onReject` (Toast), a disconnect to the banner. */
export function pickColor(
  send: (name: string, payload: unknown) => Promise<unknown>,
  target: ColorTarget,
  color: PlayerColor,
  onReject: (err: unknown) => void = toastReject,
): Promise<void> {
  const input: SetColorInput = { playerId: target, color };
  return send(SET_COLOR_INTENT, input).then(() => undefined, onReject);
}

/** The Popover body: 8 round 24 px swatches, 4 × 2. */
export function ColorSwatches({
  swatches,
  disabled,
  onPick,
}: {
  swatches: readonly Swatch[];
  disabled: boolean;
  onPick: (key: PlayerColor) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {swatches.map((s) => (
        <Tooltip key={s.key} content={s.label}>
          {/* The Tooltip trigger's `data-state` would overwrite the swatch's: it sits on a wrapper. */}
          <span className="inline-flex">
            <button
              type="button"
              data-testid="camp-color-swatch"
              data-value={s.key}
              data-taken-by={s.takenBy ?? undefined}
              data-state={s.checked ? "checked" : "unchecked"}
              aria-label={s.label}
              aria-pressed={s.checked}
              disabled={disabled || s.takenBy !== null}
              onClick={() => onPick(s.key)}
              style={{ backgroundColor: s.hex }}
              className="inline-flex size-6 items-center justify-center rounded-full text-black ring-offset-2 ring-offset-popover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
            >
              {s.checked && <CheckIcon className="size-4" strokeWidth={3} />}
            </button>
          </span>
        </Tooltip>
      ))}
    </div>
  );
}

/** The campaign's players and DM colour from the live store. */
function useHolders(): ColorHolders & { store: Parameters<typeof colorOf>[0] } {
  const player = useSync((s) => s.store.records.player) as Record<string, PlayerRecord> | undefined;
  const campaign = useSync((s) => s.store.records.campaign) as
    | Record<string, CampaignRecord>
    | undefined;
  const you = useSync((s) => s.store.you);
  const own = (you?.campaignId && campaign?.[you.campaignId]) || Object.values(campaign ?? {})[0];
  return {
    players: Object.values(player ?? {}),
    dmColor: own?.dmColor,
    store: { you, records: { player: player ?? {}, campaign: campaign ?? {} } },
  };
}

/**
 * The swatch Button (`size` px round, the colour itself; `testId`, `data-value` = the target's
 * key) and its Popover. Swatches are
 * disabled while not live (FR-CAMP-25); the trigger stays usable so the Popover still opens.
 */
export function ColorPopover({
  target,
  testId,
  recordId,
  size,
  tip,
  className,
}: {
  target: ColorTarget;
  testId: string;
  recordId?: string;
  /** Trigger diameter in px (header dot 12, Players panel 16; CAMP §7). */
  size: 12 | 16;
  tip: string;
  className?: string;
}) {
  const connection = useSync((s) => s.connection);
  const live = useSync((s) => s.state === "live");
  const holders = useHolders();
  const [open, setOpen] = useState(false);
  const value =
    target === null ? holders.dmColor : holders.players.find((p) => p.id === target)?.color;
  const hex =
    colorOf(
      holders.store,
      target === null ? { role: "dm" } : { role: "player", playerId: target },
    ) ?? undefined;
  const swatches = colorSwatches(holders, target);
  const pick = (key: PlayerColor) => {
    setOpen(false);
    void pickColor((n, p) => connection.sendIntent(n, p), target, key);
  };
  const name = value && isPlayerColor(value) ? colorLabel(value) : "Unknown";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip content={tip}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            className={cn(
              "shrink-0 rounded-full p-0 align-middle",
              size === 12 ? "size-3" : "size-4",
              className,
            )}
            style={{ backgroundColor: hex }}
            data-testid={testId}
            data-record-id={recordId}
            data-value={value}
            aria-label={`${tip}: ${name}`}
          />
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent data-testid="camp-color-popover" className="w-auto p-3">
        <ColorSwatches swatches={swatches} disabled={!live} onPick={pick} />
      </PopoverContent>
    </Popover>
  );
}
