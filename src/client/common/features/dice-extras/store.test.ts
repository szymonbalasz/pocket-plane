import { describe, expect, test } from "bun:test";
import type { DiceThrow } from "@shared/dice-extras/throw";
import type { GameLogEntryView } from "@shared/dice-roll-log/schemas";
import type { ThrowPlan } from "./display";
import { createDiceExtrasStore, type DiceExtrasStore, PENDING_MS, type TrayRequest } from "./store";
import { HANDOFF_MS, REST_MS, REST_NO_POPUP_MS, SETTLE_MAX_MS } from "./timing";

/** Timers on a fake clock: `advance(ms)` fires what falls due, in time order. */
function fakeTimers() {
  const timers = new Map<number, { at: number; fn: () => void }>();
  let id = 0;
  let now = 0;
  return {
    timers,
    now: () => now,
    setTimeout(fn: () => void, ms: number) {
      timers.set(++id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (h: unknown) => void timers.delete(h as number),
    /** Fire every timer (the pending tests' "3 s pass"). */
    fire() {
      for (const [k, t] of [...timers]) {
        timers.delete(k);
        t.fn();
      }
    },
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].fn();
      }
      now = end;
    },
  };
}

const free = (expression: string): TrayRequest => ({
  kind: "free",
  expression,
  mode: "normal",
  category: "other",
});
const entry = { id: "e1", n: 1 } as GameLogEntryView;
const aThrow = (id: string) => ({ id }) as DiceThrow;

test("FR-DICEX-02 one staged request at a time: a new one replaces it; clear drops it", () => {
  const s = createDiceExtrasStore(fakeTimers());
  s.stage(free("1d6"));
  s.stage(free("1d8"));
  expect(s.api.getState().request).toEqual(free("1d8"));
  expect(s.api.getState().staged).toBe(2);
  s.clear();
  expect(s.api.getState().request).toBeNull();
});

test("FR-DICEX-09 the pending timer is 3 s", () => {
  const t = fakeTimers();
  const s = createDiceExtrasStore(t);
  s.sent(false);
  t.advance(PENDING_MS - 1);
  expect(s.api.getState().pending).toBe(true);
  t.advance(1);
  expect(s.api.getState().pending).toBe(false);
});

test("FR-DICEX-09 pending until the first own entry; a tray roll then shows the result (FR-DICEX-10)", () => {
  const t = fakeTimers();
  const s = createDiceExtrasStore(t);
  s.stage(free("1d6"));
  s.sent(true);
  expect(s.api.getState()).toMatchObject({ pending: true, rolling: true });
  s.ownRolled([entry]);
  expect(s.api.getState()).toMatchObject({ pending: false, rolling: false, result: [entry] });
  expect(t.timers.size).toBe(0);
  // A new stage leaves `result`.
  s.stage(free("1d6"));
  expect(s.api.getState().result).toBeNull();
});

test("FR-DICEX-09 a button roll is pending but never becomes the tray's result", () => {
  const s = createDiceExtrasStore(fakeTimers());
  s.sent(false);
  expect(s.api.getState()).toMatchObject({ pending: true, rolling: false });
  s.ownRolled([entry]);
  expect(s.api.getState()).toMatchObject({ pending: false, result: null });
});

test("FR-DICEX-09 no entry within 3 s → pending ends, tray back from rolling; nothing resent", () => {
  const t = fakeTimers();
  const s = createDiceExtrasStore(t);
  s.stage(free("1d6"));
  s.sent(true);
  t.fire();
  expect(s.api.getState()).toMatchObject({ pending: false, rolling: false, result: null });
  expect(s.api.getState().request).toEqual(free("1d6"));
  // A reject stops it at once.
  s.sent(true);
  s.failed();
  expect(s.api.getState()).toMatchObject({ pending: false, rolling: false });
  expect(t.timers.size).toBe(0);
});

const screen3d: ThrowPlan = { arena: "screen", draw: "3d", caption: false, handoff: true };

