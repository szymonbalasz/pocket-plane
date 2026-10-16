import { expect, test } from "bun:test";
import type { DiceThrow } from "@shared/dice-extras/throw";
import type { GameLogEntryView } from "@shared/dice-roll-log/schemas";
import { createDiceExtrasStore, PENDING_MS, type TrayRequest } from "./store";

function fakeTimers() {
  const timers = new Map<number, () => void>();
  let id = 0;
  return {
    timers,
    setTimeout(fn: () => void, ms: number) {
      expect(ms).toBe(PENDING_MS);
      timers.set(++id, fn);
      return id;
    },
    clearTimeout: (h: unknown) => void timers.delete(h as number),
    fire() {
      for (const [k, fn] of [...timers]) {
        timers.delete(k);
        fn();
      }
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

test("FR-DICEX-18 one throw at a time: a new throw replaces the running one", () => {
  const s = createDiceExtrasStore(fakeTimers());
  s.play(aThrow("a"));
  const first = s.api.getState().current?.seq ?? -1;
  s.play(aThrow("b"));
  expect(s.api.getState().current?.t.id).toBe("b");
  s.done(first); // the old throw's fade ends: no effect on the new one
  expect(s.api.getState().current?.t.id).toBe("b");
  s.done(s.api.getState().current?.seq ?? -1);
  expect(s.api.getState().current).toBeNull();
});
