// `dice.log` window geometry (DICE §7, protocol §24); each client registers its own def.
import { ScrollTextIcon } from "lucide-react";
import type { WindowDef } from "../play-shell/registry";

export const DICE_LOG_KIND = "dice.log";

export const diceLogWindowBase = {
  kind: DICE_LOG_KIND,
  title: "Game log",
  // DICE §7: bottom-left. Player default (protocol §24): bottom-left, clear of the tool rail.
  // The DM's def overrides it (bottom strip right of `map.scenes`).
  defaultSize: { w: 340, h: 280 },
  minSize: { w: 300, h: 200 },
  defaultPosition: { anchor: "bottom-left", dx: 56 },
  defaultOpen: true,
  launcher: { icon: ScrollTextIcon, label: "Log", order: 40 },
} satisfies Omit<WindowDef, "component" | "clients">;
