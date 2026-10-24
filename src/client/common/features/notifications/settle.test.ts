// BL-115 (sprint 11 F2): the DM stack settles. The runtime's fold frame by frame (`settleStack`;
// the stack's height measured a frame after each cap change, as `ResizeObserver` reports it), on
// walkthrough H3 re-test 2's inputs (`.verify/sprint10/walkthroughs/20261024-h3r2/report.md` O1:
// "520,100 → 340 tall → 480,140 → 480,254 → 520,100 folded, all within ~70 ms while the dice
// popup moves"). The old runtime (a fold restarted on every layout change, the stack drawn at each
// step's spot) is modelled beside it: the repro.
import { describe, expect, test } from "bun:test";
import { dmStackSpot, STACK_W, type StackWindow } from "./keep-out";
import {
  type FoldState,
  foldCap,
  MAX_VISIBLE,
  REFOLD_QUIET_MS,
  refold,
  type StackSettle,
  settleStack,
  UNSETTLED,
} from "./toasts";

type Spot = { left: number; top: number };
type Box = { x: number; y: number; w: number; h: number };

const FRAME = 16;
const small = { w: 1280, h: 720 };
const init = { x: 868, y: 60, w: 400, h: 578 };
const log = { x: 68, y: 484, w: 690, h: 160, used: 644, head: 540 };
const enc = { x: 68, y: 60, w: 440, h: 410, used: 470, head: 248 };
// Thorn and Mira right of Encounters (+ 4 px): a taller stack at 520 would cover them.
const pcs = [
  { x: 522, y: 290, w: 52, h: 54 },
  { x: 570, y: 290, w: 52, h: 54 },
];
/** Summary + cards (O1): 92 with no card, 186 with one, + 94 a card; "+N more" in it. */
const heightOf = (cards: number) => (cards === 0 ? 92 : 186 + (cards - 1) * 94);

interface Frame {
  /** The windows as rendered this frame (a new rect = a layout change). */
  windows: StackWindow[];
  /** Pending cards (a new count restarts the fold at once). */
  cards: number;
}

/**
 * Runs `frames` through the runtime; returns the spot drawn each frame. `old`: the runtime before
 * BL-115 (the fold restarts on every layout change, the stack drawn where each step lands).
 */
function run(frames: Frame[], old = false, pc: Box[] = pcs): Spot[] {
  let s: StackSettle = UNSETTLED;
  let f: FoldState = { cap: MAX_VISIBLE, foldedAt: null };
  let measured = 0;
  let prev: Frame | null = null;
  let layoutAt: number | null = null;
  const drawn: Spot[] = [];
  const key = (ws: StackWindow[]) => JSON.stringify(ws.map(({ x, y, w, h }) => [x, y, w, h]));
  frames.forEach((fr, i) => {
    const now = i * FRAME;
    if (prev && prev.cards !== fr.cards) {
      s = refold(s);
      f = { cap: MAX_VISIBLE, foldedAt: null };
    }
    if (prev && key(prev.windows) !== key(fr.windows)) {
      if (old) f = { cap: MAX_VISIBLE, foldedAt: null };
      layoutAt = now;
    }
    // The quiet timer: a layout change refolds once it held still.
    if (!old && layoutAt !== null && now - layoutAt >= REFOLD_QUIET_MS) {
      s = refold(s);
      layoutAt = null;
    }
    prev = fr;
    const cap = old ? f.cap : s.fold.cap;
    // A render: the shown cards at this cap; the height is last frame's measure.
    if (measured === 0) measured = heightOf(Math.min(cap, fr.cards));
    // The layout effect, re-run while a cap change re-renders (same measured height).
    const spot = dmStackSpot(small, init, measured, STACK_W, [], fr.windows, [], [], [], pc);
    for (let render = 0; render < 3; render++) {
      const o = {
        need: spot.covers > 0,
        min: 0,
        stackH: measured,
        shown: Math.min(old ? f.cap : s.fold.cap, fr.cards),
      };
      if (old) f = foldCap(f, o);
      else s = settleStack(s, { ...o, spot, now });
    }
    drawn[i] = old ? { left: spot.left, top: spot.top } : (s.drawn as Spot);
    // ResizeObserver: the height at this frame's cap, for the next frame.
    measured = heightOf(Math.min(old ? f.cap : s.fold.cap, fr.cards));
  });
  return drawn;
}

