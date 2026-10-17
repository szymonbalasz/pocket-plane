// FR-DICEX-32 / -38 / -43: where one frame's dice show on this device, pure. The big throw holds
// only the frame's public entries (DM-only entries never animate big, FR-DICEX-38) and, with
// "Show others' rolls" off, only this client's own (FR-DICEX-43); those wait for the popup.
import { type DiceThrow, throwDice } from "@shared/dice-extras/throw";
import type { GameLogEntryView } from "@shared/dice-roll-log/schemas";
import type { You } from "@shared/protocol/frames";
import type { DiceSettings, DisplaySetting } from "./settings";
import { isOwn } from "./throw-source";

/**
 * The roll popup (FR-DICEX-39–41) hosts each frame's dice, name and total (D7). Off, flat dice
 * and "Rolling…" would show in the zone as with the `popup` setting off.
 */
export const ROLL_POPUPS = true;

export interface ThrowPlan {
  /** `screen`: the dice layer's viewport arena; `zone`: the free-area zone (FR-DICEX-17). */
  arena: "screen" | "zone";
  draw: "3d" | "flat";
  /** FR-DICEX-17: roller name, label and total in the zone, only while popups are off. */
  caption: boolean;
  /** FR-DICEX-35: popups on → rest 1 s + hand-off 0.4 s; off → rest 1.5 s + fade. */
  handoff: boolean;
}

export interface PlanInput {
  settings: DiceSettings;
  /** The effective display (FR-DICEX-32: no WebGL already → `flat`). */
  display: DisplaySetting;
  /** `document.hidden`: no animation while the tab is hidden (DICEX §11). */
  tabHidden: boolean;
}

/** Popups take this throw's dice (D7), so none show in the zone. */
export const popupHost = (s: DiceSettings) => ROLL_POPUPS && s.popup;

/** FR-DICEX-32 §7 table: one frame's big throw and how it draws, or null. */
export function planThrow(
  entries: readonly GameLogEntryView[],
  you: You | null,
  input: PlanInput,
): { t: DiceThrow; plan: ThrowPlan } | null {
  const { settings, display } = input;
  if (display === "off" || input.tabHidden) return null;
  const big = entries.filter((e) => e.public && (settings.others || isOwn(e, you)));
  const t = throwDice(big);
  if (!t) return null;
  const timing = { caption: !settings.popup, handoff: settings.popup };
  if (display === "flat") {
    return popupHost(settings) ? null : { t, plan: { arena: "zone", draw: "flat", ...timing } };
  }
  return {
    t,
    plan: {
      arena: display,
      draw: "3d",
      caption: display === "zone" && timing.caption,
      handoff: timing.handoff,
    },
  };
}

/** FR-DICEX-09: the pending throw shows in the zone (zone display, or flat with no popup). */
export function pendingInZone(settings: DiceSettings, display: DisplaySetting): boolean {
  if (popupHost(settings)) return false;
  return display === "zone" || display === "flat";
}
