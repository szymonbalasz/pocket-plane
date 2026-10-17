// FR-MAP-39 drag probe (sprint 4, seams S1): one `map.checkMove` per cell change, debounce 50 ms,
// ≤ 10 / s, one in flight, newest cell wins, stale acks dropped, the DM probes owned tokens only,
// subscribers get the parsed ack (every hint), `done` after the drop's intent, `recheck`.
import { describe, expect, test } from "bun:test";
import { FOG_SIGHT_HINT } from "@shared/scenes-map/schemas";
import {
  DragProbe,
  PROBE_DEBOUNCE_MS,
  PROBE_MIN_GAP_MS,
  type ProbeDrag,
  probesDrag,
} from "./drag-probe";

const SIGHT = { guard: FOG_SIGHT_HINT, tokenId: "mira", see: [[0, 0, 1, 0, 1, 1]], dark: [] };

/** Fake clock + timers; `check` answers are resolved by the test (or at once with `auto`). */
function probeHarness(auto = false) {
  let now = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let ids = 0;
  const sent: { tokenId: string; to: { col: number; row: number }; at: number }[] = [];
  const answers: ((v: unknown) => void)[] = [];
  const fails: ((e: unknown) => void)[] = [];
  const probe = new DragProbe({
    check: (tokenId, to) => {
      sent.push({ tokenId, to, at: now });
      if (auto) {
        // A synchronous thenable: the answer lands inside the timer that sent it.
        // biome-ignore lint/suspicious/noThenProperty: a deliberate sync promise stand-in.
        return { then: (res: (v: unknown) => void) => res({ ok: true, hints: [] }) } as never;
      }
      return new Promise((res, rej) => {
        answers.push(res);
        fails.push(rej);
      });
    },
    now: () => now,
    setTimer: (fn, ms) => {
      const id = ++ids;
      timers.push({ at: now + ms, fn, id });
      return id;
    },
    clearTimer: (h) => {
      const i = timers.findIndex((t) => t.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > end) break;
      timers.shift();
      now = t.at;
      t.fn();
    }
    now = end;
  };
  const flush = () => new Promise((r) => setTimeout(r, 0));
  const acks: { drag: ProbeDrag; hints: unknown[] }[] = [];
  const events: string[] = [];
  probe.subscribe({
    cell: (d) => events.push(`cell ${d.to.col},${d.to.row}`),
    ack: (drag, r) => acks.push({ drag, hints: r.hints }),
    done: (id) => events.push(`done ${id}`),
    reset: () => events.push("reset"),
  });
  return { probe, sent, answers, fails, advance, flush, acks, events };
}

describe("FR-MAP-39 drag probe", () => {
  test("FR-MAP-39 drag probe: one checkMove per cell change after 50 ms; nothing for an unmoved drag", async () => {
    const h = probeHarness();
    h.probe.start("mira", { col: 2, row: 7 }, true);
    h.advance(200);
    expect(h.sent).toEqual([]);
    h.probe.move({ col: 3, row: 7 });
    h.probe.move({ col: 3, row: 7 }); // same cell: nothing new
    h.advance(PROBE_DEBOUNCE_MS - 1);
    expect(h.sent).toEqual([]);
    h.advance(1);
    expect(h.sent).toEqual([{ tokenId: "mira", to: { col: 3, row: 7 }, at: 250 }]);
    expect(h.events).toEqual(["cell 3,7"]);
    h.answers[0]?.({ ok: true, hints: [SIGHT] });
    await h.flush();
    expect(h.acks).toEqual([
      {
        drag: { tokenId: "mira", from: { col: 2, row: 7 }, to: { col: 3, row: 7 } },
        hints: [SIGHT],
      },
    ]);
  });

  test("FR-MAP-39 drag probe: one in flight; the newest cell goes out after the ack, ≥ 100 ms apart; ≤ 10 / s", async () => {
    const h = probeHarness();
    h.probe.start("mira", { col: 2, row: 7 }, true);
    h.probe.move({ col: 3, row: 7 });
    h.advance(PROBE_DEBOUNCE_MS);
    expect(h.sent).toHaveLength(1);
    for (let c = 4; c <= 8; c++) {
      h.probe.move({ col: c, row: 7 });
      h.advance(60);
    }
    expect(h.sent).toHaveLength(1); // still waiting for the first ack
    h.answers[0]?.({ ok: true, hints: [] });
    await h.flush();
    expect(h.acks).toEqual([]); // stale: the cell moved on
    h.advance(PROBE_DEBOUNCE_MS);
    expect(h.sent.map((s) => s.to.col)).toEqual([3, 8]); // newest wins
    // Auto-answered: a 30-cell drag in 3 s sends ≤ 10 / s, each ≥ 100 ms apart.
    const a = probeHarness(true);
    a.probe.start("mira", { col: 0, row: 0 }, true);
    for (let c = 1; c <= 30; c++) {
      a.probe.move({ col: c, row: 0 });
      a.advance(100);
    }
    a.advance(500);
    const at = a.sent.map((s) => s.at);
    for (let i = 1; i < at.length; i++) {
      expect((at[i] as number) - (at[i - 1] as number)).toBeGreaterThanOrEqual(PROBE_MIN_GAP_MS);
    }
    for (let t0 = 0; t0 < 3500; t0 += 100) {
      expect(at.filter((t) => t >= t0 && t < t0 + 1000).length).toBeLessThanOrEqual(10);
    }
    expect(a.sent.at(-1)?.to.col).toBe(30);
  });

  test("FR-MAP-39 drag probe: stale acks dropped across a drag end, a snapshot and a new drag; a reject is ignored", async () => {
    const h = probeHarness();
    h.probe.start("mira", { col: 2, row: 7 }, true);
    h.probe.move({ col: 3, row: 7 });
    h.advance(PROBE_DEBOUNCE_MS);
    h.probe.snapshot();
    h.answers[0]?.({ ok: true, hints: [SIGHT] });
    await h.flush();
    expect(h.acks).toEqual([]);
    expect(h.events.at(-1)).toBe("reset");
    h.probe.move({ col: 4, row: 7 });
    h.advance(PROBE_MIN_GAP_MS);
    h.fails[1]?.(new Error("not_found"));
    await h.flush();
    expect(h.acks).toEqual([]);
    h.probe.move({ col: 5, row: 7 });
    h.advance(PROBE_MIN_GAP_MS);
    h.probe.finish();
    await h.flush();
    expect(h.events.at(-1)).toBe("done mira");
    h.answers[2]?.({ ok: true, hints: [SIGHT] });
    await h.flush();
    expect(h.acks).toEqual([]);
    // A malformed ack reaches nobody.
    h.probe.start("mira", { col: 5, row: 7 }, true);
    h.probe.move({ col: 6, row: 7 });
    h.advance(PROBE_MIN_GAP_MS);
    h.answers[3]?.({ nope: true });
    await h.flush();
    expect(h.acks).toEqual([]);
  });

  test("FR-MAP-39 drag probe: the DM probes owned tokens only; a non-probing drag sends nothing", () => {
    expect(probesDrag("player", { ownerPlayerId: "p1" })).toBe(true);
    expect(probesDrag("dm", { ownerPlayerId: "p2" })).toBe(true);
    expect(probesDrag("dm", { ownerPlayerId: null })).toBe(false);
    const h = probeHarness();
    h.probe.start("goblin", { col: 12, row: 6 }, false);
    h.probe.move({ col: 11, row: 6 });
    h.probe.recheck();
    h.advance(1000);
    expect(h.sent).toEqual([]);
    expect(h.events).toEqual(["cell 11,6"]); // the drag state still flows to subscribers
  });

  test("FR-MAP-39 drag probe: done waits for the drop's intent; recheck re-sends the current cell (FR-FOG-54)", async () => {
    const h = probeHarness();
    h.probe.start("mira", { col: 2, row: 7 }, true);
    h.probe.move({ col: 3, row: 7 });
    h.advance(PROBE_DEBOUNCE_MS);
    h.answers[0]?.({ ok: true, hints: [SIGHT] });
    await h.flush();
    h.probe.recheck();
    h.advance(PROBE_MIN_GAP_MS);
    expect(h.sent.map((s) => s.to.col)).toEqual([3, 3]);
    h.answers[1]?.({ ok: true, hints: [] });
    await h.flush();
    let settled = false;
    let resolveMove: (v: unknown) => void = () => {};
    const move = new Promise((r) => {
      resolveMove = r;
    });
    h.probe.subscribe({
      done: (_id, p) => {
        p.then(() => {
          settled = true;
        });
      },
    });
    h.probe.finish(move);
    await h.flush();
    expect(settled).toBe(false);
    resolveMove({});
    await h.flush();
    expect(settled).toBe(true);
    expect(h.probe.current()).toBeNull();
  });
});
