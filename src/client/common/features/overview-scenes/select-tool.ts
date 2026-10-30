// The Select tool's pointer rules on an overview (FR-OVW-16, -18, -21, -23; FR-OVW-47), generic over
// kind. DM only: on a player's client a press only pans. A plain press on an unlocked item moves the
// selection; on a selected item's corner it resizes; on empty canvas or a locked item it pans, so a
// locked map stays out of the way. A Ctrl- or Shift-press is a click toggle or a box, wherever it
// starts: on a locked map there is no empty canvas to start one on. A drop sends one intent; the
// preview stays until its ack, a reject snaps back and toasts. While not live selection still works.
import { OVW_INTENTS } from "@shared/overview-scenes/schemas";
import { toastReject } from "../scenes-map/intents";
import { isClick } from "../scenes-map/selection-logic";
import { openItemMenu, withinGroupCap } from "./item-actions";
import {
  clampDelta,
  handleAt,
  itemsInBox,
  movedBy,
  resizeKeepingShape,
  sideBox,
} from "./item-edit";
import type { OverviewItemView } from "./item-layout";
import { ITEM_KIND_DEFS } from "./items/kinds";
import { measureText } from "./label-fonts";
import {
  dispatchItemSelection,
  type ItemGesture,
  selectedItems,
  useOverviewEditor,
} from "./overview-editor";
import type { OverviewPointer, OverviewPointerHandlers } from "./overview-tools";

/** A corner handle's grab reach, in screen px. */
export const HANDLE_REACH_PX = 8;

const HANDLE_CURSOR = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
};

/** The one selected item with handles; a group or a locked item has none (FR-OVW-16, -23). */
export function resizable(): OverviewItemView | null {
  const sel = selectedItems();
  const item = sel.length === 1 ? sel[0] : undefined;
  return item && !item.locked && ITEM_KIND_DEFS[item.kind].resize ? item : null;
}

const handleUnder = (item: OverviewItemView, e: OverviewPointer) =>
  handleAt(sideBox(item), e.x, e.y, HANDLE_REACH_PX / e.scale);

const setGesture = (gesture: ItemGesture | null) => useOverviewEditor.setState({ gesture });

const sending = (g: ItemGesture | null) =>
  (g?.kind === "move" || g?.kind === "resize") && g.sending;

/** The preview stays until the intent settles; a reject shows the record again and toasts. */
function settle(sent: Promise<unknown>, g: ItemGesture) {
  const done = () => {
    if (useOverviewEditor.getState().gesture === g) setGesture(null);
  };
  sent.then(done, (err) => {
    done();
    toastReject(err);
  });
}

function pressItem(e: OverviewPointer, item: OverviewItemView) {
  e.holdPan();
  const { selection, items } = useOverviewEditor.getState();
  if (!selection.tokenIds.includes(item.id)) dispatchItemSelection({ type: "click", id: item.id });
  const ids = useOverviewEditor.getState().selection.tokenIds;
  // FR-OVW-18: every selected unlocked item, whichever of them was pressed.
  setGesture({
    kind: "move",
    anchorId: item.id,
    ids: ids.filter((id) => !items.find((i) => i.id === id)?.locked),
    screen: e.screen,
    start: { x: e.x, y: e.y },
    dx: 0,
    dy: 0,
    moved: false,
    sending: false,
  });
}

function dragMoves(g: Extract<ItemGesture, { kind: "move" }>, e: OverviewPointer) {
  const items = useOverviewEditor.getState().items.filter((i) => g.ids.includes(i.id));
  return { items, ...clampDelta(items, e.x - g.start.x, e.y - g.start.y) };
}

function resizedTo(g: Extract<ItemGesture, { kind: "resize" }>, e: OverviewPointer) {
  const item = useOverviewEditor.getState().items.find((i) => i.id === g.itemId);
  const bounds = item && ITEM_KIND_DEFS[item.kind].resize;
  return bounds ? resizeKeepingShape(g.from, g.handle, e, bounds) : null;
}