test("FR-DICEX-18 one throw at a time: a new throw replaces the running one", () => {
  const s = createDiceExtrasStore(fakeTimers());
  s.play(aThrow("a"), screen3d);
  const first = s.api.getState().current?.seq ?? -1;
  s.play(aThrow("b"), screen3d);
  expect(s.api.getState().current?.t.id).toBe("b");
  expect(s.api.getState().leaving?.t.id).toBe("a"); // snapped to rest, handing off
  s.done(first); // the old throw's hand-off ends: no effect on the new one
  expect(s.api.getState().leaving).toBeNull();
  expect(s.api.getState().current?.t.id).toBe("b");
  s.done(s.api.getState().current?.seq ?? -1);
  expect(s.api.getState().current).toBeNull();
});

/** The phase of the current / leaving throw at each step. */
const phases = (s: DiceExtrasStore) => ({
  current: s.api.getState().current?.phase ?? null,
  leaving: s.api.getState().leaving?.phase ?? null,
});

describe("FR-DICEX-35 timing", () => {
  test("FR-DICEX-35 timing: rest ≤ 2.5 s, hand-off at rest + 1 s, 0.4 s later the layer is clear", () => {
    const t = fakeTimers();
    const s = createDiceExtrasStore(t);
    s.play(aThrow("a"), screen3d);
    const n = s.api.getState().current?.seq ?? -1;
    t.advance(1800);
    expect(phases(s).current).toBe("moving");
    s.rested(n); // the renderer reports rest at 1.8 s
    expect(phases(s).current).toBe("rest");
    t.advance(REST_MS - 1);
    expect(phases(s).current).toBe("rest");
    t.advance(1);
    expect(phases(s).current).toBe("handoff");
    t.advance(HANDOFF_MS);
    expect(s.api.getState().current).toBeNull();
    expect(t.timers.size).toBe(0);
  });

  test("FR-DICEX-35 timing: a throw that never reports rest rests at 2.5 s (the budget)", () => {
    const t = fakeTimers();
    const s = createDiceExtrasStore(t);
    s.play(aThrow("a"), screen3d);
    t.advance(SETTLE_MAX_MS - 1);
    expect(phases(s).current).toBe("moving");
    t.advance(1);
    expect(phases(s).current).toBe("rest");
    // ≤ 3.9 s on screen in all.
    t.advance(REST_MS + HANDOFF_MS);
    expect(s.api.getState().current).toBeNull();
    expect(t.now()).toBe(3900);
  });

  test("FR-DICEX-35 timing: a second throw at 1.2 s → the first snaps to rest and hands off at once", () => {
    const t = fakeTimers();
    const s = createDiceExtrasStore(t);
    s.play(aThrow("a"), screen3d);
    t.advance(1200);
    s.play(aThrow("b"), screen3d);
    expect(phases(s)).toEqual({ current: "moving", leaving: "handoff" });
    t.advance(HANDOFF_MS);
    expect(phases(s)).toEqual({ current: "moving", leaving: null });
    expect(s.api.getState().current?.t.id).toBe("b");
  });

  test("FR-DICEX-35 timing: popups off → rest 1.5 s + fade, no hand-off", () => {
    const t = fakeTimers();
    const s = createDiceExtrasStore(t);
    s.play(aThrow("a"), { ...screen3d, handoff: false });
    s.rested(s.api.getState().current?.seq ?? -1);
    t.advance(REST_NO_POPUP_MS - 1);
    expect(phases(s).current).toBe("rest");
    t.advance(1);
    expect(phases(s).current).toBe("fading");
    t.advance(300);
    expect(s.api.getState().current).toBeNull();
  });

  test("FR-DICEX-35 flat dice rest after their 0.3 s fade-in; a lost 3D throw turns flat in the zone", () => {
    const t = fakeTimers();
    const s = createDiceExtrasStore(t);
    s.play(aThrow("a"), { ...screen3d, draw: "flat", arena: "zone" });
    t.advance(300);
    expect(phases(s).current).toBe("rest");
    s.play(aThrow("b"), screen3d);
    const n = s.api.getState().current?.seq ?? -1;
    s.flat(n);
    expect(s.api.getState().current?.plan).toMatchObject({ arena: "zone", draw: "flat" });
    t.advance(300);
    expect(phases(s).current).toBe("rest");
  });
});
