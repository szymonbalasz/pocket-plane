// FR-SCN-38 the player's wall hint probe: debounce 50 ms + ≤ 10 / s (newest wins), only the wall
// guard's pieces, stale acks dropped, cleared on cell change / drag end / snapshot / disconnect.
import { describe, expect, test } from "bun:test";
import { type Segment, WALL_GUARD } from "@shared/scene-tools/schemas";
import {
  HINT_DEBOUNCE_MS,
  HINT_MIN_GAP_MS,
  type HintDrag,
  hintPieces,
  WallHintProbe,
} from "./wall-hint";

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
  const sent: { tokenId: string; to: { col: number; row: number }; at: number }[] = [];
  const answers: ((v: unknown) => void)[] = [];
  const fails: ((e: unknown) => void)[] = [];
  const shown: Segment[][] = [];
  const probe = new WallHintProbe({
    check: (tokenId, to) => {
      sent.push({ tokenId, to, at: now });
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
    onChange: (p) => shown.push(p),
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
  const drag = (col: number, row: number): HintDrag => ({
    tokenId: "mira",
    from: { col: 2, row: 7 },
    to: { col, row },
  });
  const last = () => shown.at(-1) ?? [];
  return { probe, sent, answers, fails, shown, advance, flush, drag, last };
}

describe("FR-SCN-38 wall hint probe", () => {
  test("FR-SCN-38 a previewed cell held 50 ms sends one map.checkMove; the piece shows until the cell changes", async () => {
    const h = harness();
    h.probe.update(h.drag(2, 7)); // unmoved: nothing to check
    h.advance(200);
    expect(h.sent).toEqual([]);
    h.probe.update(h.drag(10, 7));
    h.advance(HINT_DEBOUNCE_MS - 1);
    expect(h.sent).toEqual([]);
    h.advance(1);
    expect(h.sent).toEqual([{ tokenId: "mira", to: { col: 10, row: 7 }, at: 250 }]);
    h.answers[0]?.(ack([PIECE]));
    await h.flush();
    expect(h.last()).toEqual([PIECE]);
    h.probe.update(h.drag(10, 7)); // same cell: no new check, the piece stays
    h.advance(500);
    expect(h.sent).toHaveLength(1);
    expect(h.last()).toEqual([PIECE]);
    h.probe.update(h.drag(3, 7)); // back: cleared at once, then ok → nothing
    expect(h.last()).toEqual([]);
    h.advance(HINT_DEBOUNCE_MS);
    h.answers[1]?.(ack([]));
    await h.flush();
    expect(h.last()).toEqual([]);
  });

  test("FR-SCN-38 debounce + ≤ 10 / s: a fast drag sends only the newest cell, ≥ 100 ms apart", () => {
    const h = harness();
    for (let c = 3; c <= 9; c++) {
      h.probe.update(h.drag(c, 7));
      h.advance(20); // a new cell every 20 ms: none holds 50 ms
    }
    expect(h.sent).toEqual([]);
    h.advance(HINT_DEBOUNCE_MS);
    expect(h.sent.map((s) => s.to.col)).toEqual([9]);
    // Steady cells every 60 ms: each holds 50 ms, but checks stay ≥ 100 ms apart.
    for (let c = 10; c <= 15; c++) {
      h.probe.update(h.drag(c, 7));
      h.advance(60);
    }
    h.advance(200);
    const at = h.sent.map((s) => s.at);
    for (let i = 1; i < at.length; i++) {
      expect((at[i] as number) - (at[i - 1] as number)).toBeGreaterThanOrEqual(HINT_MIN_GAP_MS);
    }
    expect(h.sent.at(-1)?.to.col).toBe(15); // newest wins
    expect(h.sent.length).toBeLessThan(7);
  });

  test("FR-SCN-38 a stale ack (older cell) is dropped", async () => {
    const h = harness();
    h.probe.update(h.drag(10, 7));
    h.advance(HINT_DEBOUNCE_MS);
    h.probe.update(h.drag(11, 7)); // moved on before the ack
    h.answers[0]?.(ack([PIECE]));
    await h.flush();
    expect(h.last()).toEqual([]);
    h.advance(HINT_MIN_GAP_MS);
    h.answers[1]?.(ack([[8, 7.2, 8, 8.2]]));
    await h.flush();
    expect(h.last()).toEqual([[8, 7.2, 8, 8.2]]);
  });

  test("FR-SCN-38 cleared on drag end, snapshot and disconnect; late acks don't bring it back", async () => {
    const h = harness();
    const show = async () => {
      h.probe.update(h.drag(10, 7));
      h.advance(HINT_MIN_GAP_MS);
      h.answers.at(-1)?.(ack([PIECE]));
      await h.flush();
      expect(h.last()).toEqual([PIECE]);
    };
    await show();
    h.probe.update(null); // drag end
    expect(h.last()).toEqual([]);
    await show();
    h.probe.snapshot();
    expect(h.last()).toEqual([]);
    h.probe.clear(); // disconnect (the drag is dropped too, FR-MAP-28)
    // A check in flight across a snapshot is dropped.
    h.probe.update(h.drag(10, 7));
    h.advance(HINT_MIN_GAP_MS);
    h.probe.snapshot();
    h.answers.at(-1)?.(ack([PIECE]));
    await h.flush();
    expect(h.last()).toEqual([]);
    // A pending (debounced) check is cancelled by the drag end.
    const n = h.sent.length;
    h.probe.update(h.drag(12, 7));
    h.probe.update(null);
    h.advance(500);
    expect(h.sent).toHaveLength(n);
  });

  test("FR-SCN-38 a reject shows nothing and never throws", async () => {
    const h = harness();
    h.probe.update(h.drag(10, 7));
    h.advance(HINT_DEBOUNCE_MS);
    h.fails[0]?.(new Error("not_found"));
    await h.flush();
    expect(h.shown).toEqual([]);
  });

  test("FR-SCN-38 only the wall guard's pieces; a malformed ack shows nothing", () => {
    expect(
      hintPieces({
        ok: false,
        hints: [
          { guard: "other.guard", segments: [[1, 1, 2, 2]] },
          { guard: WALL_GUARD, segments: [PIECE] },
        ],
      }),
    ).toEqual([PIECE]);
    expect(hintPieces({ ok: false })).toEqual([]);
    expect(hintPieces(null)).toEqual([]);
  });
});
