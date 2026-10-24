// FR-NOTE-51 (BL-59): what the DM stack's spot depends on, each one subscribed (never read once),
// so the runtime re-places on every change: the open windows as rendered, Initiative, the hard
// keep-outs (the active tool bar) and the windows' first-row reports. Code read (BL-59): the
// window rects were grown against keep-outs read inside a memo that never re-ran on a keep-out
// change, the first rows were a default argument read inside the placement memo, and the stack
// stayed below a pushed window for as long as the window wasn't returned (the placer's part).
// FR-NOTE-72 (sprint 9): this client's open Notifications window counts like Initiative
// (`blocks`). Remembered windows (window memory) are ordinary rendered windows here.
// *(Sprint 10, H3)* FR-NOTE-75: where each window's drawn content ends (`used`), read from the
// DOM while the stack shows and re-read when a window body's content changes. FR-NOTE-77: also
// its first rows (`head`: the first row-sized record row, not a record container such as the
// Encounters editor, which the frame's first-row report takes) and its controls; the Game log's
// newest entries (re-test 3). *(Sprint 11, F2)* FR-NOTE-78 (BL-108): its headings and records
// too (the first record and the headings are its primary parts).
// Its own module, so the runtime test can stub it (a static render reads no layout).
import { useEffect, useMemo, useState } from "react";
import { INITIATIVE_KIND } from "../combat-tracker/window";
import { DICE_LOG_KIND } from "../dice-roll-log/window";
import type { FirstRow } from "../play-shell/content-heights";
import { firstRows } from "../play-shell/content-heights";
import { renderedWindowRects, useContentHeights } from "../play-shell/free-area";
import { type Rect, TITLE_H } from "../play-shell/geometry";
import { useViewport } from "../play-shell/hooks";
import { hardRects, useKeepOuts } from "../play-shell/keep-outs";
import { windowId } from "../play-shell/manager";
import { useAvailableKinds, useRegistry, useShellState } from "../play-shell/ShellContext";
import { PUSHED_BODY_CLEAR, pushedByPlan, type StackWindow } from "./keep-out";
import { HISTORY_KIND } from "./logic";

export interface StackInputs {
  /** FR-NOTE-32: the open, non-minimised `cbt.initiative` window's rendered rect, else null. */
  initiative: Rect | null;
  /**
   * The other open windows as rendered (title bars never covered, bodies when nothing else), each
   * with FR-NOTE-53's `pushed` from the placer's plan and FR-NOTE-72's `blocks` (Notifications).
   */
  windows: StackWindow[];
  /** FR-NOTE-43: hard keep-out rects (the active tool bar). */
  hard: Rect[];
  /** FR-NOTE-44: the windows' first content rows (`ShellWindow`'s reports). */
  rows: FirstRow[];
}

const NONE: StackInputs = { initiative: null, windows: [], hard: [], rows: [] };

const WINDOW_SELECTOR = '[data-testid="ui-window"]';
const BODY_SELECTOR = '[data-testid="ui-window-body"]';

/**
 * FR-NOTE-75: where a window body's drawn content ends, viewport px: the lowest bottom of its
 * boxes (in document order) inside the body's `top`..`bottom`, stopping once one reaches
 * `bottom` (a full or scrolled body); none → null. Pure.
 */
export function contentEnd(
  top: number,
  bottom: number,
  boxes: Iterable<{ top: number; bottom: number }>,
): number | null {
  let end: number | null = null;
  for (const b of boxes) {
    if (b.bottom <= b.top || b.bottom <= top || b.top >= bottom) continue;
    end = Math.max(end ?? top, Math.min(b.bottom, bottom));
    if (end >= bottom) break;
  }
  return end;
}

/** FR-NOTE-77: a record element taller than this is a container (an editor), not a row. */
export const ROW_MAX_H = 120;

/**
 * FR-NOTE-77: where a window body's first rows end, viewport px: the bottom of its first record
 * element (document order) inside `top`..`bottom` that is row-sized (≤ `ROW_MAX_H`), so the tabs,
 * search box and list header above it count too; none → null. Pure.
 */
export function firstRowEnd(
  top: number,
  bottom: number,
  records: Iterable<{ top: number; bottom: number }>,
): number | null {
  for (const r of records) {
    const h = r.bottom - r.top;
    if (h <= 0 || h > ROW_MAX_H || r.bottom <= top || r.top >= bottom) continue;
    return Math.min(r.bottom, bottom);
  }
  return null;
}

/** FR-NOTE-77 (re-test 3): how many of a log's newest rows count like controls. */
export const LOG_ROWS = 3;

/**
 * FR-NOTE-77 (re-test 3): a log's newest rows: the last `LOG_ROWS` outermost row-sized records
 * (document order) drawn inside `top`..`bottom`. Pure.
 */
