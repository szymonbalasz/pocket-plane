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
// (down, FR-NOTE-42) first, else the runtime folds toasts into "+N more" (`dmStackSpot().covers`).
// *(Sprint 9)* FR-NOTE-70 (BL-83): the lefts are home and the left-of shift only (WF4's "beside a
// window" lefts are gone; the shift keeps 12 px to the rail). FR-NOTE-71 (BL-75): no body-clear
// spot → the clear spot nearest the home row, not the least body. FR-NOTE-72 (BL-88): an open
// Notifications window counts like Initiative (`StackWindow.blocks`). Ruling B (#339 follow-up,
// amends FR-NOTE-53): every window's title bar + first 40 px keep the stack off while some spot
// clears them all; none does → FR-NOTE-71 as before. *(Sprint 10, H3)* FR-NOTE-75 (BL-101): first
// a spot clear of every window's drawn content (`StackWindow.used`; the empty body below it is
// fine), then one clear of every window's first rows (title bar + 40 px, or to its first record
// row: tabs, search box, list header, first row), then ruling B and the title bars as before.
// FR-NOTE-76: an open modal dialog counts like Initiative (shift left of it, else below or above
// it); what is under its overlay (windows, Initiative, tool bars, tokens) is inert and ignored.
// FR-NOTE-77 (walkthrough H3): no spot in the column clears the windows' content → the stack slides
// sideways beside a window, at most half its width (it stays in its band, #288), to a spot that
// covers no window, PC or card target, before it takes "below the first row"; none → over a body,
// the fewest controls first. First rows are the window's own measure (`head`), so a record
// container filling the body (the Encounters editor) isn't its "first row". *(Sprint 11, F2)*
// FR-NOTE-78 (BL-108): over a body, the fallback keeps off each window's primary parts first (its
// headings and first record; a log's newest rows), then the fewest controls and other records;
// an open non-modal popup (the damage-card popup) blocks like Initiative and, when nothing clears
// it, the stack folds over its fewest controls. *(Sprint 12, X1)* BL-119: then off the other
// records' headings (every Roll requests card's title line, not only the newest card's).
// Pure; players keep bottom-right.

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

/**
 * FR-NOTE-79 (BL-141): the compact summary's width, px: the fold's last step when the summary
 * alone covers a window's content or a modal dialog; placed by the same rules at this width.
 */
export const COMPACT_W = 200;

/** FR-NOTE-44: body px under a pushed window's title bar kept clear. */
export const PUSHED_BODY_CLEAR = 40;

/**
 * A window as the stack sees it: its rendered rect and (FR-NOTE-53) whether the placer's plan
 * has it pushed by a tool bar (`data-placed` `pushed`, or `displaced` with a `toolbar` cause).
 * `pushed` absent (a caller without the plan): pushed while a hard keep-out shows (FR-NOTE-44).
 */
export type StackWindow = Rect & {
  pushed?: boolean;
  /** FR-NOTE-72: counts like Initiative (this client's open Notifications window). */
  blocks?: boolean;
  /**
   * FR-NOTE-75: viewport y where the window's drawn content ends (below it: empty body). Absent
   * (not measured): the whole window counts as content.
   */
  used?: number;
  /**
   * FR-NOTE-77: viewport y where the window's first rows end (tabs, search box, the first record
   * row that is row-sized), measured; absent → the frame's first-row report.
   */
  head?: number;
  /** FR-NOTE-77: the window body's controls as drawn (buttons, inputs, tabs…), viewport px. */
  controls?: readonly Rect[];
  /**
   * FR-NOTE-77 (re-test 3): a log's newest rows as drawn (the Game log: newest at the bottom,
   * what the DM reads first); they count like controls.
   */
  logRows?: readonly Rect[];
  /**
   * FR-NOTE-78 (BL-108): the window's primary parts as drawn: its headings and its first record
   * (the first row-sized record that isn't a control); the fallback keeps off them first.
   */
  primary?: readonly Rect[];
  /** FR-NOTE-78: its other row-sized records as drawn; they count like controls. */
  records?: readonly Rect[];
  /**
   * BL-119 (sim-15 glitch 2): those records' headings as drawn (an older Roll requests card's
   * title line); after the fewest controls, the fallback covers the fewest of them.
   */
  headings?: readonly Rect[];
};

