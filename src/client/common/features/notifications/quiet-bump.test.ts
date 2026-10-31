import { describe, expect, test } from "bun:test";
import { quietBump } from "./quiet-bump";

/** Hand-run timers: `run()` fires what is pending. */
function fakeTimers() {
  let next: (() => void) | null = null;
  return {
    timers: {
      set: (fn: () => void) => {
        next = fn;
        return fn;
      },
      clear: () => {
        next = null;
      },
    },
    run() {
      const fn = next;
      next = null;
      fn?.();
    },
  };
}

describe("FR-NOTE-86 one re-read once a scroll held still", () => {
  test("FR-NOTE-86 a burst of scroll events: no bump while it lasts, one after it", () => {
    const t = fakeTimers();
    let bumps = 0;
    const q = quietBump(250, () => bumps++, t.timers);
    for (let i = 0; i < 20; i++) q.poke();
    expect(q.busy()).toBe(true);
    expect(bumps).toBe(0);
    t.run();
    expect(bumps).toBe(1);
    expect(q.busy()).toBe(false);
    t.run();
    expect(bumps).toBe(1);
  });

  test("FR-NOTE-86 a second scroll bumps again; stop drops a pending bump", () => {
    const t = fakeTimers();
    let bumps = 0;
    const q = quietBump(250, () => bumps++, t.timers);
    q.poke();
    t.run();
    q.poke();
    t.run();
    expect(bumps).toBe(2);
    q.poke();
    q.stop();
    t.run();
    expect(bumps).toBe(2);
    expect(q.busy()).toBe(false);
  });
});
