// `dice.log` window geometry (DICE §7, protocol §24); each client registers its own def.
import { GAME_LOG_ENTRY_TYPE } from "@shared/dice-roll-log/schemas";
import { recordsOf } from "@shared/protocol/store";
import { ScrollTextIcon } from "lucide-react";
import type { Viewport } from "../play-shell/geometry";
import { isTall, isWide, type Size, type WindowDef } from "../play-shell/registry";
import { DICE_DETAILS_KIND, RollDetailsRuntime } from "./details";
import { makeLogFocusRuntime } from "./focus";

export const DICE_LOG_KIND = "dice.log";

/**
 * FR-DICE-38 (decided [7], #256 OQ-SHELL-31 A): 2.5× today's width from 1440 wide, 1.5× below;
 * today's height from 900 high, 200 below (kit-parity OQ-KIT-02 B: +40 for the kit's 40-px rows).
 * `wide` / `tall`: the sizes on a wide + tall screen.
 */
export const logSize =
  (wide: Size) =>
  (vp: Viewport): Size => ({
    w: isWide(vp) ? wide.w : Math.round((wide.w / 2.5) * 1.5),
    h: isTall(vp) ? wide.h : 200,
  });

/** FR-SHELL-100: 2 entries + the roll bar (kit-parity §7.3, 40-px rows). */
export const LOG_USEFUL: Size = { w: 460, h: 200 };

export const diceLogWindowBase = {
  kind: DICE_LOG_KIND,
  title: "Game log",
  // DICE §7: bottom-left. Player default (protocol §24): bottom-left, clear of the tool rail;
  // 850×320 wide + tall, 510 / 200 below (FR-DICE-38, OQ-KIT-02 B). The DM's def overrides the
  // size (1150×280).
  defaultSize: logSize({ w: 850, h: 320 }),
  // FR-SHELL-53: the sprint-4 default and the pre-kit ones (K5); a log still at one takes the
  // new default once.
  previousDefaults: [
    { w: 340, h: 280 },
    { w: 850, h: 280 },
    { w: 510, h: 160 },
  ],
  minSize: { w: 300, h: 160 },
  defaultPosition: { anchor: "bottom-left", dx: 56 },
  defaultOpen: true,
  launcher: { icon: ScrollTextIcon, label: "Log", order: 40 },
  // FR-DICE-33: minimised "new" dot (FR-SHELL-38) = the highest entry `n` this client sees.
  activity: (store) =>
    recordsOf<{ n: number }>(store, GAME_LOG_ENTRY_TYPE).reduce((m, e) => Math.max(m, e.n), 0),
  // FR-DICE-37: `focusLogEntry` opens / fronts the log whatever its state.
  companion: makeLogFocusRuntime(DICE_LOG_KIND),
} satisfies Omit<WindowDef, "component" | "clients">;

/**
 * FR-DICE-106: `dice.details` "Roll details" geometry, both clients: no launcher (opened from a log
 * row), one instance that follows the row picked; its target is client memory, so it loads closed.
 */
export const diceDetailsWindowBase = {
  kind: DICE_DETAILS_KIND,
  title: "Roll details",
  defaultSize: (vp: Viewport) => (vp.h >= 800 ? { w: 420, h: 520 } : { w: 420, h: 412 }),
  minSize: { w: 320, h: 240 },
  usefulSize: { w: 400, h: 360 },
  defaultPosition: { anchor: "top-left", dx: 56 },
  defaultOpen: false,
  restoreOpen: false,
  companion: RollDetailsRuntime,
} satisfies Omit<WindowDef, "component" | "clients">;