/** FR-NOTE-75: the window's content part (title bar to `used`; unknown → all of it). */
const contentOf = (w: StackWindow): Rect => ({
  x: w.x,
  y: w.y,
  w: w.w,
  h: w.used === undefined ? w.h : Math.max(TITLE_H, Math.min(w.h, w.used - w.y)),
});

/** FR-NOTE-70: the smallest left a shift may take (12 px clear of the rail, never x 68). */
export const MIN_SHIFT_LEFT = RAIL_CLEAR + EDGE_GAP;

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
  if (shifted >= MIN_SHIFT_LEFT) return { left: Math.min(left, shifted), top };
  return { left, top: Math.round(initiative.y + initiative.h + EDGE_GAP) };
}

/**
 * FR-NOTE-42, -70: the stack's only candidate lefts: its home (centred), then FR-NOTE-32's shift
 * left of Initiative and of each window that counts like it (FR-NOTE-72: `blocks`), when that is
 * left of home and leaves 12 px to the rail (`MIN_SHIFT_LEFT`). Never beside any other window.
 */
export function dmStackLefts(
  vp: Viewport,
  initiative: Rect | null,
  width = STACK_W,
  /** FR-NOTE-72: windows that count like Initiative (others are ignored). */
  windows: readonly StackWindow[] = [],
): number[] {
  const home = Math.round((vp.w - width) / 2);
  const out = [home];
  for (const b of [initiative, ...windows.filter((w) => w.blocks)]) {
    if (!b) continue;
    const shifted = Math.round(b.x - EDGE_GAP - width);
    if (shifted < home && shifted >= MIN_SHIFT_LEFT) out.push(shifted);
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
 * 40 px of body and first content row (`rows`: `ShellWindow`'s reports) are never covered
 * either. Candidate spots (FR-NOTE-42): FR-NOTE-32's first, then the top row, below each title
 * bar, below each window, below each hard keep-out and above / below each token, at the home or
 * the left-of shift only (FR-NOTE-70). Of the spots clear of Initiative (and windows that count
 * like it), the bars and the hard keep-outs, one over no window body wins, the least token area
 * first; none → the one nearest the home row (FR-NOTE-71); ties keep the earlier spot. A spot
 * must hold the whole stack above the launcher bar (P3 E3). None → the top row
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
  dialogs: readonly Rect[] = [],
  pcs: readonly Rect[] = [],
  popups: readonly StackWindow[] = [],
): { left: number; top: number } {
  const { left, top } = dmStackSpot(
    vp,
    initiative,
    stackH,
    width,
    avoid,
    windows,
    hard,
    rows,
    dialogs,
    pcs,
    popups,
  );
  return { left, top };
}

/**
 * `dmStackPlacement` and what its spot covers of the windows' content, px² (`covers` > 0: no spot
 * clear of every window's content held this stack; walkthrough WF4, FR-NOTE-70: the runtime then
 * shows fewer toasts, never beside a window; FR-NOTE-75: empty body below the content is free).
 * `dialogs` (FR-NOTE-76): the open modal dialogs' rects; while any is open only they count.
 * `pcs` (FR-NOTE-77): the PC tokens' footprints + 4 px; a spot beside a window never covers one.
 * `popups` (FR-NOTE-78): open non-modal popups (the damage-card popup) with their controls; they
 * block like Initiative, count in `covers` (the runtime folds) and, when no spot clears them, the
 * stack takes the one over their fewest controls.
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
  dialogs: readonly Rect[] = [],
  pcs: readonly Rect[] = [],
  popups: readonly StackWindow[] = [],
): { left: number; top: number; covers: number } {
  if (dialogs.length > 0) {
    // FR-NOTE-76: under a modal dialog's overlay nothing else takes input; the dialogs count
    // like Initiative (the left-of shift, below or above them).
    const modal = dialogs.map((d) => ({ ...d, blocks: true }));
    return dmStackSpot(vp, null, stackH, width, [], modal, [], []);
  }
  // FR-NOTE-78: a popup's shift left of it is a candidate left like Initiative's.
  const blocking = popups.map((w) => ({ ...w, blocks: true }));
  const lefts = dmStackLefts(vp, initiative, width, [...windows, ...blocking]);
  const p = dmStackSpotOnly(
    vp,
    initiative,
    stackH,
    width,
    avoid,
    windows,
    hard,
    rows,
    lefts,
    pcs,
    popups,
  );
  // FR-NOTE-70: `covers` > 0 (no spot in the column clears every window's content) → the
  // runtime folds. FR-NOTE-75: the empty body below a window's content doesn't count.
  // FR-NOTE-78: a popup counts whole.
  const covers =
    stackH === 0
      ? 0
      : coveredArea({ x: p.left, y: p.top, w: width, h: stackH }, [
          ...windows.map(contentOf),
          ...popups,
        ]);
  return { ...p, covers };
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
  pcs: readonly Rect[],
  popups: readonly StackWindow[],
): { left: number; top: number } {
  const base = initiativeKeepOut(vp, initiative, stackH, width);
  const at = (p: { left: number; top: number }) => ({ x: p.left, y: p.top, w: width, h: stackH });
  // FR-NOTE-43: ≥ 1 px over a hard keep-out is not clear.
  const offHard = (p: { left: number; top: number }) => !hard.some((k) => hits(at(p), k, 0));
  // P3 E3: a spot must hold the whole stack above the launcher bar.
  const fits = (p: { top: number }) => p.top + stackH <= vp.h - LAUNCHER_CLEAR;
  if (stackH === 0) return base;
  if (
    avoid.length === 0 &&
    windows.length === 0 &&
    popups.length === 0 &&
    fits(base) &&
    offHard(base)
  )
    return base;
  // FR-NOTE-44: a pushed window's title bar, first 40 px of body and first content row (its
  // reported bottom, walkthrough U4) count as its bar; FR-NOTE-53: pushed per the plan.
  // FR-NOTE-77: the window's own first-row measure (`head`) when drawn, else the frame's report.
  const rowOf = (w: StackWindow) => {
    const reported = rows.find((r) => Math.abs(r.x - w.x) <= 1 && Math.abs(r.y - w.y) <= 1);
    const bottom = w.head ?? reported?.bottom;
    return Math.max(TITLE_H + PUSHED_BODY_CLEAR, bottom === undefined ? 0 : bottom - w.y);
  };
  const pushed = (w: StackWindow) => w.pushed ?? hard.length > 0;
  // The strips kept clear, pass by pass (each one's strips inside the one before):
  // FR-NOTE-75: every window's drawn content (the empty body below it is fine), then every
  // window's first rows; sprint 9 ruling B (amends FR-NOTE-53): title bar + 40 px (pushed: its
  // first rows); then the title bars alone (pushed: its first rows).
  const passes: ((w: StackWindow) => number)[] = [
    (w) => Math.max(contentOf(w).h, rowOf(w)),
    rowOf,
    (w) => (pushed(w) ? rowOf(w) : TITLE_H + PUSHED_BODY_CLEAR),
    (w) => (pushed(w) ? rowOf(w) : TITLE_H),
  ];
  const bars = passes.map((strip) => windows.map((w) => ({ ...w, h: Math.min(w.h, strip(w)) })));
  // FR-NOTE-72: an open Notifications window keeps the stack off like Initiative.
  // FR-NOTE-78: so does an open non-modal popup (the damage-card popup), whole.
  const fixed = [...(initiative ? [initiative] : []), ...windows.filter((w) => w.blocks)];
  const blockers = [...fixed, ...popups];
  const maxTop = vp.h - LAUNCHER_CLEAR - stackH;
  const clamp = (ys: number[]) =>
    ys.map((y) => Math.round(Math.max(DM_TOAST_TOP, Math.min(maxTop, y))));
  const clearIn = (pass: number, p: { left: number; top: number }) =>
    !blockers.some((b) => hits(at(p), b, EDGE_GAP)) &&
    !(bars[pass] ?? []).some((b) => hits(at(p), b, 0)) &&
    offHard(p);
  const topsIn = (pass: number) =>
    clamp([
      DM_TOAST_TOP,
      ...(bars[pass] ?? []).map((b) => b.y + b.h + STACK_GAP),
      ...windows.map((w) => w.y + w.h + STACK_GAP),
      ...hard.map((k) => k.y + k.h + STACK_GAP),
      // FR-NOTE-72: below a window that counts like Initiative, with its 12 px gap; FR-NOTE-76:
      // above it too (a modal dialog low in the column).
      ...blockers.flatMap((b) => [b.y + b.h + EDGE_GAP, b.y - EDGE_GAP - stackH]),
      ...avoid.flatMap((t) => [t.y + t.h + EDGE_GAP, t.y - EDGE_GAP - stackH]),
      // FR-NOTE-78: off a window's primary parts (below or above each heading and first record;
      // not between its other records: walkthrough H3 4 keeps the home row over Encounters'
      // name fields rather than a gap lower in its form).
      ...windows.flatMap((w) =>
        (w.primary ?? []).flatMap((r) => [r.y + r.h + STACK_GAP, r.y - STACK_GAP - stackH]),
      ),
      // BL-119: and below or above each record heading (over the older card's rows).
      ...windows.flatMap((w) =>
        (w.headings ?? []).flatMap((r) => [r.y + r.h + STACK_GAP, r.y - STACK_GAP - stackH]),
      ),
    ]);
  // Nearest the home row first (ties keep the earlier spot): FR-NOTE-32's spot, then by top.
  const spotsAt = (tops: number[], ls: readonly number[]) => [
    base,
    ...[...new Set(tops)].sort((a, b) => a - b).flatMap((top) => ls.map((left) => ({ left, top }))),
  ];
  // FR-NOTE-71: a spot over no window body wins (the least token area, then the earlier spot);
  // none → the one nearest the home row, never a thin overlap low on a window (BL-75).
  // FR-NOTE-77: before that, the fewest window controls under it, then the stricter pass.
  // FR-NOTE-78 (BL-108): first of all the fewest primary parts (headings, first records, a log's
  // newest rows); other records count like controls. BL-119: then the fewest record headings.
  const pick = (spots: { left: number; top: number }[], level: (p: Spot) => number | null) => {
    let best: Spot | null = null;
    let bestKey: number[] = [];
    for (const p of spots) {
      const pass = fits(p) ? level(p) : null;
      if (pass === null) continue;
      const body = coveredArea(at(p), windows) > 0;
      // Pass 1 (content-clear): K12 (kit round 3, DM #363): a spot over no window at all first
      // (FR-NOTE-71's body-clear rank; re-test 3 O2's "empty body is as good as the map" only
      // among the rest), then nearest home, the least token area first; later passes: FR-NOTE-71.
      const r = at(p);
      const key =
        pass === 0
          ? [
              primaryUnder(r, windows),
              controlsUnder(r, windows),
              headingsUnder(r, windows),
              0,
              body ? 1 : 0,
              coveredArea(r, avoid),
            ]
          : [
              primaryUnder(r, windows),
              controlsUnder(r, windows),
              headingsUnder(r, windows),
              pass,
              body ? 1 : 0,
              body ? p.top : coveredArea(r, avoid),
            ];
      // Strictly less wins: ties keep the earlier spot.
      if (best === null || less(key, bestKey)) {
        best = p;
        bestKey = key;
      }
    }
    return best;
  };
  // 1. FR-NOTE-75: in the column, clear of every window's drawn content. K12 (kit round 3, DM
  // #363: toasts off windows where a clear spot exists): a spot over no window wins outright;
  // one over a window's empty body waits for the slide.
  const content = pick(spotsAt(topsIn(0), lefts), (p) => (clearIn(0, p) ? 0 : null));
  const clear = content && coveredArea(at(content), windows) === 0 ? content : null;
  // 2. FR-NOTE-77: beside a window, clear of every window, the PCs and the cards' targets.
  const found = besideSpot(vp, width, stackH, windows, initiative, hard, blockers, avoid, pcs);
  const beside = found && fits(found) && lefts.every((l) => l !== found.left) ? found : null;
  // K12: both clear → the nearer home (`besideSpot`'s measure), so a summary and a card stack
  // that both fit beside a window take the same spot (re-test 3 O2), not one far down the column.
  if (clear && beside)
    return homeDistance(vp, width, beside) < homeDistance(vp, width, clear) ? beside : clear;
  if (clear ?? beside) return (clear ?? beside) as Spot;
  // 2b. DM #364 (amends #288): no clear spot within the half-width slide → a slide further left,
  // still on no window, PC, card target or keep-out (the rail kept clear).
  const far = besideSpot(vp, width, stackH, windows, initiative, hard, blockers, avoid, pcs, true);
  if (far && fits(far) && lefts.every((l) => l !== far.left)) return far;
  // 1b. No clear spot: over the empty body below a window's content (pass 1, nearest home).
  if (content) return content;
  // 3. Over a body, in the column: the first rows kept (FR-NOTE-75), then ruling B, then the
  // title bars; the fewest controls covered first (FR-NOTE-77).
  // A spot counts for a pass only at that pass's own tops (8 px below its strips).
  const fallback = [1, 2, 3].map((pass) => ({ pass, tops: new Set(topsIn(pass)) }));
  const tops = fallback.flatMap((f) => [...f.tops]);
  const level = (p: Spot) =>
    fallback.find((f) => (p === base || f.tops.has(p.top)) && clearIn(f.pass, p))?.pass ?? null;
  const best = pick(spotsAt(tops, lefts), level);
  if (best) return best;
  // FR-NOTE-78: no spot clears a popup → the runtime folds (`covers`); the stack takes the spot
  // over the popups' fewest controls, then the least popup area, still clear of Initiative,
  // Notifications, the title bars and the hard keep-outs; nearest home on a tie.
  if (popups.length > 0) {
    let over: Spot | null = null;
    let overKey: number[] = [];
    // Between the popups' controls too (above or below each).
    const between = popups.flatMap((w) =>
      (w.controls ?? []).flatMap((c) => [c.y + c.h + STACK_GAP, c.y - STACK_GAP - stackH]),
    );
    for (const p of spotsAt([...tops, ...clamp(between)], lefts)) {
      if (!fits(p) || !offHard(p) || fixed.some((b) => hits(at(p), b, EDGE_GAP))) continue;
      if ((bars[3] ?? []).some((b) => hits(at(p), b, 0))) continue;
      const key = [controlsUnder(at(p), popups), coveredArea(at(p), popups)];
      if (over === null || less(key, overKey)) {
        over = p;
        overKey = key;
      }
    }
    if (over) return over;
  }
  // Nothing holds it (the runtime then shows fewer toasts): the top row when clear, else
  // FR-NOTE-32's spot, else the top row, each only off the hard keep-outs (FR-NOTE-43).
  const row = spotsAt([DM_TOAST_TOP], lefts).filter((p) => p.top === DM_TOAST_TOP);
  return row.find((p) => clearIn(3, p)) ?? [base, ...row].find(offHard) ?? base;
}

type Spot = { left: number; top: number };

const less = (a: readonly number[], b: readonly number[]) => {
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
};

/** How many of `parts(w)` over all `windows` `r` overlaps. */
function partsUnder(
  r: Rect,
  windows: readonly StackWindow[],
  parts: (w: StackWindow) => readonly (readonly Rect[] | undefined)[],
): number {
  let n = 0;
  for (const w of windows) {
    for (const list of parts(w)) for (const c of list ?? []) if (hits(r, c, 0)) n++;
  }
  return n;
}

/**
 * FR-NOTE-78 (BL-108): how many of the windows' primary parts `r` overlaps: their headings and
 * first records, and a log's newest rows (FR-NOTE-77 re-test 3: what the DM reads first).
 */
const primaryUnder = (r: Rect, windows: readonly StackWindow[]) =>
  partsUnder(r, windows, (w) => [w.primary, w.logRows]);

/**
 * FR-NOTE-77: how many of the windows' other key parts `r` overlaps: their controls and
 * (FR-NOTE-78) their other records.
 */
const controlsUnder = (r: Rect, windows: readonly StackWindow[]) =>
  partsUnder(r, windows, (w) => [w.controls, w.records]);

/** BL-119: how many of the windows' record headings `r` overlaps (an older card's title line). */
const headingsUnder = (r: Rect, windows: readonly StackWindow[]) =>
  partsUnder(r, windows, (w) => [w.headings]);

/** FR-NOTE-77: a spot's distance from home (the home row, centred): sideways + down, px. */
const homeDistance = (vp: Viewport, width: number, p: Spot) =>
  Math.abs(p.left - Math.round((vp.w - width) / 2)) + (p.top - DM_TOAST_TOP);

/**
 * FR-NOTE-77: how far the stack may slide right of home: half its width (it stays in its band).
 * Left of home no cap since DM #364 (a spot on no window and no PC beats one over a window).
 */
export const MAX_SLIDE = STACK_W / 2;

/**
 * FR-NOTE-77 (walkthrough H3 1b, 4; amends FR-NOTE-70): when no spot in the column clears the
 * windows' content, a spot beside a window, Initiative or a tool bar (12 px gap, ≥ 80 px from the
 * left like the shift, inside the viewport) at most `MAX_SLIDE` right of home (half the stack still
 * over its home column: never the rail or the map's edge, sim-9 a01, BL-83; with `farLeft`, DM
 * #364, any distance left of home, still ≥ 80 px from the left) that covers no
 * window, no PC token (`pcs`, + 4 px), no card target and no hard keep-out; nearest the home
 * spot. Null → none.
 */
function besideSpot(
  vp: Viewport,
  width: number,
  stackH: number,
  windows: readonly StackWindow[],
  initiative: Rect | null,
  hard: readonly Rect[],
  blockers: readonly Rect[],
  avoid: readonly TokenBox[],
  pcs: readonly Rect[],
  /** DM #364: no cap left of home (only once no spot within the cap is clear). */
  farLeft = false,
): Spot | null {
  const home = Math.round((vp.w - width) / 2);
  const edges = [...windows, ...(initiative ? [initiative] : []), ...hard];
  const lefts = [
    ...new Set(
      edges.flatMap((w) => [w.x - EDGE_GAP - width, w.x + w.w + EDGE_GAP]).map(Math.round),
    ),
  ].filter(
    // DM #364 (amends #288): `farLeft` lifts the cap left of home (the spot below still covers
    // no window, PC, card target or keep-out, and keeps the rail clear).
    (l) =>
      l >= MIN_SHIFT_LEFT &&
      l + width <= vp.w - EDGE_GAP &&
      l - home <= MAX_SLIDE &&
      (farLeft || home - l <= MAX_SLIDE),
  );
  if (lefts.length === 0) return null;
  const maxTop = vp.h - LAUNCHER_CLEAR - stackH;
  const tops = [
    DM_TOAST_TOP,
    ...windows.map((w) => w.y + w.h + STACK_GAP),
    ...hard.map((k) => k.y + k.h + STACK_GAP),
    ...blockers.map((b) => b.y + b.h + EDGE_GAP),
    ...[...pcs, ...avoid].flatMap((t) => [t.y + t.h + EDGE_GAP, t.y - EDGE_GAP - stackH]),
  ]
    .filter((y) => y >= DM_TOAST_TOP && y <= maxTop)
    .map(Math.round);
  let best: Spot | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (const top of [...new Set(tops)].sort((a, b) => a - b)) {
    for (const left of lefts) {
      const r = { x: left, y: top, w: width, h: stackH };
      if (blockers.some((b) => hits(r, b, EDGE_GAP))) continue;
      if ([...windows, ...hard, ...pcs, ...avoid].some((b) => hits(r, b, 0))) continue;
      const d = homeDistance(vp, width, { left, top });
      if (d < bestD) {
        best = { left, top };
        bestD = d;
      }
    }
  }
  return best;
}