export function newestRows<T extends { top: number; bottom: number }>(
  top: number,
  bottom: number,
  records: readonly T[],
): T[] {
  const rows = records.filter((r) => {
    const h = r.bottom - r.top;
    return h > 0 && h <= ROW_MAX_H && r.bottom > top && r.top < bottom;
  });
  return rows.slice(-LOG_ROWS);
}

/**
 * FR-NOTE-78: a record up to this share of its body's height counts (a request card with its
 * buttons is 122 px); a container filling the body (the Encounters editor) doesn't.
 */
export const RECORD_MAX_SHARE = 0.5;

/**
 * FR-NOTE-78 (BL-108): a body's records as the stack counts them: the outermost records drawn
 * inside `top`..`bottom` that aren't controls and are no taller than `ROW_MAX_H` or
 * `RECORD_MAX_SHARE` of the body, in document order (`inside`: it sits in that record; a taller
 * container doesn't count, the records inside it do). Pure.
 */
export function outerRecords<T extends { top: number; bottom: number; control: boolean }>(
  top: number,
  bottom: number,
  records: readonly (T & { inside: (other: T) => boolean })[],
): T[] {
  const out: (T & { inside: (other: T) => boolean })[] = [];
  const maxH = Math.max(ROW_MAX_H, (bottom - top) * RECORD_MAX_SHARE);
  for (const r of records) {
    const h = r.bottom - r.top;
    if (r.control || h <= 0 || h > maxH || r.bottom <= top || r.top >= bottom) continue;
    if (out.some((o) => r.inside(o))) continue;
    out.push(r);
  }
  return out;
}

/** FR-NOTE-78: a window's headings. */
const HEADING_SELECTOR = 'h1, h2, h3, h4, h5, h6, [role="heading"]';

/** FR-NOTE-77: what counts as a window control (the fallback covers the fewest). */
const CONTROL_SELECTOR =
  'button, input, select, textarea, a[href], [role="button"], [role="tab"], [role="checkbox"], [role="switch"], [role="combobox"], [role="slider"]';

/** A window body as drawn, px relative to its window's top-left (it may move before the DOM). */
interface BodyMeasure {
  /** FR-NOTE-75: below its top, where the drawn content ends (nothing → its title bar). */
  used: number;
  /** FR-NOTE-77: below its top, where its first rows end; null → no row-sized record. */
  head: number | null;
  /** FR-NOTE-77: its visible controls. */
  controls: Rect[];
  /** FR-NOTE-77 (re-test 3): a log's newest rows (`log` only). */
  logRows: Rect[];
  /** FR-NOTE-78: its headings and first record (not a log: its newest rows stand for them). */
  primary: Rect[];
  /** FR-NOTE-78: its other records (not a log: older entries are free). */
  records: Rect[];
}

/**
 * One walk over the body's elements (subtrees outside its visible band skipped): its leaves and
 * record rows for `used` (FR-NOTE-75), record rows for `head`, controls (FR-NOTE-77). Null when
 * the window isn't in the DOM.
 */
function measureBody(id: string, log: boolean): BodyMeasure | null {
  if (typeof document === "undefined") return null;
  const section = document.querySelector(`${WINDOW_SELECTOR}[data-record-id="${CSS.escape(id)}"]`);
  const body = section?.querySelector(BODY_SELECTOR);
  if (!section || !body) return null;
  const s = section.getBoundingClientRect();
  const b = body.getBoundingClientRect();
  const drawn: DOMRect[] = [];
  const records: DOMRect[] = [];
  const outer: DOMRect[] = [];
  let lastOuter: Element | null = null;
  const controls: Rect[] = [];
  const headings: DOMRect[] = [];
  type Rec = { top: number; bottom: number; control: boolean; el: Element; r: DOMRect };
  const recs: (Rec & { inside: (o: Rec) => boolean })[] = [];
  const walk = document.createTreeWalker(body, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => {
      const r = (n as Element).getBoundingClientRect();
      // A scrolled-away row and everything in it: not drawn in the body (a box-less element,
      // `display: contents`, is walked into).
      if (r.height > 0 && (r.bottom <= b.top || r.top >= b.bottom)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const el = n as Element;
    const r = el.getBoundingClientRect();
    const record = el.hasAttribute("data-record-id");
    if (el.childElementCount === 0 || record) drawn.push(r);
    if (record) records.push(r);
    const control = el.matches(CONTROL_SELECTOR);
    if (record && !log) {
      recs.push({ top: r.top, bottom: r.bottom, control, el, r, inside: (o) => o.el.contains(el) });
    }
    if (!log && r.width >= 4 && r.height >= 4 && el.matches(HEADING_SELECTOR)) headings.push(r);
    // A log's entries: records not inside another (a re-roll mark sits inside its entry).
    if (record && log && !lastOuter?.contains(el)) {
      outer.push(r);
      lastOuter = el;
    }
    if (r.width >= 4 && r.height >= 4 && control) {
      const top = Math.max(r.top, b.top);
      const bottom = Math.min(r.bottom, b.bottom);
      controls.push({ x: r.left - s.left, y: top - s.top, w: r.width, h: bottom - top });
    }
  }
  const end = contentEnd(b.top, b.bottom, drawn);
  const head = firstRowEnd(b.top, b.bottom, records);
  const rel = (r: DOMRect): Rect => ({
    x: r.left - s.left,
    y: Math.max(r.top, b.top) - s.top,
    w: r.width,
    h: Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top),
  });
  const [first, ...rest] = outerRecords(b.top, b.bottom, recs);
  return {
    used: end === null ? TITLE_H : Math.ceil(end - s.top),
    head: head === null ? null : Math.ceil(head - s.top),
    controls,
    logRows: log ? newestRows(b.top, b.bottom, outer).map(rel) : [],
    primary: [...headings, ...(first ? [first.r] : [])].map(rel),
    records: rest.map((x) => rel(x.r)),
  };
}

/** Bumps (once a frame) when a window body's DOM changes while `on`: content grew or shrank. */
function useBodyChanges(on: boolean): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!on || typeof document === "undefined" || typeof MutationObserver === "undefined") return;
    let raf = 0;
    const mo = new MutationObserver((list) => {
      if (raf || !list.some((m) => (m.target as Element).closest?.(BODY_SELECTOR))) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setN((x) => x + 1);
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [on]);
  return n;
}

