// `dice.log` window geometry (DICE §7, protocol §24); each client registers its own def.
import { ScrollTextIcon } from "lucide-react";
import type { WindowDef } from "../play-shell/registry";

export const DICE_LOG_KIND = "dice.log";

export const diceLogWindowBase = {
  kind: DICE_LOG_KIND,
  title: "Game log",
  defaultSize: { w: 420, h: 320 },
  minSize: { w: 300, h: 200 },
  // Bottom-left, above the launcher (the shell keeps bottom anchors clear of it).
  defaultPosition: { anchor: "bottom-left" },
  defaultOpen: true,
  launcher: { icon: ScrollTextIcon, label: "Log", order: 40 },
} satisfies Omit<WindowDef, "component" | "clients">;
