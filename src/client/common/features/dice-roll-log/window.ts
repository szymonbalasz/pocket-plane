// `dice.log` window geometry (DICE §7, protocol §24); each client registers its own def.
import { ScrollTextIcon } from "lucide-react";
import type { WindowDef } from "../play-shell/registry";

export const DICE_LOG_KIND = "dice.log";

export const diceLogWindowBase = {
  kind: DICE_LOG_KIND,
  title: "Game log",
  // DICE §7 says 420×320 bottom-left. With map.scenes (top-left, dx 56, 300×480) and
  // camp.players (top-right, 540×360) default-open, 1280×720 leaves a 360 px gap between them
  // (FR-SHELL-08: no overlap), so the log is 340 wide, starting right of map.scenes (x = 376).
  defaultSize: { w: 340, h: 320 },
  minSize: { w: 300, h: 200 },
  defaultPosition: { anchor: "bottom-left", dx: 364 },
  defaultOpen: true,
  launcher: { icon: ScrollTextIcon, label: "Log", order: 40 },
} satisfies Omit<WindowDef, "component" | "clients">;
