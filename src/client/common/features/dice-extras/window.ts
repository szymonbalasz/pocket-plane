// `dicex.tray` window geometry (FR-DICEX-01; protocol §18 / §24): default closed (map-first,
// #162), 360×300, min 300×240, launcher "Dice" after "Log". Each client registers its own def
// (left edge, above its `dice.log`). The companion runs throws whether the tray is open or not.
import { DicesIcon } from "lucide-react";
import type { WindowDef } from "../play-shell/registry";
import { DiceExtrasRuntime } from "./ThrowLayer";
import { TrayWindow } from "./TrayWindow";
import { DICEX_TRAY_KIND } from "./window-kind";

export { DICEX_TRAY_KIND };

export const trayWindowBase = {
  kind: DICEX_TRAY_KIND,
  title: "Dice tray",
  defaultSize: { w: 360, h: 300 },
  minSize: { w: 300, h: 240 },
  defaultOpen: false,
  launcher: { icon: DicesIcon, label: "Dice", order: 45 },
  companion: DiceExtrasRuntime,
  component: TrayWindow,
} satisfies Omit<WindowDef, "clients" | "defaultPosition">;
