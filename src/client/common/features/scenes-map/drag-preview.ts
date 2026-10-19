// Live drag preview (FR-MAP-39–40, P3). Sender: `map.drag` frames while the DM or the owner drags
// a token, ≤ 1 per 50 ms and only when it moved, the last position repeated every 1 s at rest,
// `end` after the drop's `map.moveToken` and on cancel (Esc, FR-MAP-15; not live, FR-MAP-28).
// Receiver: a per-canvas store of previews (like the laser's pointer store), so a frame re-renders
// only the previewed token's group and label. DOM-free so it runs under `bun test`.
// Sprint 4 (seams S1, one drag pipeline): this client's drag state = `DragState` (token id, start
// cell, current cell; kept in `pointers.drag`, changed only when the cell changes) + the pointer's
// x / y (`PreviewState.local`, every move, so a pointer move re-renders only the dragged token's
// label). It feeds `map.drag` (`TokenDrag`), the drag probe (`drag-probe.ts`: `map.checkMove`
// per cell) and anything derived on the client (the drag path, `drag-path.ts`). Combat trails are
// not kept here: they are stored on the token (sprint 5, FR-MAP-65–67).
import {
  DRAG_INTERVAL_MS,
  DRAG_REPEAT_MS,
  DRAG_TIMEOUT_MS,
  type DragData,
} from "@shared/scenes-map/schemas";
import { createStore, type StoreApi } from "zustand";
import type { LaserTimers } from "./laser";

export type DragTimers = LaserTimers;

const browserTimers: DragTimers = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as number),
};

interface Cell {
  col: number;
  row: number;
}

/** This client's drag (FR-MAP-39, seams S1): token, footprint, start cell, current cell. */
export interface DragState {
  tokenId: string;
  size: number;
  from: Cell;
  to: Cell;
}

/** One token drag of this client: throttled preview frames + the drop / cancel decision. */
export class TokenDrag {
  private last: { x: number; y: number } | null = null;
  private pending: { x: number; y: number } | null = null;
  private lastSend = Number.NEGATIVE_INFINITY;
  private throttle: unknown = null;
  private repeat: unknown = null;
  private cancelled = false;
  private done = false;

  constructor(
    readonly sceneId: string,
    readonly tokenId: string,
    /** Where the token was when the drag started (the snap-back cell). */
    readonly from: Cell,
    /** `sendSignal(map.drag, …)`: dropped when not live, never queued (FR-MAP-39). */
    private readonly send: (d: DragData) => void,
    private readonly timers: DragTimers = browserTimers,
  ) {}

  /** The token's drawn top-left (map `display` px, unsnapped). */
  move(x: number, y: number): void {
    if (this.done) return;
    this.pending = { x, y };
    const wait = this.lastSend + DRAG_INTERVAL_MS - this.timers.now();
    if (wait <= 0) this.flush();
    else if (this.throttle === null) {
      this.throttle = this.timers.setTimeout(() => {
        this.throttle = null;
        this.flush();
      }, wait);
    }
  }

  /** Esc (FR-MAP-15): the next `finish` snaps back and sends no intent. */
  cancel(): void {
    this.cancelled = true;
  }

  /**
   * FR-MAP-28 safety net: the drag is over without a Konva `dragend` (not live, canvas gone).
   * Stops the repeat and throttle timers and sends nothing more; the caller snaps the token back.
   */
  abort(): void {
    this.stopTimers();
    this.cancelled = true;
    this.done = true;
  }

  get isCancelled(): boolean {
    return this.cancelled;
  }

  /**
   * Konva drag end. Returns the cell to draw the token at: `drop` when it is a move (then
   * `sendMove` ran first, so the `end` frame follows the intent, FR-MAP-40), else `from`.
   */
  finish(drop: Cell, live: boolean, sendMove: (to: Cell) => void): Cell {
    this.stopTimers();
    if (this.done) return this.from;
    this.done = true;
    const moved = drop.col !== this.from.col || drop.row !== this.from.row;
    const isMove = !this.cancelled && live && moved;
    if (isMove) sendMove(drop);
    // Sent if anything was previewed, even for an unmoved drop (others may show it mid-way).
    if (this.last !== null) this.send({ sceneId: this.sceneId, tokenId: this.tokenId, end: true });
    return isMove ? drop : this.from;
  }

