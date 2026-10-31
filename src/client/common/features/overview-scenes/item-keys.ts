// FR-OVW-49: arrow keys on an overview. They move what a drag would: the DM's selected unlocked
// items together, a player's own miniature. An overview has no grid, so a step is a distance on screen
// and zooming in makes it finer. DOM-free for `bun test`.
import { OVW_INTENTS } from "@shared/overview-scenes/schemas";
import { toastReject } from "../scenes-map/intents";
import { type KeyStep, ownKeyTarget } from "../scenes-map/key-move";
import { TOO_MANY_ITEMS, withinGroupCap } from "./item-actions";
import { clampDelta, movedBy } from "./item-edit";
import type { OverviewItemView } from "./item-layout";
import type { ItemSend } from "./items/item-kind";
import { useOverviewEditor } from "./overview-editor";
import { ownMiniature } from "./select-tool";

/** One press, in screen px: half a miniature as first placed. */
export const ITEM_STEP_PX = 32;

/** The items the keys move, among `items` (the latest records). */
export function keyItems(
  items: readonly OverviewItemView[],
  client: "dm" | "player",
  myPlayerId: string | null,
): OverviewItemView[] {
  const { selection, keyItem } = useOverviewEditor.getState();
  if (client === "dm") {
    return selection.tokenIds.flatMap((id) => {
      const item = items.find((i) => i.id === id);
      return item && !item.locked ? [item] : [];
    });
  }
  const own = items.filter((item) => ownMiniature({ item, myPlayerId }));
  const target = ownKeyTarget(own, keyItem);
  return target ? [target] : [];
}

/** One step of `targets`; null when none moves (none there, or the position bound reached). */
export function stepItems(
  send: ItemSend,
  overviewId: string,
  targets: readonly OverviewItemView[],
  step: KeyStep,
  scale: number,
): { sent: Promise<unknown>; moved: OverviewItemView[]; by: number } | null {
  const by = ITEM_STEP_PX / scale;
  const { dx, dy } = clampDelta(targets, step.dx * by, step.dy * by);
  if (targets.length === 0 || (dx === 0 && dy === 0)) return null;
  if (!withinGroupCap(targets.length)) {
    // Rejected, so a held key stops at the one toast.
    return { sent: Promise.reject(new Error(TOO_MANY_ITEMS)), moved: [], by };
  }
  const moved = targets.map((i) => ({ ...i, ...movedBy(i, dx, dy) }));
  const moves = moved.map((i) => ({ itemId: i.id, x: i.x, y: i.y }));
  const sent = send(OVW_INTENTS.moveItems, { overviewId, moves });
  sent.catch(toastReject);
  return { sent, moved, by };
}
