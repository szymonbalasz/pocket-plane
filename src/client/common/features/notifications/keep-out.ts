// FR-NOTE-32 (sprint-1 leftover): the DM's toast stack keeps clear of an open, non-minimised
// `cbt.initiative` window (its rendered rect from play-shell, grown height included: Undo and
// footer too). Default top-centre (#149); overlapping → shifted left with a 12 px gap; no room
// left of it → below its bottom edge. P3 glitch 2: then, of the spots clear of Initiative, the one
// covering the least of the toasts' tokens to avoid (a card's likely targets) wins; ties keep the
// default. Window title bars are never covered, their bodies only when no spot clear of them is
// (sim-6 glitch 3). FR-NOTE-42 (sim-9 a01): the stack stays in its top-centre band (home, or the
// left-of-Initiative shift) and moves down, never to the rail or beside windows / tokens.
// FR-NOTE-43 (sim-9 b01): hard keep-outs (the active tool bar) block it like Initiative.
// FR-NOTE-44 (sim-10 b05): while a tool bar is shown (the windows it pushed among them), every
// window's title bar and first 40 px of body block it too. FR-NOTE-53 (sprint 8): "pushed" comes
// from the placer's plan (`StackWindow.pushed`). Walkthrough WF4 (DM ruling): the stack never
// covers a window's controls when it can help it: a spot clear of every window body in the band
// (down, FR-NOTE-42) first, else beside a window over the home column (left, then right, like
// Initiative's shift), else the runtime folds toasts into "+N more" (`dmStackSpot().covers`);
// only then the least window body. Pure; players keep bottom-right.

import { type FirstRow, firstRows } from "../play-shell/content-heights";
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

/** FR-NOTE-44: body px under a pushed window's title bar kept clear. */
export const PUSHED_BODY_CLEAR = 40;

/**
 * A window as the stack sees it: its rendered rect and (FR-NOTE-53) whether the placer's plan
 * has it pushed by a tool bar (`data-placed` `pushed`, or `displaced` with a `toolbar` cause).
 * `pushed` absent (a caller without the plan): pushed while a hard keep-out shows (FR-NOTE-44).
 */
export type StackWindow = Rect & { pushed?: boolean };

/** FR-NOTE-53: the plan's "pushed": `pushed`, or `displaced` by a tool bar. */
export function pushedByPlan(placed: string | undefined, causes: readonly string[]): boolean {
  if (placed === "pushed") return true;
  return placed === "displaced" && causes.some((c) => c.startsWith("toolbar:"));
}

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
 * FR-NOTE-42: the stack's only candidate lefts: its home (centred), then FR-NOTE-32's shift left
 * of Initiative when that is left of home and clear of the rail (never x = 68 by clamping).
 */
export function dmStackLefts(
  vp: Viewport,
  initiative: Rect | null,
  width = STACK_W,
  /** Walkthrough WF4: also beside these windows when they are over the home column. */
  windows: readonly Rect[] = [],
): number[] {
  const home = Math.round((vp.w - width) / 2);
  const out = [home];
  if (initiative) {
    const shifted = Math.round(initiative.x - EDGE_GAP - width);
    if (shifted < home && shifted >= RAIL_CLEAR) out.push(shifted);
  }
  // Walkthrough WF4: a window over the home column → beside it, left then right.
  for (const w of windows) {
    if (!(w.x < home + width + EDGE_GAP && home - EDGE_GAP < w.x + w.w)) continue;
    const left = Math.round(w.x - EDGE_GAP - width);
    const right = Math.round(w.x + w.w + EDGE_GAP);
    if (left >= RAIL_CLEAR) out.push(left);
    if (right + width <= vp.w - EDGE_GAP) out.push(right);
  }
  return [...new Set(out)];
}

const hits = (a: Rect, b: Rect, gap: number) =>
  a.x < b.x + b.w + gap && b.x - gap < a.x + a.w && a.y < b.y + b.h + gap && b.y - gap < a.y + a.h;

/**
 * `stackH`: the stack's measured height (0 before the first measure). `avoid`: on-screen boxes of
 * the tokens the stack should keep clear of (P3 glitch 2). `windows`: the other open windows'
 * rendered rects; their title bars are never covered (P3 retest: the drag handle stays
 * reachable), their bodies only when no spot clear of them is (sim-6 glitch 3: the stack sat on
 * the Notifications rows). `hard`: hard keep-out rects (FR-NOTE-43: the active tool bar), never
 * covered; while one is (a tool bar pushed windows, FR-NOTE-44), each window's title bar, first
 * 40 px of body and first content row (`rows`: `ShellWindow`'s reports) are never covered either. Candidate spots (FR-NOTE-42): FR-NOTE-32's first, then the top row, below each title
 * bar, below each window, below each hard keep-out and above / below each token, at the home or
 * left of Initiative only. Of the spots clear of Initiative, the bars and the hard keep-outs, the
 * one covering the least token area, then the least window body, wins (ties keep the earlier
 * spot); a spot must hold the whole stack above the launcher bar (P3 E3). None → the top row
 * when clear, else FR-NOTE-32's spot, off the hard keep-outs where one is (the runtime collapses
 * toasts into "+N more").
 */
