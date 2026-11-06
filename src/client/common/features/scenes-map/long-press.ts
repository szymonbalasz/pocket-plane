// FR-NOTES-29 / FR-MAP-18: a long-press on a token (touch pointers) opens its token menu, for the DM
// and players alike. iOS Safari never fires `contextmenu`, so the canvas times the hold itself:
// ~500 ms held still opens the menu; a move past ~10 px, a drag starting or the release first
// cancels it. DOM-free (timers injected) so it runs under `bun test`.

export const LONG_PRESS_MS = 500;
/** Screen px the finger may wander before the press stops being a long-press. */
export const LONG_PRESS_SLOP = 10;

export interface LongPressAt {
  tokenId: string;
  x: number;
  y: number;
}

export interface LongPressTimers {
  set(fn: () => void, ms: number): unknown;
  clear(h: unknown): void;
}

const realTimers: LongPressTimers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export class LongPress {
  private pending: (LongPressAt & { h: unknown }) | null = null;
  /** The current press opened the menu (until `end`). */
  fired = false;

  constructor(
    private readonly fire: (at: LongPressAt) => void,
    private readonly timers: LongPressTimers = realTimers,
  ) {}

  /** A touch press on a token with a menu. */
  start(tokenId: string, x: number, y: number): void {
    this.cancel();
    this.fired = false;
    const h = this.timers.set(() => {
      const p = this.pending;
      this.pending = null;
      if (!p) return;
      this.fired = true;
      this.fire({ tokenId: p.tokenId, x: p.x, y: p.y });
    }, LONG_PRESS_MS);
    this.pending = { tokenId, x, y, h };
  }

  /** The finger moved: past the slop it is a drag or a pan, not a long-press. */
  move(x: number, y: number): void {
    const p = this.pending;
    if (p && Math.max(Math.abs(x - p.x), Math.abs(y - p.y)) > LONG_PRESS_SLOP) this.cancel();
  }

  /** A drag started, the pointer was cancelled, or the canvas went offline. */
  cancel(): void {
    if (this.pending) this.timers.clear(this.pending.h);
    this.pending = null;
  }

  /** The release; true when this press opened the menu. */
  end(): boolean {
    this.cancel();
    const fired = this.fired;
    this.fired = false;
    return fired;
  }

  get waiting(): boolean {
    return this.pending !== null;
  }
}
