import { describe, expect, test } from "bun:test";
import { LONG_PRESS_MS, LONG_PRESS_SLOP, LongPress, type LongPressAt } from "./long-press";

/** Timers run by hand: `advance(ms)` fires what is due. */
function fakeTimers() {
  let now = 0;
  let next = 1;
  const queue = new Map<number, { at: number; fn: () => void }>();
  return {
    set: (fn: () => void, ms: number) => {
      const id = next++;
      queue.set(id, { at: now + ms, fn });
      return id;
    },
    clear: (h: unknown) => {
      queue.delete(h as number);
    },
    advance(ms: number) {
      now += ms;
      for (const [id, q] of [...queue]) {
        if (q.at > now) continue;
        queue.delete(id);
        q.fn();
      }
    },
  };
}

function setup() {
  const timers = fakeTimers();
  const fired: LongPressAt[] = [];
  const lp = new LongPress((at) => fired.push(at), timers);
  return { timers, fired, lp };
}

describe("FR-NOTES-29 long-press on touch", () => {
  test("FR-NOTES-29 a still hold of ~500 ms opens the menu at the press point, once", () => {
    const { timers, fired, lp } = setup();
    lp.start("t1", 100, 200);
    timers.advance(LONG_PRESS_MS - 1);
    expect(fired).toEqual([]);
    timers.advance(1);
    expect(fired).toEqual([{ tokenId: "t1", x: 100, y: 200 }]);
    expect(lp.fired).toBe(true);
    timers.advance(5_000);
    expect(fired).toHaveLength(1);
    expect(lp.end()).toBe(true);
    expect(lp.fired).toBe(false);
  });

  test("FR-NOTES-29 a wobble within ~10 px keeps it; a move past that cancels it", () => {
    const { timers, fired, lp } = setup();
    lp.start("t1", 100, 200);
    lp.move(100 + LONG_PRESS_SLOP, 200 - LONG_PRESS_SLOP);
    timers.advance(LONG_PRESS_MS);
    expect(fired).toHaveLength(1);
    lp.end();

    lp.start("t1", 100, 200);
    lp.move(100, 200 + LONG_PRESS_SLOP + 1);
    timers.advance(LONG_PRESS_MS);
    expect(fired).toHaveLength(1);
    expect(lp.end()).toBe(false);
  });

  test("FR-NOTES-29 a release, a drag starting or a cancel before the time: no menu", () => {
    const { timers, fired, lp } = setup();
    lp.start("t1", 0, 0);
    timers.advance(300);
    expect(lp.end()).toBe(false);
    timers.advance(LONG_PRESS_MS);
    lp.start("t1", 0, 0);
    expect(lp.waiting).toBe(true);
    lp.cancel(); // the token drag started
    expect(lp.waiting).toBe(false);
    timers.advance(LONG_PRESS_MS);
    expect(fired).toEqual([]);
  });

  test("FR-NOTES-29 a new press restarts the timer for its own token", () => {
    const { timers, fired, lp } = setup();
    lp.start("t1", 0, 0);
    timers.advance(400);
    lp.start("t2", 50, 60);
    timers.advance(400);
    expect(fired).toEqual([]);
    timers.advance(100);
    expect(fired).toEqual([{ tokenId: "t2", x: 50, y: 60 }]);
  });
});