/** The frames where the drawn spot differs from the frame before. */
const moves = (d: Spot[]) =>
  d.flatMap((p, i) => {
    const q = d[i - 1];
    return i > 0 && q && (q.left !== p.left || q.top !== p.top) ? [i] : [];
  });

describe("FR-NOTE-77 BL-115 the stack settles", () => {
  test("FR-NOTE-77 BL-115 H3 re-test 2 O1 (1280×720, Encounters 68, 60, PCs right of it): two more cards arrive → the stack stays at 520, 100, folded to one card, no hop", () => {
    const frames: Frame[] = [
      ...Array.from({ length: 10 }, () => ({ windows: [log, enc], cards: 1 })),
      ...Array.from({ length: 20 }, () => ({ windows: [log, enc], cards: 3 })),
    ];
    // The repro: the old runtime draws the unfolded and half-folded stacks on the way.
    const before = run(frames, true);
    expect(moves(before).length).toBeGreaterThanOrEqual(2);
    expect(before.slice(10).some((p) => p.left !== 520 || p.top !== 100)).toBe(true);
    // Settled: drawn at 520, 100 every frame.
    const after = run(frames);
    expect(after.every((p) => p.left === 520 && p.top === 100)).toBe(true);
  });

  test("FR-NOTE-77 BL-115 a window that changes every frame (a popup animating beside it) doesn't restart the fold: the stack folds to one card at 520, 100 and stays", () => {
    // Encounters' rect grows 1 px a frame for 30 frames (≈ 0.5 s), then holds; 3 cards.
    const frames: Frame[] = Array.from({ length: 60 }, (_, i) => ({
      windows: [log, { ...enc, h: enc.h + Math.min(i, 30) }],
      cards: 3,
    }));
    // The repro: each change restarts the fold, which steps once on the stale height and then
    // waits for a new one that never comes: two cards on Encounters' body, for good.
    const before = run(frames, true);
    expect(moves(before).length).toBeGreaterThanOrEqual(1);
    expect(before.at(-1)).toEqual({ left: 480, top: 140 });
    // Settled: the first show (nothing drawn before it to hold) settles in its first frames; then
    // the fold rests while the window moves and the quiet refold after it ends where it was.
    const after = run(frames);
    expect(moves(after).filter((i) => i > 2)).toEqual([]);
    expect(after.slice(3).every((p) => p.left === 520 && p.top === 100)).toBe(true);
    expect(after.at(-1)).toEqual({ left: 520, top: 100 });
  });

  test("FR-NOTE-77 BL-115 FR-NOTE-51 a spot change with no fold step moves the stack in the same frame (a window moved off home)", () => {
    // Scenes over home, then dragged away: the summary alone (no card) re-places at once.
    const scenes = { x: 400, y: 112, w: 260, h: 410, used: 265, head: 229 };
    const frames: Frame[] = [
      ...Array.from({ length: 5 }, () => ({ windows: [log, scenes], cards: 0 })),
      ...Array.from({ length: 5 }, () => ({ windows: [log, { ...scenes, x: 900 }], cards: 0 })),
    ];
    const d = run(frames, false, []);
    expect(d[4]).not.toEqual(d[5]);
    expect(d[5]).toEqual({ left: 480, top: 100 });
    expect(moves(d)).toEqual([5]);
  });

  test("FR-NOTE-77 BL-115 a hold that sees no new height ends after the hold time", () => {
    // A fold step whose height never changes: held, then drawn at the computed spot.
    let s: StackSettle = { ...UNSETTLED, drawn: { left: 480, top: 100 } };
    const o = { need: true, min: 0, stackH: 300, shown: 3, spot: { left: 480, top: 254 } };
    s = settleStack(s, { ...o, now: 0 });
    expect(s).toMatchObject({ hold: true, drawn: { left: 480, top: 100 }, heldSince: 0 });
    s = settleStack(s, { ...o, now: 100 });
    expect(s.hold).toBe(true);
    s = settleStack(s, { ...o, now: 400 });
    expect(s).toMatchObject({ hold: false, drawn: { left: 480, top: 254 } });
    // Same inputs again: the same state back (no re-render loop).
    expect(settleStack(s, { ...o, now: 500 })).toBe(s);
  });
});
