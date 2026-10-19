// `dice.log` window geometry (DICE §7, protocol §24); each client registers its own def.
import { GAME_LOG_ENTRY_TYPE } from "@shared/dice-roll-log/schemas";
import { recordsOf } from "@shared/protocol/store";
import { ScrollTextIcon } from "lucide-react";
import type { Viewport } from "../play-shell/geometry";
import { isTall, isWide, type Size, type WindowDef } from "../play-shell/registry";
import { makeLogFocusRuntime } from "./focus";

export const DICE_LOG_KIND = "dice.log";

/**
 * FR-DICE-38 (decided [7], #256 OQ-SHELL-31 A): 2.5× today's width from 1440 wide, 1.5× below;
 * today's height from 900 high, 160 below. `wide` / `tall`: the sizes on a wide + tall screen.
 */
export const logSize =
  (wide: Size) =>
  (vp: Viewport): Size => ({
    w: isWide(vp) ? wide.w : Math.round((wide.w / 2.5) * 1.5),
    h: isTall(vp) ? wide.h : 160,
  });

export const diceLogWindowBase = {
  kind: DICE_LOG_KIND,
  title: "Game log",
  // DICE §7: bottom-left. Player default (protocol §24): bottom-left, clear of the tool rail;
  // 850×280 wide + tall, 510 / 160 below (FR-DICE-38). The DM's def overrides the size (1150×240).
  defaultSize: logSize({ w: 850, h: 280 }),
  // FR-SHELL-53: the sprint-4 default; a log still at it takes the new default once.
  previousDefaults: [{ w: 340, h: 280 }],
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
