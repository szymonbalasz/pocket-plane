// FR-NOTE-32 (sprint-1 leftover): the DM's toast stack keeps clear of an open, non-minimised
// `cbt.initiative` window (its rendered rect from play-shell, grown height included: Undo and
// footer too). Default top-centre (#149); overlapping → shifted left with a 12 px gap; no room
// left of it → below its bottom edge. P3 glitch 2: then, of the spots clear of Initiative, the one
// covering the least of the toasts' tokens to avoid (a card's likely targets) wins; ties keep the
// default. Window title bars are never covered, their bodies only when no spot clear of them is
// (sim-6 glitch 3). Pure; players keep bottom-right.

import {
  EDGE_GAP,
  LAUNCHER_CLEAR,
  type Rect,
  TITLE_H,
  type Viewport,
} from "../play-shell/geometry";
import { RAIL_CLEAR } from "../play-shell/placement";
import { DM_TOAST_TOP, STACK_GAP } from "../play-shell/toast-region";
import { coveredArea, type TokenBox } from "../play-shell/token-boxes";

/** The stack's width, px (`w-80`). */
export const STACK_W = 320;

/** FR-NOTE-32 alone: centred, else left of Initiative, else below it. */
function initiativeKeepOut(
  vp: Viewport,
  initiative: Rect | null,
  stackH: number,
  width: number,
): { left: number; top: number } {
  const left = Math.round((vp.w - width) / 2);
  const top = DM_TOAST_TOP;
  if (!initiative) return { left, top };
  const overlapsX =
    left < initiative.x + initiative.w + EDGE_GAP && initiative.x - EDGE_GAP < left + width;
  const overlapsY =
    initiative.y < top + stackH + EDGE_GAP && initiative.y + initiative.h + EDGE_GAP > top;
  if (!overlapsX || !overlapsY) return { left, top };
  const shifted = initiative.x - EDGE_GAP - width;
  if (shifted >= RAIL_CLEAR) return { left: Math.min(left, shifted), top };
  return { left, top: Math.round(initiative.y + initiative.h + EDGE_GAP) };
}

const hits = (a: Rect, b: Rect, gap: number) =>
  a.x < b.x + b.w + gap && b.x - gap < a.x + a.w && a.y < b.y + b.h + gap && b.y - gap < a.y + a.h;

/**
 * `stackH`: the stack's measured height (0 before the first measure). `avoid`: on-screen boxes of
 * the tokens the stack should keep clear of (P3 glitch 2). `windows`: the other open windows'
 * rendered rects; their title bars are never covered (P3 retest: the drag handle stays
 * reachable), their bodies only when no spot clear of them is (sim-6 glitch 3: the stack sat on
 * the Notifications rows). Candidate spots: FR-NOTE-32's first, then the top row, below each
 * title bar, below each window and above / below each token, at the centre, the left edge, left
 * of Initiative, beside each window and beside each token. Of the spots clear of Initiative and
 * the bars, the one covering the least token area, then the least window body, wins (ties keep
 * the earlier spot); a spot must hold the whole stack above the launcher bar (P3 E3). None → the
 * top row (the runtime collapses toasts into "+N more").
 */
export function dmStackPlacement(
  vp: Viewport,
  initiative: Rect | null,
  stackH: number,
  width = STACK_W,
  avoid: readonly TokenBox[] = [],
  windows: readonly Rect[] = [],
): { left: number; top: number } {
  const base = initiativeKeepOut(vp, initiative, stackH, width);
  // P3 E3: a spot must hold the whole stack above the launcher bar.
  const fits = (p: { top: number }) => p.top + stackH <= vp.h - LAUNCHER_CLEAR;
  if (stackH === 0 || (avoid.length === 0 && windows.length === 0 && fits(base))) return base;
  const bars = windows.map((w) => ({ ...w, h: Math.min(w.h, TITLE_H) }));
  const at = (p: { left: number; top: number }) => ({ x: p.left, y: p.top, w: width, h: stackH });
  const clear = (p: { left: number; top: number }) =>
    !(initiative && hits(at(p), initiative, EDGE_GAP)) && !bars.some((b) => hits(at(p), b, 0));
  const maxLeft = vp.w - EDGE_GAP - width;
  const maxTop = vp.h - LAUNCHER_CLEAR - stackH;
  const lefts = [
    Math.round((vp.w - width) / 2),
    RAIL_CLEAR,
    initiative ? initiative.x - EDGE_GAP - width : maxLeft,
    ...windows.flatMap((w) => [w.x + w.w + EDGE_GAP, w.x - EDGE_GAP - width]),
    ...avoid.flatMap((t) => [t.x + t.w + EDGE_GAP, t.x - EDGE_GAP - width]),
  ].map((x) => Math.round(Math.min(maxLeft, Math.max(RAIL_CLEAR, x))));
  const tops = [
    DM_TOAST_TOP,
    ...bars.map((b) => b.y + b.h + STACK_GAP),
    ...windows.map((w) => w.y + w.h + STACK_GAP),
    ...avoid.flatMap((t) => [t.y + t.h + EDGE_GAP, t.y - EDGE_GAP - stackH]),
  ].map((y) => Math.round(Math.max(DM_TOAST_TOP, Math.min(maxTop, y))));
  const spots = [base, ...tops.flatMap((top) => lefts.map((left) => ({ left, top })))];
  let best: { left: number; top: number } | null = null;
  let bestArea = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  for (const p of spots) {
    if (!clear(p) || !fits(p)) continue;
    const area = [coveredArea(at(p), avoid), coveredArea(at(p), windows)];
    const [a0 = 0, a1 = 0] = area;
    const [b0 = 0, b1 = 0] = bestArea;
    // Strictly less wins: ties keep the earlier spot (FR-NOTE-32's first).
    if (a0 < b0 || (a0 === b0 && a1 < b1)) {
      best = p;
      bestArea = area;
    }
  }
  // Nothing holds it (the runtime then shows fewer toasts): the top row, clear if possible.
  return best ?? spots.find((p) => p.top === DM_TOAST_TOP && clear(p)) ?? base;
}
