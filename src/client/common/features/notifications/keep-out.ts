// FR-NOTE-32 (sprint-1 leftover): the DM's toast stack keeps clear of an open, non-minimised
// `cbt.initiative` window (its rendered rect from play-shell, grown height included: Undo and
// footer too). Default top-centre (#149); overlapping → shifted left with a 12 px gap; no room
// left of it → below its bottom edge. P3 glitch 2: then, of the spots clear of Initiative, the one
// covering the least of the toasts' tokens to avoid (a card's likely targets) wins; ties keep the
// default. Pure; players keep bottom-right.

import { EDGE_GAP, type Rect, type Viewport } from "../play-shell/geometry";
import { RAIL_CLEAR } from "../play-shell/placement";
import { DM_TOAST_TOP } from "../play-shell/toast-region";
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

/**
 * `stackH`: the stack's measured height (0 before the first measure). `avoid`: on-screen boxes of
 * the tokens the stack should keep clear of (P3 glitch 2); none → FR-NOTE-32's spot.
 */
export function dmStackPlacement(
  vp: Viewport,
  initiative: Rect | null,
  stackH: number,
  width = STACK_W,
  avoid: readonly TokenBox[] = [],
): { left: number; top: number } {
  const base = initiativeKeepOut(vp, initiative, stackH, width);
  if (avoid.length === 0 || stackH === 0) return base;
  const at = (p: { left: number; top: number }) => ({ x: p.left, y: p.top, w: width, h: stackH });
  const clear = (p: { left: number; top: number }) =>
    !initiative ||
    !(
      p.left < initiative.x + initiative.w + EDGE_GAP &&
      initiative.x - EDGE_GAP < p.left + width &&
      initiative.y < p.top + stackH + EDGE_GAP &&
      initiative.y + initiative.h + EDGE_GAP > p.top
    );
  const maxLeft = vp.w - EDGE_GAP - width;
  const lefts = [
    RAIL_CLEAR,
    initiative ? initiative.x - EDGE_GAP - width : maxLeft,
    ...avoid.flatMap((t) => [t.x + t.w + EDGE_GAP, t.x - EDGE_GAP - width]),
  ].map((x) => Math.round(Math.min(maxLeft, Math.max(RAIL_CLEAR, x))));
  let best = base;
  let bestArea = coveredArea(at(base), avoid);
  for (const left of lefts) {
    const p = { left, top: DM_TOAST_TOP };
    if (!clear(p)) continue;
    const area = coveredArea(at(p), avoid);
    // Strictly less wins: ties keep the default spot.
    if (area < bestArea) {
      best = p;
      bestArea = area;
    }
  }
  return best;
}
