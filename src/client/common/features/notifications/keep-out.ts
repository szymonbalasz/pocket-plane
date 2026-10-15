// FR-NOTE-32 (sprint-1 leftover): the DM's toast stack keeps clear of an open, non-minimised
// `cbt.initiative` window (its rendered rect from play-shell, grown height included: Undo and
// footer too). Default top-centre (#149); overlapping → shifted left with a 12 px gap; no room
// left of it → below its bottom edge. Pure; players keep bottom-right.
import { EDGE_GAP, type Rect, type Viewport } from "../play-shell/geometry";
import { RAIL_CLEAR } from "../play-shell/placement";
import { DM_TOAST_TOP } from "../play-shell/toast-region";

/** The stack's width, px (`w-80`). */
export const STACK_W = 320;

/** `stackH`: the stack's measured height (0 before the first measure). */
export function dmStackPlacement(
  vp: Viewport,
  initiative: Rect | null,
  stackH: number,
  width = STACK_W,
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
