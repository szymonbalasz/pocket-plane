// The drag probe (FR-MAP-39 sprint 4, seams S1; moved here from scene-tools' `wall-hint.ts`): one
// per canvas, fed by this client's drag state (`drag-preview.ts`). Each time the previewed cell
// changes it sends the read-only `map.checkMove {tokenId, col, row}`: debounced 50 ms, ≤ 10 / s,
// **one in flight**, newest cell wins, stale acks dropped. Sent by a player for their own token
// (FR-SCN-38) and by the DM for a token with an owner (FR-FOG-53: the owner's sight follows the
// DM's drag); the host decides per drag (`start(…, probes)`). The ack's hints go to subscribers:
// scene-tools' wall pieces (FR-SCN-38) and fog's `fog-sight` (FR-FOG-54), each keeping its own
// lifetime rules. `recheck()` re-sends for the current cell (a `vision` change mid-drag,
// FR-FOG-54). Nothing is sent while not dragging; a reject is ignored (the drop decides). DOM-free.
import {
  type CheckMoveResult,
  CheckMoveResult as CheckMoveSchema,
} from "@shared/scenes-map/schemas";

/** FR-SCN-38 / FR-MAP-39: the previewed cell must hold this long before a check goes out. */
export const PROBE_DEBOUNCE_MS = 50;
/** ≤ 10 checks per second. */
export const PROBE_MIN_GAP_MS = 100;

type Cell = { col: number; row: number };

/** The drag the probe follows. */
export interface ProbeDrag {
  tokenId: string;
  from: Cell;
  to: Cell;
}

/** A subscriber (wall hint, sight preview); every member optional. */
export interface ProbeListener {
  /** The previewed cell changed (the old cell's hints are stale). */
  cell?(drag: ProbeDrag): void;
  /** A fresh ack for the current cell (zod-parsed; junk is dropped). */
  ack?(drag: ProbeDrag, result: CheckMoveResult): void;
  /** The drag is over; `settled` resolves once the drop's intent answered (at once otherwise). */
  done?(tokenId: string, settled: Promise<void>): void;
  /** A snapshot, leaving live or unmount: drop everything now. */
  reset?(): void;
}

export interface ProbeDeps {
  /** Sends `map.checkMove {tokenId, col, row}`; resolves with the ack payload. */
  check(tokenId: string, to: Cell): Promise<unknown>;
  now(): number;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

const sameCell = (a: Cell, b: Cell) => a.col === b.col && a.row === b.row;

export class DragProbe {
  private listeners = new Set<ProbeListener>();
  private drag: ProbeDrag | null = null;
  private probes = false;
  private timer: unknown = null;
  private lastSent = Number.NEGATIVE_INFINITY;
  private inFlight = false;
  /** The current cell still needs a check. */
  private dirty = false;
  /** Bumped by every drag start / end, snapshot and clear: acks of an older drag are stale. */
  private epoch = 0;

  constructor(private readonly deps: ProbeDeps) {}

  subscribe(l: ProbeListener): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  /** The drag in progress, if any. */
  current(): ProbeDrag | null {
    return this.drag;
  }

  /** A drag starts at `from`; `probes` = this client checks its cells (FR-MAP-39). */
  start(tokenId: string, from: Cell, probes: boolean): void {
    this.reset(false);
    this.drag = { tokenId, from, to: from };
    this.probes = probes;
  }

  /** The previewed cell (every `pointers.drag` change). */
  move(to: Cell): void {
    const d = this.drag;
    if (!d || sameCell(d.to, to)) return;
    this.drag = { ...d, to };
    for (const l of this.listeners) l.cell?.(this.drag);
    this.want();
  }

  /** FR-FOG-54: a `vision` change mid-drag re-sends for the current cell. */
  recheck(): void {
    if (this.drag) this.want();
  }

  /** Drag end (drop or cancel); `settled` = the drop's `map.moveToken` (none → at once). */
  finish(settled: Promise<unknown> = Promise.resolve()): void {
    const d = this.drag;
    this.reset(false);
    if (!d) return;
    const done = settled.then(
      () => {},
      () => {},
    );
    for (const l of this.listeners) l.done?.(d.tokenId, done);
  }

  /** A snapshot arrived: hints are never in a snapshot; the next cell change checks again. */
  snapshot(): void {
    const d = this.drag;
    this.reset(true);
    this.drag = d;
  }

  /** Not live, scene switch or unmount: no drag, nothing pending, subscribers reset. */
  clear(): void {
    this.reset(true);
  }

  private reset(notify: boolean): void {
    this.drag = null;
    this.dirty = false;
    this.epoch += 1;
    this.cancelTimer();
    if (notify) for (const l of this.listeners) l.reset?.();
  }

  private want(): void {
    if (!this.probes) return;
    this.dirty = true;
    this.cancelTimer();
    if (this.inFlight) return; // the ack schedules the newest cell
    const now = this.deps.now();
    const at = Math.max(now + PROBE_DEBOUNCE_MS, this.lastSent + PROBE_MIN_GAP_MS);
    this.timer = this.deps.setTimer(() => this.fire(), at - now);
  }

  private fire(): void {
    this.timer = null;
    const d = this.drag;
    if (!d || !this.dirty || this.inFlight) return;
    this.dirty = false;
    this.inFlight = true;
    this.lastSent = this.deps.now();
    const epoch = this.epoch;
    const sent = d.to;
    const settle = (ack: unknown) => {
      this.inFlight = false;
      const cur = this.drag;
      if (epoch === this.epoch && cur && sameCell(cur.to, sent) && ack !== undefined) {
        const r = CheckMoveSchema.safeParse(ack);
        if (r.success) for (const l of this.listeners) l.ack?.(cur, r.data);
      }
      if (this.dirty && this.drag) {
        this.dirty = false;
        this.want();
      }
    };
    this.deps.check(d.tokenId, sent).then(settle, () => settle(undefined));
  }

  private cancelTimer(): void {
    if (this.timer !== null) this.deps.clearTimer(this.timer);
    this.timer = null;
  }
}

/** FR-MAP-39: a player probes their own drags (they may only drag those); the DM owned tokens. */
export const probesDrag = (client: "dm" | "player", t: { ownerPlayerId: string | null }) =>
  client === "player" || t.ownerPlayerId !== null;
