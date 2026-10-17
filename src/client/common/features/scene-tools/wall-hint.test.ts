// FR-SCN-38 the player's wall hint, read from scenes-map's drag probe (sprint 4, seams S1; the
// probe's timing is tested in `scenes-map/drag-probe.test.ts`): only the wall guard's pieces,
// stale acks dropped, cleared on cell change / drag end / snapshot / disconnect.
import { describe, expect, test } from "bun:test";
import { type Segment, WALL_GUARD } from "@shared/scene-tools/schemas";
import { FOG_SIGHT_HINT } from "@shared/scenes-map/schemas";
import { DragProbe, PROBE_DEBOUNCE_MS, PROBE_MIN_GAP_MS } from "../scenes-map/drag-probe";
import { hintPieces, subscribeWallHint } from "./wall-hint";

const PIECE: Segment = [8, 7, 8, 8];
const ack = (segments: Segment[]) => ({
  ok: segments.length === 0,
  hints: segments.length ? [{ guard: WALL_GUARD, segments }] : [],
});

/** A fake clock + timers; `check` answers are resolved by the test. */
function harness() {
  let now = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let ids = 0;
  const sent: { col: number; row: number }[] = [];
  const answers: ((v: unknown) => void)[] = [];
  const fails: ((e: unknown) => void)[] = [];
  const shown: Segment[][] = [];
  const probe = new DragProbe({
    check: (_tokenId, to) => {
      sent.push(to);
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
  const off = subscribeWallHint(probe, (p) => shown.push(p));
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
  const last = () => shown.at(-1) ?? [];
  probe.start("mira", { col: 2, row: 7 }, true);
  return { probe, sent, answers, fails, shown, advance, flush, last, off };
}

describe("FR-SCN-38 wall hint", () => {
  test("FR-SCN-38 the piece of the current cell's ack shows until the cell changes", async () => {
    const h = harness();
    h.probe.move({ col: 10, row: 7 });
    h.advance(PROBE_DEBOUNCE_MS);
    h.answers[0]?.(ack([PIECE]));
    await h.flush();
    expect(h.last()).toEqual([PIECE]);
    h.probe.move({ col: 3, row: 7 }); // back: cleared at once, then ok → nothing
    expect(h.last()).toEqual([]);
    h.advance(PROBE_MIN_GAP_MS);
    h.answers[1]?.(ack([]));
    await h.flush();
    expect(h.last()).toEqual([]);
  });

  test("FR-SCN-38 a stale ack (older cell) is dropped", async () => {
    const h = harness();
    h.probe.move({ col: 10, row: 7 });
    h.advance(PROBE_DEBOUNCE_MS);
    h.probe.move({ col: 11, row: 7 }); // moved on before the ack
    h.answers[0]?.(ack([PIECE]));
    await h.flush();
    expect(h.last()).toEqual([]);
    h.advance(PROBE_MIN_GAP_MS);
    h.answers[1]?.(ack([[8, 7.2, 8, 8.2]]));
    await h.flush();
    expect(h.last()).toEqual([[8, 7.2, 8, 8.2]]);
  });

  test("FR-SCN-38 cleared on drag end, snapshot and disconnect; late acks don't bring it back", async () => {
    const h = harness();
    let col = 9;
    const show = async () => {
      h.probe.move({ col: ++col, row: 7 });
      h.advance(PROBE_MIN_GAP_MS);
      h.answers.at(-1)?.(ack([PIECE]));
      await h.flush();
      expect(h.last()).toEqual([PIECE]);
    };
    await show();
    h.probe.finish(); // drag end
    expect(h.last()).toEqual([]);
    h.probe.start("mira", { col: 2, row: 7 }, true);
    await show();
    h.probe.snapshot();
    expect(h.last()).toEqual([]);
    await show();
    h.probe.clear(); // disconnect (the drag is dropped too, FR-MAP-28)
    expect(h.last()).toEqual([]);
    // A check in flight across a snapshot is dropped.
    h.probe.start("mira", { col: 2, row: 7 }, true);
    h.probe.move({ col: 10, row: 7 });
    h.advance(PROBE_MIN_GAP_MS);
    h.probe.snapshot();
    h.answers.at(-1)?.(ack([PIECE]));
    await h.flush();
    expect(h.last()).toEqual([]);
    // A pending (debounced) check is cancelled by the drag end.
    const n = h.sent.length;
    h.probe.move({ col: 12, row: 7 });
    h.probe.finish();
    h.advance(500);
    expect(h.sent).toHaveLength(n);
  });

  test("FR-SCN-38 a reject shows nothing and never throws", async () => {
    const h = harness();
    h.probe.move({ col: 10, row: 7 });
    h.advance(PROBE_DEBOUNCE_MS);
    h.fails[0]?.(new Error("not_found"));
    await h.flush();
    expect(h.shown).toEqual([]);
  });

  test("FR-SCN-38 only the wall guard's pieces (not other guards', not fog-sight); a malformed ack shows nothing", () => {
    expect(
      hintPieces({
        ok: false,
        hints: [
          { guard: "other.guard", segments: [[1, 1, 2, 2]] },
          { guard: WALL_GUARD, segments: [PIECE] },
          { guard: FOG_SIGHT_HINT, tokenId: "mira", see: [], dark: [] },
        ],
      }),
    ).toEqual([PIECE]);
    expect(hintPieces({ ok: false })).toEqual([]);
    expect(hintPieces(null)).toEqual([]);
  });
});