export function dmStackPlacement(
  vp: Viewport,
  initiative: Rect | null,
  stackH: number,
  width = STACK_W,
  avoid: readonly TokenBox[] = [],
  windows: readonly StackWindow[] = [],
  hard: readonly Rect[] = [],
  rows: readonly FirstRow[] = [...firstRows().values()],
): { left: number; top: number } {
  const { left, top } = dmStackSpot(vp, initiative, stackH, width, avoid, windows, hard, rows);
  return { left, top };
}

/**
 * `dmStackPlacement` and what its spot covers of the windows' bodies, px² (`covers` > 0: no spot
 * clear of every window held this stack; walkthrough WF4: the runtime then shows fewer toasts).
 */
export function dmStackSpot(
  vp: Viewport,
  initiative: Rect | null,
  stackH: number,
  width = STACK_W,
  avoid: readonly TokenBox[] = [],
  windows: readonly StackWindow[] = [],
  hard: readonly Rect[] = [],
  rows: readonly FirstRow[] = [...firstRows().values()],
): { left: number; top: number; covers: number } {
  const covers = (p: { left: number; top: number }) =>
    stackH === 0 ? 0 : coveredArea({ x: p.left, y: p.top, w: width, h: stackH }, windows);
  const run = (lefts: number[]) => {
    const p = dmStackSpotOnly(vp, initiative, stackH, width, avoid, windows, hard, rows, lefts);
    return { ...p, covers: covers(p) };
  };
  // FR-NOTE-42: down within the band first; walkthrough WF4: aside only when that clears every
  // window body (else the home rules, and the runtime folds toasts while it covers one).
  const home = run(dmStackLefts(vp, initiative, width));
  if (home.covers === 0) return home;
  const aside = run(dmStackLefts(vp, initiative, width, windows));
  return aside.covers === 0 ? aside : home;
}

function dmStackSpotOnly(
  vp: Viewport,
  initiative: Rect | null,
  stackH: number,
  width: number,
  avoid: readonly TokenBox[],
  windows: readonly StackWindow[],
  hard: readonly Rect[],
  rows: readonly FirstRow[],
  lefts: readonly number[],
): { left: number; top: number } {
  const base = initiativeKeepOut(vp, initiative, stackH, width);
  const at = (p: { left: number; top: number }) => ({ x: p.left, y: p.top, w: width, h: stackH });
  // FR-NOTE-43: ≥ 1 px over a hard keep-out is not clear.
  const offHard = (p: { left: number; top: number }) => !hard.some((k) => hits(at(p), k, 0));
  // P3 E3: a spot must hold the whole stack above the launcher bar.
  const fits = (p: { top: number }) => p.top + stackH <= vp.h - LAUNCHER_CLEAR;
  if (stackH === 0) return base;
  if (avoid.length === 0 && windows.length === 0 && fits(base) && offHard(base)) return base;
  // FR-NOTE-44: a pushed window's title bar, first 40 px of body and first content row (its
  // reported bottom, walkthrough U4) count as its bar; FR-NOTE-53: pushed per the plan.
  const strip = (w: StackWindow) => {
    if (!(w.pushed ?? hard.length > 0)) return TITLE_H;
    const row = rows.find((r) => Math.abs(r.x - w.x) <= 1 && Math.abs(r.y - w.y) <= 1);
    return Math.max(TITLE_H + PUSHED_BODY_CLEAR, row ? row.bottom - w.y : 0);
  };
  const bars = windows.map((w) => ({ ...w, h: Math.min(w.h, strip(w)) }));
  const clear = (p: { left: number; top: number }) =>
    !(initiative && hits(at(p), initiative, EDGE_GAP)) &&
    !bars.some((b) => hits(at(p), b, 0)) &&
    offHard(p);
  const maxTop = vp.h - LAUNCHER_CLEAR - stackH;
  const tops = [
    DM_TOAST_TOP,
    ...bars.map((b) => b.y + b.h + STACK_GAP),
    ...windows.map((w) => w.y + w.h + STACK_GAP),
    ...hard.map((k) => k.y + k.h + STACK_GAP),
    ...avoid.flatMap((t) => [t.y + t.h + EDGE_GAP, t.y - EDGE_GAP - stackH]),
  ].map((y) => Math.round(Math.max(DM_TOAST_TOP, Math.min(maxTop, y))));
  // Nearest the home row first (ties keep the earlier spot).
  const byTop = [...new Set(tops)].sort((a, b) => a - b);
  const spots = [base, ...byTop.flatMap((top) => lefts.map((left) => ({ left, top })))];
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
  // Nothing holds it (the runtime then shows fewer toasts): the top row when clear, else
  // FR-NOTE-32's spot, else the top row, each only off the hard keep-outs (FR-NOTE-43).
  const row = spots.filter((p) => p.top === DM_TOAST_TOP);
  return best ?? row.find(clear) ?? [base, ...row].find(offHard) ?? base;
}
