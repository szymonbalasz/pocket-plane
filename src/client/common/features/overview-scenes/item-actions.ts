// What the menu and keys send (FR-OVW-19–23): `ovw.updateItems`, `ovw.duplicateItems`,
// `ovw.deleteItems`, `ovw.placeImage`. The server decides; each returns the intent's promise, the
// caller toasts a rejection. DOM-free for `bun test`.
import type { AssetRecord } from "@shared/assets-pipeline/schemas";
import {
  type DuplicateItemsResult,
  GROUP_ACTION_MAX,
  OVW_INTENTS,
  type PlaceItemResult,
  type StackMove,
} from "@shared/overview-scenes/schemas";
import { toast } from "sonner";
import { imagePlacement, swappedSides } from "./item-edit";
import type { OverviewItemView } from "./item-layout";
import type { ItemSend } from "./items/item-kind";
import { SELECT_TOOL_ID, useOverviewTool } from "./overview-canvas-context";
import { dispatchItemSelection, itemOf, useOverviewEditor } from "./overview-editor";

export const TOO_MANY_ITEMS = `Select at most ${GROUP_ACTION_MAX} items for this`;

/** §9: a group action takes at most 50 items; the server would refuse more. */
export function withinGroupCap(count: number): boolean {
  if (count <= GROUP_ACTION_MAX) return true;
  toast.error(TOO_MANY_ITEMS);
  return false;
}

/** The items a menu on `item` acts on: the selection if it's in it, else the item alone. */
export function menuTargets(item: OverviewItemView): OverviewItemView[] {
  const { selection, items } = useOverviewEditor.getState();
  if (!selection.tokenIds.includes(item.id)) return [item];
  return selection.tokenIds.flatMap((id) => items.find((i) => i.id === id) ?? []);
}

/** A right-click on an item outside the selection selects it, then opens its menu. */
export function openItemMenu(item: OverviewItemView, at: { x: number; y: number }): void {
  if (!useOverviewEditor.getState().selection.tokenIds.includes(item.id)) {
    dispatchItemSelection({ type: "click", id: item.id });
  }
  useOverviewEditor.setState({ menu: { itemId: item.id, at } });
}

const update = (send: ItemSend, overviewId: string, items: readonly Record<string, unknown>[]) =>
  send(OVW_INTENTS.updateItems, { overviewId, items });

/** FR-OVW-20: only the items that change; nothing changes → nothing sent. */
export async function setHidden(
  send: ItemSend,
  targets: readonly OverviewItemView[],
  hidden: boolean,
): Promise<void> {
  const change = targets.filter((i) => i.hidden !== hidden);
  const first = change[0];
  if (!first || !withinGroupCap(change.length)) return;
  await update(
    send,
    first.overviewId,
    change.map((i) => ({ itemId: i.id, hidden })),
  );
}

/** FR-OVW-16: the lock of each target. */
export async function setLocked(
  send: ItemSend,
  targets: readonly OverviewItemView[],
  locked: boolean,
): Promise<void> {
  const change = targets.filter((i) => (i.locked ?? false) !== locked);
  const first = change[0];
  if (!first || !withinGroupCap(change.length)) return;
  await update(
    send,
    first.overviewId,
    change.map((i) => ({ itemId: i.id, locked })),
  );
}

/** FR-OVW-19: To front / To back, within each item's band; the server keeps a group's order. */
export async function stack(
  send: ItemSend,
  targets: readonly OverviewItemView[],
  to: StackMove,
): Promise<void> {
  const first = targets[0];
  if (!first || !withinGroupCap(targets.length)) return;
  await update(
    send,
    first.overviewId,
    targets.map((i) => ({ itemId: i.id, stack: to })),
  );
}

/** FR-OVW-21: the copies become the selection. */
export async function duplicate(
  send: ItemSend,
  targets: readonly OverviewItemView[],
): Promise<void> {
  const first = targets[0];
  if (!first || !withinGroupCap(targets.length)) return;
  const r = (await send(OVW_INTENTS.duplicateItems, {
    overviewId: first.overviewId,
    itemIds: targets.map((i) => i.id),
  })) as DuplicateItemsResult;
  dispatchItemSelection({ type: "set", ids: r.itemIds });
}

export async function deleteNow(
  send: ItemSend,
  targets: readonly OverviewItemView[],
): Promise<void> {
  const first = targets[0];
  if (!first || !withinGroupCap(targets.length)) return;
  await send(OVW_INTENTS.deleteItems, {
    overviewId: first.overviewId,
    itemIds: targets.map((i) => i.id),
  });
}

/** FR-OVW-21: one item goes at once, as tokens; more than one asks first. */
export function askDelete(send: ItemSend, targets: readonly OverviewItemView[]): Promise<void> {
  if (targets.length > 1 && withinGroupCap(targets.length)) {
    useOverviewEditor.setState({ confirmDelete: targets.map((i) => i.id) });
    return Promise.resolve();
  }
  return targets.length === 1 ? deleteNow(send, targets) : Promise.resolve();
}

/** The confirm's OK: the items still here. */
export function confirmedDelete(send: ItemSend): Promise<void> {
  const ids = useOverviewEditor.getState().confirmDelete ?? [];
  useOverviewEditor.setState({ confirmDelete: null });
  return deleteNow(
    send,
    ids.flatMap((id) => itemOf(id) ?? []),
  );
}

/** FR-OVW-22: the new image lands, is selected, and the rail is back on Select. */
export async function placeImageFrom(
  send: ItemSend,
  overviewId: string,
  asset: Pick<AssetRecord, "id" | "displayWidth" | "displayHeight">,
  hidden: boolean,
): Promise<void> {
  const { items, view } = useOverviewEditor.getState();
  const empty = items.length === 0;
  if (empty) useOverviewEditor.setState({ fitOnArrival: overviewId });
  try {
    const r = (await send(OVW_INTENTS.placeImage, {
      overviewId,
      assetId: asset.id,
      ...imagePlacement(asset, view, empty),
      ...(hidden ? { hidden } : {}),
    })) as PlaceItemResult;
    dispatchItemSelection({ type: "set", ids: [r.itemId] });
    useOverviewTool.getState().setTool(SELECT_TOOL_ID);
  } catch (err) {
    useOverviewEditor.setState({ fitOnArrival: null });
    throw err;
  }
}

/** FR-OVW-23 Image…: keeps the width, takes the new shape. */
export function swapImage(
  send: ItemSend,
  item: OverviewItemView,
  asset: Pick<AssetRecord, "id" | "displayWidth" | "displayHeight">,
): Promise<unknown> {
  const sides = swappedSides(item.w ?? asset.displayWidth, asset);
  return update(send, item.overviewId, [{ itemId: item.id, assetId: asset.id, ...sides }]);
}
