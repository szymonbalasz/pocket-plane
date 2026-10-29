// Top-bar item registry (FR-SHELL-112 (3), seams S2). APPEND-ONLY (AGENTS §9.9): a feature adds one
// entry to `TOP_BAR_ITEMS`; nothing else changes here. Items render in `order`, at a fixed width
// (or one per viewport), before the identity chip; the top bar stays 48 px (FR-SHELL-70). The
// Pause control is a 40-px icon button at every width, its label in the Tooltip (K10). The
// launcher-fit rule (FR-SHELL-43) keeps the bar's other content fitting at 1280 wide.
import type { ComponentType } from "react";
import { VIEW_AS_TOP_W, ViewAsTopBarItem } from "../fog-of-war/ViewAsSelect";
import { pauseSlotWidth } from "../pause/logic";
import { PauseTopBarItem } from "../pause/top-bar";
import type { Viewport } from "./geometry";
import { PALETTE_BUTTON_W, PaletteTopBarButton } from "./palette/TopBarButton";
import type { ShellClient } from "./registry";

export interface TopBarItem {
  id: string;
  clients: readonly ShellClient[];
  /** Fixed width, px, or one per viewport: the bar never reflows around an item otherwise. */
  width: number | ((viewport: Viewport) => number);
  /** Ascending, left to right. */
  order: number;
  Component: ComponentType;
}

/** The top-bar items (append yours: TT4's Pause control, after WF1). */
export const TOP_BAR_ITEMS: readonly TopBarItem[] = [
  // TT4 (FR-SHELL-129): the DM's Pause control.
  { id: "pause", clients: ["dm"], width: pauseSlotWidth, order: 10, Component: PauseTopBarItem },
  // #383 (FR-FOG-60): the DM's View as, a copy of the fog bar's, right of Pause.
  { id: "view-as", clients: ["dm"], width: VIEW_AS_TOP_W, order: 20, Component: ViewAsTopBarItem },
  // SP1 (FR-SHELL-195): the palette's search button, next to the identity chip.
  {
    id: "palette",
    clients: ["dm", "player"],
    width: PALETTE_BUTTON_W,
    order: 90,
    Component: PaletteTopBarButton,
  },
];

/** An item's width at `viewport`, px. */
export const topBarItemWidth = (t: Pick<TopBarItem, "width">, viewport: Viewport): number =>
  typeof t.width === "function" ? t.width(viewport) : t.width;

/** This client's items, left to right. */
export function topBarItemsFor(
  client: ShellClient,
  list: readonly TopBarItem[] = TOP_BAR_ITEMS,
): TopBarItem[] {
  return list.filter((t) => t.clients.includes(client)).sort((a, b) => a.order - b.order);
}
