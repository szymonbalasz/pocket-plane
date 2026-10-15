// FR-NOTE-32 (sprint-1 leftover): the DM's toast stack keeps clear of an open, non-minimised
// `cbt.initiative` window (its rendered rect from play-shell, grown height included: Undo and
// footer too). Default top-centre (#149); overlapping → shifted left with a 12 px gap; no room
// left of it → below its bottom edge. P3 glitch 2: then, of the spots clear of Initiative, the one
// covering the least of the toasts' tokens to avoid (a card's likely targets) wins; ties keep the
// default. Window title bars are never covered. Pure; players keep bottom-right.

import { EDGE_GAP, LAUNCHER_CLEAR, type Rect, type Viewport } from "../play-shell/geometry";
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
 * the tokens the stack should keep clear of (P3 glitch 2). `bars`: open windows' title bars,
 * never covered (P3 retest: their drag handle stays reachable). Candidate spots: FR-NOTE-32's
 * first, then the top row and below each title bar, at the centre, the left edge, left of
 * Initiative and beside each token; the first spot clear of Initiative and the bars that covers
 * the least token area wins (ties keep the earlier spot); a spot must hold the whole stack above
 * the launcher bar (P3 E3). None → the top row (the runtime collapses toasts into "+N more").
 */
export function dmStackPlacement(
  vp: Viewport,
  initiative: Rect | null,
  stackH: number,
  width = STACK_W,
  avoid: readonly TokenBox[] = [],
  bars: readonly Rect[] = [],
): { left: number; top: number } {
  const base = initiativeKeepOut(vp, initiative, stackH, width);
  // P3 E3: a spot must hold the whole stack above the launcher bar.
  const fits = (p: { top: number }) => p.top + stackH <= vp.h - LAUNCHER_CLEAR;
  if (stackH === 0 || (avoid.length === 0 && bars.length === 0 && fits(base))) return base;
  const at = (p: { left: number; top: number }) => ({ x: p.left, y: p.top, w: width, h: stackH });
  const clear = (p: { left: number; top: number }) =>
    !(initiative && hits(at(p), initiative, EDGE_GAP)) && !bars.some((b) => hits(at(p), b, 0));
  const maxLeft = vp.w - EDGE_GAP - width;
  const lefts = [
    Math.round((vp.w - width) / 2),
    RAIL_CLEAR,
    initiative ? initiative.x - EDGE_GAP - width : maxLeft,
    ...avoid.flatMap((t) => [t.x + t.w + EDGE_GAP, t.x - EDGE_GAP - width]),
  ].map((x) => Math.round(Math.min(maxLeft, Math.max(RAIL_CLEAR, x))));
  const tops = [DM_TOAST_TOP, ...bars.map((b) => Math.round(b.y + b.h + STACK_GAP))];
  const spots = [base, ...tops.flatMap((top) => lefts.map((left) => ({ left, top })))];
  let best: { left: number; top: number } | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const p of spots) {
    if (!clear(p) || !fits(p)) continue;
    const area = coveredArea(at(p), avoid);
    // Strictly less wins: ties keep the earlier spot (FR-NOTE-32's first).
    if (area < bestArea) {
      best = p;
      bestArea = area;
    }
  }
  // Nothing holds it (the runtime then shows fewer toasts): the top row, clear if possible.
  return best ?? spots.find((p) => p.top === DM_TOAST_TOP && clear(p)) ?? base;
}
