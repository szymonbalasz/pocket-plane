// FR-NOTE-83 (BL-151, sim-17 b08): a player's stack leaves its corner only when the corner sits on a
// window's drawn content or a modal dialog (a sheet remembered at 600 × 598: a sticky card on a
// row's +4 button). The DM's rules at the player's home (FR-NOTE-75–78): first a spot on no window
// and no PC, then one on a window's empty body, then over a body the fewest controls, then
// primary parts and headings, always off title bars, tool bars and dialogs; nearest the corner.
// FR-NOTE-76: under a modal dialog's overlay only the dialogs count. `covers` > 0 (controls under
// the spot) lets the runtime fold cards into "+N more" (FR-NOTE-77). A PC alone never moves it off
// the corner. Pure.
import {
  EDGE_GAP,
  LAUNCHER_CLEAR,
  type Rect,
  TITLE_H,
  TOP_BAR_H,
  type Viewport,
} from "../play-shell/geometry";
import { NOTE_EDGE, PLAYER_TOAST_BOTTOM, STACK_GAP } from "../play-shell/toast-region";
import { coveredArea } from "../play-shell/token-boxes";
import {
  contentOf,
  controlsUnder,
  headingsUnder,
  hits,
  MIN_SHIFT_LEFT,
  primaryUnder,
  STACK_W,
  type StackWindow,
} from "./keep-out";

/** The stack's home: bottom-right, `PLAYER_TOAST_BOTTOM` above the edge. */
export const playerHome = (vp: Viewport, stackH: number, width = STACK_W) => ({
  left: vp.w - NOTE_EDGE - width,
  top: vp.h - PLAYER_TOAST_BOTTOM - stackH,
});

const less = (a: readonly number[], b: readonly number[]) => {
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
};

export function playerStackSpot(
  vp: Viewport,
  stackH: number,
  windows: readonly StackWindow[] = [],
  hard: readonly Rect[] = [],
  dialogs: readonly Rect[] = [],
  pcs: readonly Rect[] = [],
  width = STACK_W,
): { left: number; top: number; covers: number } {
  const home = playerHome(vp, stackH, width);
  if (stackH === 0) return { ...home, covers: 0 };
  const modal = dialogs.length > 0;
  // FR-NOTE-76: what is under a modal dialog's overlay is inert.
  const wins = modal ? [] : windows;
  const blocks = modal ? dialogs : hard;
  const gap = modal ? EDGE_GAP : 0;
  const at = (p: { left: number; top: number }): Rect => ({
    x: p.left,
    y: p.top,
    w: width,
    h: stackH,
  });
  const blocked = (r: Rect) => blocks.some((b) => hits(r, b, gap));
  const contents = wins.map(contentOf);
  const overContent = (r: Rect) => contents.some((c) => hits(r, c, 0));
  // The corner is free (the empty body below a window's content too): nothing changes.
  if (!blocked(at(home)) && !overContent(at(home))) return { ...home, covers: 0 };

  const maxTop = vp.h - LAUNCHER_CLEAR - stackH;
  const minTop = TOP_BAR_H + EDGE_GAP;
  // Only the controls that the stack could sit on at its own row decide lefts (else every row's
  // button is a candidate for nothing).
  const band: Rect = { x: 0, y: home.top, w: vp.w, h: maxTop + stackH - home.top };
  const edges = [...wins, ...blocks, ...pcs];
  const controls = wins.flatMap((w) => w.controls ?? []).filter((c) => hits(c, band, 0));
  const lefts = [
    home.left,
    ...edges.flatMap((e) => [e.x - EDGE_GAP - width, e.x + e.w + EDGE_GAP]),
    ...controls.flatMap((c) => [c.x - STACK_GAP - width, c.x + c.w + STACK_GAP]),
  ]
    .map(Math.round)
    .filter((l) => l >= MIN_SHIFT_LEFT && l <= home.left);
  const tops = [
    home.top,
    maxTop,
    ...edges.flatMap((e) => [e.y + e.h + EDGE_GAP, e.y - EDGE_GAP - stackH]),
    ...wins.flatMap((w) =>
      [...contents.filter((c) => c.x === w.x && c.y === w.y), ...(w.primary ?? [])].flatMap((r) => [
        r.y + r.h + STACK_GAP,
        r.y - STACK_GAP - stackH,
      ]),
    ),
  ]
    .map(Math.round)
    .filter((y) => y >= minTop && y <= maxTop);
  const spots = [...new Set(tops)].flatMap((top) =>
    [...new Set(lefts)].map((left) => ({ left, top })),
  );
  const distance = (p: { left: number; top: number }) =>
    home.left - p.left + Math.abs(home.top - p.top);
  const nearest = (ok: (r: Rect) => boolean) => {
    let best: { left: number; top: number } | null = null;
    let bestD = Number.POSITIVE_INFINITY;
    for (const p of spots) {
      const d = distance(p);
      if (d >= bestD || !ok(at(p))) continue;
      best = p;
      bestD = d;
    }
    return best;
  };
  const offPcs = (r: Rect) => !pcs.some((c) => hits(r, c, 0));
  // 1. On no window, no PC; 2. on a window's empty body, no PC.
  const clear =
    nearest((r) => !blocked(r) && offPcs(r) && !wins.some((w) => hits(r, w, 0))) ??
    nearest((r) => !blocked(r) && offPcs(r) && !overContent(r));
  if (clear) return { ...clear, covers: 0 };
  // 3. Over a body, off the title bars: the fewest controls first (BL-151: the row buttons), then
  // the primary parts and headings (FR-NOTE-78), then the PCs, then nearest the corner.
  const bars = wins.map((w) => ({ ...w, h: TITLE_H }));
  let best = home;
  let bestKey: number[] | null = null;
  for (const p of [home, ...spots]) {
    const r = at(p);
    if (blocked(r) || bars.some((b) => hits(r, b, 0))) continue;
    const key = [
      controlsUnder(r, wins),
      primaryUnder(r, wins),
      headingsUnder(r, wins),
      coveredArea(r, pcs),
      distance(p),
    ];
    if (bestKey === null || less(key, bestKey)) {
      best = p;
      bestKey = key;
    }
  }
  return { ...best, covers: controlsUnder(at(best), wins) };
}
