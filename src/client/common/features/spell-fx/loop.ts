// The FX clock's frame loop (VFX §12, FR-VFX-27, OQ-VFX-04 A): one requestAnimationFrame per
// client, FX frames capped at 30 fps, running only while something FX animates on screen and the
// tab is visible. Each frame steps the engine and redraws the `objects` layer's scene (not its
// hit graph: FX never take pointer events), timing that draw; the median over 2 s is the
// `frameMs` walkthroughs read, and a median > 33 ms while animating drops one tier. DOM-free:
// the browser hooks are injected.

/** OQ-VFX-04 A: FX frames at ≤ 30 fps. */
export const FX_FRAME_MS = 1000 / 30;
/** FR-VFX-27: a median FX frame above this, over the window, drops one tier. */
export const SLOW_FX_FRAME_MS = 33;
export const SLOW_WINDOW_MS = 2000;

/** FR-VFX-27: FX frame times over the last 2 s of animation. */
export class FrameMeter {
  private samples: { at: number; ms: number }[] = [];
  private since: number | null = null;

  push(at: number, ms: number): void {
    this.since ??= at;
    this.samples.push({ at, ms });
    while (this.samples.length > 0 && at - (this.samples[0]?.at ?? at) > SLOW_WINDOW_MS) {
      this.samples.shift();
    }
  }

  /** Median frame ms over the window, or null with no samples. */
  median(): number | null {
    if (this.samples.length === 0) return null;
    const ms = this.samples.map((s) => s.ms).sort((a, b) => a - b);
    const mid = ms.length >> 1;
    return ms.length % 2
      ? (ms[mid] as number)
      : ((ms[mid - 1] as number) + (ms[mid] as number)) / 2;
  }

  /** True once ≥ 2 s of animation were measured with a median > 33 ms; then the window restarts. */
  slow(at: number): boolean {
    if (this.since === null || at - this.since < SLOW_WINDOW_MS) return false;
    const m = this.median();
    if (m === null || m <= SLOW_FX_FRAME_MS) return false;
    this.reset();
    return true;
  }

  /** Animation stopped: the next window starts afresh (FR-VFX-27 "while animating"). */
  reset(): void {
    this.samples = [];
    this.since = null;
  }
}

export interface LoopHooks {
  raf(fn: (ts: number) => void): unknown;
  caf(h: unknown): void;
  hidden(): boolean;
  /** Steps the engine to `ts` (ms). */
  step(ts: number): void;
  /** Draws one FX frame; returns its ms. */
  draw(): number;
  /** Anything FX still animating on screen. */
  animating(): boolean;
  /** The median FX frame ms after each frame. */
  onFrame(medianMs: number | null): void;
  /** FR-VFX-27: slow frames. */
  onSlow(): void;
}

export interface FxLoop {
  /** Starts the loop if it is idle (something may animate now). */
  wake(): void;
  stop(): void;
  running(): boolean;
}

export function createFxLoop(h: LoopHooks, meter = new FrameMeter()): FxLoop {
  let handle: unknown = null;
  let last = Number.NEGATIVE_INFINITY;
  const tick = (ts: number) => {
    handle = null;
    if (h.hidden()) {
      meter.reset();
      return;
    }
    if (ts - last < FX_FRAME_MS - 1) {
      handle = h.raf(tick);
      return;
    }
    last = ts;
    h.step(ts);
    const ms = h.draw();
    meter.push(ts, ms);
    h.onFrame(meter.median());
    if (meter.slow(ts)) h.onSlow();
    if (h.animating()) handle = h.raf(tick);
    else meter.reset();
  };
  return {
    wake() {
      if (handle !== null || h.hidden()) return;
      handle = h.raf(tick);
    },
    stop() {
      if (handle !== null) h.caf(handle);
      handle = null;
      meter.reset();
    },
    running: () => handle !== null,
  };
}
