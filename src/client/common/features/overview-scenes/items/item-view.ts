// What each kind's drawing gets. A view draws relative to the item's `x, y` (`ItemNode`'s Group).
import type { OverviewItemView } from "../item-layout";

export interface ItemViewProps {
  item: OverviewItemView;
  /** The camera's scale for a hidden item (its mark keeps a screen size); else 1. */
  scale: number;
  /** FR-OVW-30: grows when a label font has loaded. */
  fontRev: number;
}
