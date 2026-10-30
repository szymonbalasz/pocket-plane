// Live item drag preview (FR-OVW-37), as the map's (FR-MAP-39, -40), for a group and for every kind.
// Sender: `ovw.drag` frames, ≤ 1 per 50 ms and only when it moved, the last position repeated every
// 1 s at rest, `end` after the drop's `ovw.moveItems` and on cancel. Receiver: one store of previews
// outside the items' records, so a frame re-renders only the previewed items. It drops on `end`, on
// an event changing the item, on a snapshot and after 3 s without a frame (a dropped sender). There
// is one overview canvas at a time, so one store, like the editor's. DOM-free for `bun test`.
import type { ItemDragData } from "@shared/overview-scenes/schemas";
import { OVERVIEW_ITEM_TYPE } from "@shared/overview-scenes/schemas";
import { DRAG_INTERVAL_MS, DRAG_REPEAT_MS } from "@shared/scenes-map/schemas";
import { clearPreviews, createPreviewStore, type DragTimers } from "../scenes-map/drag-preview";

export type ItemMove = { itemId: string; x: number; y: number };

const browserTimers: DragTimers = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as number),
};

/** One drag's preview frames. `send` drops them when not live, never queues (FR-MAP-39). */
export class ItemDragSender {
  private last: readonly ItemMove[] | null = null;
  private pending: readonly ItemMove[] | null = null;
  private lastSend = Number.NEGATIVE_INFINITY;
  private throttle: unknown = null;
  private repeat: unknown = null;
  private done = false;

  constructor(
    readonly overviewId: string,
    private readonly send: (d: ItemDragData) => void,
    private readonly timers: DragTimers = browserTimers,
  ) {}

  /** Where each dragged item is drawn; they move together, so one tells whether any moved. */
  move(moves: readonly ItemMove[]): void {
    if (this.done || moves.length === 0) return;
    this.pending = moves;
    const wait = this.lastSend + DRAG_INTERVAL_MS - this.timers.now();
    if (wait <= 0) this.flush();
    else if (this.throttle === null) {
      this.throttle = this.timers.setTimeout(() => {
        this.throttle = null;
        this.flush();
      }, wait);
    }
  }

  /** Drop (after the intent, so the `end` follows it) or cancel: `end` if anything was previewed. */
  finish(): void {
    if (this.done) return;
    this.done = true;
    for (const h of [this.throttle, this.repeat]) if (h !== null) this.timers.clearTimeout(h);
    if (this.last) {
      this.send({
        overviewId: this.overviewId,
        itemIds: this.last.map((m) => m.itemId),
        end: true,
      });
    }
  }

  private flush(): void {
    const p = this.pending;
    this.pending = null;
    const [a] = p ?? [];
    const [b] = this.last ?? [];
    if (!p || (a && b && a.x === b.x && a.y === b.y)) return;
    this.emit(p);
  }

  private emit(moves: readonly ItemMove[]): void {
    this.last = moves;
    this.lastSend = this.timers.now();
    this.send({ overviewId: this.overviewId, moves: [...moves] });
    // At rest: repeat the last position every 1 s, so receivers' 3 s timeout never fires.
    if (this.repeat !== null) this.timers.clearTimeout(this.repeat);
    this.repeat = this.timers.setTimeout(() => {
      this.repeat = null;
      if (!this.done && this.last) this.emit(this.last);
    }, DRAG_REPEAT_MS);
  }
}

// ---------- receiver ----------

/** Others' drags: itemId → where it's drawn until the record catches up. */
export const itemPreviews = createPreviewStore();

export interface ItemDragView {
  overviewId: string;
  /** The item is in this client's store (a player holds no hidden item). */
  holds(itemId: string): boolean;
  /** What this client is dragging itself: others' previews of it are ignored. */
  dragging: readonly string[];
}

export function receiveItemDrag(d: ItemDragData, view: ItemDragView, now: number): void {
  if (d.overviewId !== view.overviewId) return;
  if ("end" in d) {
    clearPreviews(itemPreviews, d.itemIds);
    return;
  }
  const taken = d.moves.filter((m) => view.holds(m.itemId) && !view.dragging.includes(m.itemId));
  if (taken.length === 0) return;
  itemPreviews.setState((st) => {
    const previews = { ...st.previews };
    for (const m of taken) previews[m.itemId] = { x: m.x, y: m.y, at: now };
    return { previews };
  });
}

/** Item IDs an event frame changes (any op): their previews drop (FR-MAP-40). */
export const itemIdsOf = (changes: readonly { type: string; id: string }[]): string[] =>
  changes.filter((c) => c.type === OVERVIEW_ITEM_TYPE).map((c) => c.id);