  private flush(): void {
    const p = this.pending;
    this.pending = null;
    if (!p || (this.last && this.last.x === p.x && this.last.y === p.y)) return;
    this.emit(p);
  }

  private emit(p: { x: number; y: number }): void {
    this.last = p;
    this.lastSend = this.timers.now();
    this.send({ sceneId: this.sceneId, tokenId: this.tokenId, x: p.x, y: p.y });
    // At rest: repeat the last position every 1 s, so receivers' 3 s timeout never fires.
    if (this.repeat !== null) this.timers.clearTimeout(this.repeat);
    this.repeat = this.timers.setTimeout(() => {
      this.repeat = null;
      if (!this.done && this.last) this.emit(this.last);
    }, DRAG_REPEAT_MS);
  }

  private stopTimers(): void {
    for (const h of [this.throttle, this.repeat]) if (h !== null) this.timers.clearTimeout(h);
    this.throttle = null;
    this.repeat = null;
  }
}

/** Who takes an Esc on the canvas: a token drag, then a box select (FR-MAP-15/32), else nobody. */
export function escapeTarget(dragging: boolean, boxing: boolean): "drag" | "box" | null {
  return dragging ? "drag" : boxing ? "box" : null;
}

// ---------- receiver (FR-MAP-40) ----------

export interface DragPreview {
  x: number;
  y: number;
  /** Receipt time of the last frame (`performance.now()`), for the 3 s timeout. */
  at: number;
}

export interface PreviewState {
  /** Others' drags: tokenId → previewed top-left. */
  previews: Record<string, DragPreview>;
  /** This client's own drag position, so the token's label can follow it (FR-MAP-42). */
  local: { tokenId: string; x: number; y: number } | null;
}

export type PreviewStore = StoreApi<PreviewState>;

export const createPreviewStore = (): PreviewStore =>
  createStore<PreviewState>()(() => ({ previews: {}, local: null }));

export interface PreviewView {
  /** The scene this canvas shows (player: active; DM: viewed). */
  sceneId: string | null;
  /** T is in this client's store, on that scene. */
  hasToken(tokenId: string): boolean;
  /** The token this client is dragging itself, if any: others' previews of it are ignored. */
  draggingId: string | null;
}

export function receiveDrag(s: PreviewStore, d: DragData, view: PreviewView, now: number): void {
  if (view.sceneId === null || d.sceneId !== view.sceneId) return;
  if ("end" in d) {
    clearPreviews(s, [d.tokenId]);
    return;
  }
  if (!view.hasToken(d.tokenId) || d.tokenId === view.draggingId) return;
  s.setState((st) => ({ previews: { ...st.previews, [d.tokenId]: { x: d.x, y: d.y, at: now } } }));
}

/** Drops the previews of `ids` (a `token` change, an own drag start), or every preview. */
export function clearPreviews(s: PreviewStore, ids?: Iterable<string>): void {
  const st = s.getState().previews;
  if (ids === undefined) {
    if (Object.keys(st).length > 0) s.setState({ previews: {} });
    return;
  }
  let next: Record<string, DragPreview> | null = null;
  for (const id of ids) {
    if (!(id in st)) continue;
    next ??= { ...st };
    delete next[id];
  }
  if (next) s.setState({ previews: next });
}

/** Drops previews with no frame for 3 s; true while any is left. */
export function prunePreviews(s: PreviewStore, now: number): boolean {
  const st = s.getState().previews;
  const stale = Object.entries(st)
    .filter(([, p]) => now - p.at >= DRAG_TIMEOUT_MS)
    .map(([id]) => id);
  clearPreviews(s, stale);
  return Object.keys(s.getState().previews).length > 0;
}

/** Token ids an event frame changes (any op): their previews drop (FR-MAP-40). */
export function tokenIdsOf(changes: readonly { type: string; id: string }[]): string[] {
  return changes.filter((c) => c.type === "token").map((c) => c.id);
}
