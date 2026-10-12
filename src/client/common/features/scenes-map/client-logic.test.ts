import { describe, expect, test } from "bun:test";
import { emptyStore } from "@shared/protocol/store";
import { LaserSender, type LaserTimers } from "./laser";
import { LAYER_ORDER, orderLayers } from "./layers";
import {
  clearOverlay,
  emptyOverlay,
  isSnapshotStore,
  settleMove,
  shownCell,
  signalForShownScene,
  startMove,
} from "./overlay";

const mira = { id: "mira", col: 5, row: 5 };

describe("scenes-map client logic", () => {
  test("FR-MAP-15 overlay: ack keeps the server position underneath", () => {
    const { overlay, key } = startMove(emptyOverlay, "mira", 8, 5);
    expect(shownCell(overlay, mira)).toEqual({ id: "mira", col: 8, row: 5 });
    // The event updates the record; the ack clears the overlay; the record shows.
    const after = settleMove(overlay, "mira", key);
    expect(shownCell(after, { ...mira, col: 8 })).toEqual({ id: "mira", col: 8, row: 5 });
    expect(after.size).toBe(0);
  });

  test("FR-MAP-15 overlay: reject reverts to the record", () => {
    const { overlay, key } = startMove(emptyOverlay, "mira", 8, 5);
    expect(shownCell(settleMove(overlay, "mira", key), mira)).toEqual(mira);
  });

  test("FR-MAP-15 overlay: a newer move survives the older ack; snapshot drops all", () => {
    const first = startMove(emptyOverlay, "mira", 8, 5);
    const second = startMove(first.overlay, "mira", 9, 5);
    const settled = settleMove(second.overlay, "mira", first.key);
    expect(shownCell(settled, mira).col).toBe(9);
    expect(clearOverlay().size).toBe(0);
    const s0 = emptyStore();
    expect(isSnapshotStore(null, s0)).toBe(true);
    expect(isSnapshotStore(s0, s0)).toBe(false);
    expect(isSnapshotStore(s0, { ...s0, seq: 1 })).toBe(false);
    expect(isSnapshotStore({ ...s0, seq: 4 }, emptyStore())).toBe(true);
  });

  test("FR-MAP-25 receivers draw only signals for the scene they show", () => {
    expect(signalForShownScene({ sceneId: "a" }, "a")).toBe(true);
    expect(signalForShownScene({ sceneId: "a" }, "b")).toBe(false);
    expect(signalForShownScene({ sceneId: "a" }, null)).toBe(false);
  });

  test("FR-MAP-29 layer registry orders layers; a test layer slots in at its order", () => {
    const c = () => null;
    const layers = orderLayers([
      { id: "pointers", order: LAYER_ORDER.pointers, component: c },
      { id: "map", order: LAYER_ORDER.map, component: c },
      { id: "tokens", order: LAYER_ORDER.tokens, component: c },
      { id: "test-fog", order: LAYER_ORDER.fog, component: c },
      { id: "grid", order: LAYER_ORDER.grid, component: c },
    ]);
    expect(layers.map((l) => l.id)).toEqual(["map", "grid", "test-fog", "tokens", "pointers"]);
    expect(() =>
      orderLayers([
        { id: "a", order: 1, component: c },
        { id: "a", order: 2, component: c },
      ]),
    ).toThrow();
    expect(() =>
      orderLayers([
        { id: "a", order: 1, component: c },
        { id: "b", order: 1, component: c },
      ]),
    ).toThrow();
  });

  test("FR-MAP-24 laser: ≤ 20 sends/s, ≤ 32 points per send, end flag", () => {
    let now = 0;
    const pending: { at: number; fn: () => void }[] = [];
    const timers: LaserTimers = {
      now: () => now,
      setTimeout: (fn, ms) => {
        const t = { at: now + ms, fn };
        pending.push(t);
        return t;
      },
      clearTimeout: (h) => {
        const i = pending.indexOf(h as never);
        if (i >= 0) pending.splice(i, 1);
      },
    };
    const advance = (ms: number) => {
      now += ms;
      for (const t of [...pending].sort((a, b) => a.at - b.at)) {
        if (t.at <= now) {
          pending.splice(pending.indexOf(t), 1);
          t.fn();
        }
      }
    };
    const sent: { at: number; points: number; end?: boolean }[] = [];
    const s = new LaserSender(
      "scene",
      (d) => sent.push({ at: now, points: d.points.length, end: d.end }),
      timers,
    );
    for (let i = 0; i < 1000; i++) {
      s.push(i, i);
      advance(1);
    }
    s.end();
    advance(100);
    // ~1.05 s of pointer movement at ≥ 50 ms per send.
    expect(sent.length).toBeLessThanOrEqual(22);
    expect(sent.length).toBeGreaterThanOrEqual(20);
    expect(sent.every((f) => f.points <= 32)).toBe(true);
    for (let i = 1; i < sent.length; i++) {
      expect((sent[i]?.at ?? 0) - (sent[i - 1]?.at ?? 0)).toBeGreaterThanOrEqual(50);
    }
    expect(sent.at(-1)?.end).toBe(true);
  });
});
