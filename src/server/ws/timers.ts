// Injectable timers (FR-SYNC-26).
export type TimerHandle = { readonly __timer: unique symbol } | number | object;

export interface Timers {
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(h: TimerHandle): void;
  setInterval(fn: () => void, ms: number): TimerHandle;
  clearInterval(h: TimerHandle): void;
}

export const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
};

/** Fake timers driven by a manual clock: `advance(ms)` runs everything due, in order. */
export function fakeTimers(clock: { now(): number; set(ms: number): void }) {
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void; every: number | null }>();
  const timers: Timers & { advance(ms: number): void; count(): number } = {
    setTimeout(fn, ms) {
      const id = nextId++;
      pending.set(id, { at: clock.now() + ms, fn, every: null });
      return id;
    },
    clearTimeout(h) {
      pending.delete(h as number);
    },
    setInterval(fn, ms) {
      const id = nextId++;
      pending.set(id, { at: clock.now() + ms, fn, every: ms });
      return id;
    },
    clearInterval(h) {
      pending.delete(h as number);
    },
    advance(ms) {
      const end = clock.now() + ms;
      for (;;) {
        let best: [number, { at: number; fn: () => void; every: number | null }] | null = null;
        for (const e of pending) if (e[1].at <= end && (!best || e[1].at < best[1].at)) best = e;
        if (!best) break;
        const [id, t] = best;
        clock.set(t.at);
        if (t.every === null) pending.delete(id);
        else t.at += t.every;
        t.fn();
      }
      clock.set(end);
    },
    count: () => pending.size,
  };
  return timers;
}