export const selectPointer: OverviewPointerHandlers = {
  down(e) {
    if (e.client !== "dm" || sending(useOverviewEditor.getState().gesture)) return;
    useOverviewEditor.setState({ menu: null });
    const modifier = e.ctrl || e.shift;
    const sole = resizable();
    const handle = sole && e.live && !modifier ? handleUnder(sole, e) : null;
    if (sole && handle) {
      e.holdPan();
      const from = sideBox(sole);
      setGesture({ kind: "resize", itemId: sole.id, handle, from, box: from, sending: false });
      return;
    }
    const { item } = e;
    if (modifier) {
      e.holdPan();
      const start = { x: e.x, y: e.y };
      setGesture({ kind: "box", itemId: item?.id ?? null, screen: e.screen, start, at: start });
      return;
    }
    const onDouble = item && e.clicks === 2 ? ITEM_KIND_DEFS[item.kind].doubleClick : undefined;
    if (item && onDouble) {
      setGesture(null);
      onDouble(item);
      return;
    }
    if (item && !item.locked && e.live) {
      pressItem(e, item);
      return;
    }
    setGesture({ kind: "press", itemId: item?.id ?? null, screen: e.screen });
  },

  move(e) {
    if (e.client !== "dm") return;
    const { gesture: g, cursor } = useOverviewEditor.getState();
    if (!g) {
      const sole = e.live ? resizable() : null;
      const handle = sole && handleUnder(sole, e);
      const next = handle ? HANDLE_CURSOR[handle] : null;
      if (next !== cursor) useOverviewEditor.setState({ cursor: next });
      return;
    }
    if (g.kind === "box") {
      setGesture({ ...g, at: { x: e.x, y: e.y } });
    } else if (g.kind === "move" && !g.sending) {
      if (!g.moved && isClick(e.screen.x - g.screen.x, e.screen.y - g.screen.y)) return;
      const { dx, dy } = dragMoves(g, e);
      setGesture({ ...g, dx, dy, moved: true });
    } else if (g.kind === "resize" && !g.sending) {
      const box = resizedTo(g, e);
      if (box) setGesture({ ...g, box });
    }
  },

  up(e) {
    const g = useOverviewEditor.getState().gesture;
    if (!g || sending(g)) return;
    if (g.kind === "press") {
      setGesture(null);
      if (isClick(e.screen.x - g.screen.x, e.screen.y - g.screen.y)) {
        dispatchItemSelection(g.itemId ? { type: "click", id: g.itemId } : { type: "clear" });
      }
      return;
    }
    if (g.kind === "box") {
      setGesture(null);
      if (isClick(e.screen.x - g.screen.x, e.screen.y - g.screen.y)) {
        if (g.itemId) dispatchItemSelection({ type: "toggle", id: g.itemId });
        return;
      }
      const box = { x0: g.start.x, y0: g.start.y, x1: e.x, y1: e.y };
      const { items } = useOverviewEditor.getState();
      dispatchItemSelection({ type: "add", ids: itemsInBox(items, measureText, box) });
      return;
    }
    if (g.kind === "move") {
      if (!g.moved) {
        setGesture(null);
        dispatchItemSelection({ type: "click", id: g.anchorId });
        return;
      }
      const { items, dx, dy } = dragMoves(g, e);
      // FR-OVW-47: dropped while not live → it snaps back, unsent.
      if (!e.live || items.length === 0 || !withinGroupCap(items.length)) {
        setGesture(null);
        return;
      }
      const held = { ...g, dx, dy, sending: true };
      setGesture(held);
      const moves = items.map((i) => ({ itemId: i.id, ...movedBy(i, dx, dy) }));
      settle(e.intent(OVW_INTENTS.moveItems, { overviewId: e.overviewId, moves }), held);
      return;
    }
    const box = resizedTo(g, e) ?? g.from;
    const same = box.x === g.from.x && box.y === g.from.y && box.w === g.from.w;
    if (same || !e.live) {
      setGesture(null);
      return;
    }
    const held = { ...g, box, sending: true };
    setGesture(held);
    settle(
      e.intent(OVW_INTENTS.updateItems, {
        overviewId: e.overviewId,
        items: [{ itemId: g.itemId, ...box }],
      }),
      held,
    );
  },

  /** A gesture is dropped (Esc stops there); one on its way to the server waits for its answer. */
  cancel(reason) {
    const { gesture: g, cursor } = useOverviewEditor.getState();
    if (cursor) useOverviewEditor.setState({ cursor: null });
    if (!g || (sending(g) && reason !== "live")) return false;
    setGesture(null);
    return reason === "escape" && g.kind !== "press";
  },

  /** FR-OVW-16: a locked item's menu opens too. A right-drag stays the laser (FR-MAP-71). */
  menu(e) {
    const { item } = e;
    if (e.client !== "dm" || !item) return false;
    return () => openItemMenu(item, e.screen);
  },
};