/**
 * The DM stack's inputs (players: none; their stack keeps its corner). `showing`: the stack shows,
 * so the windows' content is measured (FR-NOTE-75).
 */
export function useStackInputs(isDm: boolean, showing = true): StackInputs {
  const registry = useRegistry();
  const windows = useShellState((s) => s.windows);
  const available = useAvailableKinds();
  const vp = useViewport();
  // A first-row report also renews this Map (`reportFirstRow`), so it re-reads `firstRows()`.
  const measured = useContentHeights();
  const keepOuts = useKeepOuts("dm");
  // FR-NOTE-53: the plan (`data-placed`) and the displacement causes.
  const placed = useShellState((s) => s.placed);
  const memory = useShellState((s) => s.memory);
  const measure = isDm && showing;
  const changed = useBodyChanges(measure);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `changed` re-reads the content ends
  return useMemo(() => {
    if (!isDm) return NONE;
    const hard = hardRects(keepOuts);
    // As `renderedWindowRects` keeps them, so the rects line up with the windows.
    const open = windows.filter(
      (w) => w.state === "open" && registry.get(w.kind) && available.has(w.kind),
    );
    const rects = (list: typeof open) =>
      renderedWindowRects(list, registry, available, vp, measured, hard);
    const others = open.filter((w) => w.kind !== INITIATIVE_KIND);
    const causes = (kind: string, instance: string) =>
      memory.filter((d) => d.kind === kind && d.instance === instance).map((d) => d.cause);
    return {
      initiative: rects(open.filter((w) => w.kind === INITIATIVE_KIND))[0] ?? null,
      windows: rects(others).map((r, i) => {
        const w = others[i] as (typeof others)[number];
        const id = windowId(w.kind, w.instance);
        const pushed = pushedByPlan(placed.get(id), causes(w.kind, w.instance));
        // FR-NOTE-75, -77: the drawn content's end, first rows and controls, on this rect (it
        // may move before the DOM does).
        const m = measure ? measureBody(id, w.kind === DICE_LOG_KIND) : null;
        const used =
          m === null
            ? {}
            : {
                used: r.y + Math.min(r.h, m.used),
                head: r.y + Math.min(r.h, m.head ?? TITLE_H + PUSHED_BODY_CLEAR),
                controls: m.controls.map((c) => ({ ...c, x: r.x + c.x, y: r.y + c.y })),
                logRows: m.logRows.map((c) => ({ ...c, x: r.x + c.x, y: r.y + c.y })),
                primary: m.primary.map((c) => ({ ...c, x: r.x + c.x, y: r.y + c.y })),
                records: m.records.map((c) => ({ ...c, x: r.x + c.x, y: r.y + c.y })),
              };
        return w.kind === HISTORY_KIND
          ? { ...r, pushed, blocks: true, ...used }
          : { ...r, pushed, ...used };
      }),
      hard,
      rows: [...firstRows().values()],
    };
  }, [
    isDm,
    measure,
    windows,
    registry,
    available,
    vp,
    measured,
    keepOuts,
    placed,
    memory,
    changed,
  ]);
}

/**
 * FR-NOTE-72: this client's Notifications window is open and not minimised (both clients): the
 * stack folds its cards and summary into it. Here, so the runtime test can stub it.
 */
export function useHistoryOpen(): boolean {
  const open = useShellState((s) =>
    s.windows.some((w) => w.kind === HISTORY_KIND && w.state === "open"),
  );
  return useAvailableKinds().has(HISTORY_KIND) && open;
}
