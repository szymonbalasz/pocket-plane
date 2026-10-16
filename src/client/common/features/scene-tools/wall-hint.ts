// FR-SCN-38 (#202, #207 OQ-SCN-22 / -23): the player's red wall hint while dragging their token.
// Each time the previewed cell changes, the probe sends the read-only `map.checkMove` (debounced
// 50 ms, ≤ 10 / s, newest wins); the ack's wall-guard pieces (one piece of the first crossing,
// ≤ 0.5 cell either side, server-clipped) are shown until the cell changes, the drag ends, a
// snapshot arrives or the client leaves live. A stale ack (another cell, an older drag or a
// snapshot since) is dropped; a reject shows nothing (the drop's guard decides). DOM-free.
import { type Segment, WALL_GUARD } from "@shared/scene-tools/schemas";
import { CheckMoveResult } from "@shared/scenes-map/schemas";

/** FR-SCN-38: the previewed cell must hold this long before a check goes out. */
export const HINT_DEBOUNCE_MS = 50;
/** FR-SCN-38: ≤ 10 checks per second. */
export const HINT_MIN_GAP_MS = 100;

type Cell = { col: number; row: number };

/** The drag the probe follows (`pointers.drag`, FR-MAP-39). */
export interface HintDrag {
  tokenId: string;
  from: Cell;
  to: Cell;
}

export interface WallHintDeps {
  /** Sends `map.checkMove {tokenId, col, row}`; resolves with the ack payload. */
  check(tokenId: string, to: Cell): Promise<unknown>;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  /** The pieces to draw red (grid units), on every change. */
  onChange(pieces: Segment[]): void;
}

const sameCell = (a: Cell, b: Cell) => a.col === b.col && a.row === b.row;

/** The wall guard's pieces of a `map.checkMove` ack (zod at the boundary; junk → none). */
export function hintPieces(ack: unknown): Segment[] {
  const r = CheckMoveResult.safeParse(ack);
  if (!r.success) return [];
  return r.data.hints.filter((h) => h.guard === WALL_GUARD).flatMap((h) => h.segments);
}

export class WallHintProbe {
  private drag: HintDrag | null = null;
  private pieces: Segment[] = [];
  private timer: unknown = null;
  private lastSent = Number.NEGATIVE_INFINITY;
  /** Bumped by every cell change, drag end and snapshot: older acks are stale. */
  private epoch = 0;

  constructor(private readonly deps: WallHintDeps) {}

  /** The current drag (null = none); call on every `pointers.drag` change. */
  update(drag: HintDrag | null): void {
    if (!drag) {
      this.clear();
      return;
    }
    const d = this.drag;
    if (d && d.tokenId === drag.tokenId && sameCell(d.to, drag.to)) return;
    this.drag = { tokenId: drag.tokenId, from: drag.from, to: drag.to };
    this.epoch += 1;
    this.cancelTimer();
    this.show([]);
    if (sameCell(drag.from, drag.to)) return;
    const now = this.deps.now();
    const at = Math.max(now + HINT_DEBOUNCE_MS, this.lastSent + HINT_MIN_GAP_MS);
    this.timer = this.deps.setTimer(() => this.fire(), at - now);
  }

  /** Drag ended, client left live or the canvas unmounted: nothing shown, nothing pending. */
  clear(): void {
    this.drag = null;
    this.epoch += 1;
    this.cancelTimer();
    this.show([]);
  }

  /** A snapshot arrived: hints are never in a snapshot; the next cell change checks again. */
  snapshot(): void {
    this.epoch += 1;
    this.cancelTimer();
    this.show([]);
  }

  private fire(): void {
    this.timer = null;
    const d = this.drag;
    if (!d) return;
    this.lastSent = this.deps.now();
    const epoch = this.epoch;
    const to = d.to;
    this.deps.check(d.tokenId, to).then(
      (ack) => {
        if (epoch !== this.epoch || !this.drag || !sameCell(this.drag.to, to)) return;
        this.show(hintPieces(ack));
      },
      () => {},
    );
  }

  private cancelTimer(): void {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
  }

  private show(pieces: Segment[]): void {
    if (pieces.length === 0 && this.pieces.length === 0) return;
    this.pieces = pieces;
    this.deps.onChange(pieces);
  }
}
