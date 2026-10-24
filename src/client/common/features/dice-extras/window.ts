// `dicex.tray` window geometry (FR-DICEX-01; protocol §18 / §24): default closed (map-first,
// #162), 450×375 (DM #347: 360×300 × 1.25; was 504×420, DM #343), useful 360×300, min 300×240,
// launcher "Dice" after "Log". Each client registers its own def
// (left edge, above its `dice.log`). The companion runs throws whether the tray is open or not.
// The tray body loads on first open (FR-DICEX-22 initial budget), like `LazyMapCanvas`.
import { DicesIcon } from "lucide-react";
import { createElement, Suspense } from "react";
import { lazyChunk } from "../../lib/lazy-chunk";
import type { WindowDef } from "../play-shell/registry";
import { DiceExtrasRuntime } from "./ThrowLayer";
import { DICEX_TRAY_KIND } from "./window-kind";

const TrayBody = lazyChunk(
  () => import("./TrayWindow").then((m) => ({ default: m.TrayWindow })),
  "window",
);

function LazyTrayWindow() {
  return createElement(Suspense, { fallback: null }, createElement(TrayBody));
}

export { DICEX_TRAY_KIND };

export const trayWindowBase = {
  kind: DICEX_TRAY_KIND,
  title: "Dice tray",
  // FR-DICEX-96 (DM #343, #347): 25 % bigger so the dice read clearly; the dice scale with it
  // (`trayScale`). A stored tray still at an old default (360×300, T1's 504×420) moves to this
  // one (FR-SHELL-53); a remembered one keeps its size.
  defaultSize: { w: 450, h: 375 },
  previousDefaults: [
    { w: 360, h: 300 },
    { w: 504, h: 420 },
  ],
  usefulSize: { w: 360, h: 300 },
  minSize: { w: 300, h: 240 },
  defaultOpen: false,
  launcher: { icon: DicesIcon, label: "Dice", order: 45 },
  companion: DiceExtrasRuntime,
  component: LazyTrayWindow,
} satisfies Omit<WindowDef, "clients" | "defaultPosition">;
