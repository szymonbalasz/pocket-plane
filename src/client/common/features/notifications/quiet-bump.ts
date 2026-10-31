// FR-NOTE-86: one bump once a burst of pokes held still (FR-NOTE-77's stillness): a scrolling window
// body re-places the stack once, after the scroll, never frame by frame. Pure over the timers.

export interface QuietBump {
  /** Another event of the burst: the wait starts over. */
  poke(): void;
  /** A burst is under way. */
  busy(): boolean;
  stop(): void;
}

export function quietBump(
  ms: number,
  bump: () => void,
  timers: {
    set(fn: () => void, ms: number): unknown;
    clear(handle: unknown): void;
  } = {
    set: (fn, wait) => setTimeout(fn, wait),
    clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  },
): QuietBump {
  let handle: unknown;
  let waiting = false;
  const stop = () => {
    if (waiting) timers.clear(handle);
    waiting = false;
  };
  return {
    poke() {
      stop();
      waiting = true;
      handle = timers.set(() => {
        waiting = false;
        bump();
      }, ms);
    },
    busy: () => waiting,
    stop,
  };
}
