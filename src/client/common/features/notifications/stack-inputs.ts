// FR-NOTE-51 (BL-59): what the DM stack's spot depends on, each one subscribed (never read once),
// so the runtime re-places on every change: the open windows as rendered, Initiative, the hard
// keep-outs (the active tool bar) and the windows' first-row reports. Code read (BL-59): the
// window rects were grown against keep-outs read inside a memo that never re-ran on a keep-out
// change, the first rows were a default argument read inside the placement memo, and the stack
// stayed below a pushed window for as long as the window wasn't returned (the placer's part).
// FR-NOTE-72 (sprint 9): this client's open Notifications window counts like Initiative
// (`blocks`). Remembered windows (window memory) are ordinary rendered windows here.
// *(Sprint 10, H3)* FR-NOTE-75: where each window's drawn content ends (`used`), read from the
// DOM while the stack shows and re-read when a window body's content changes.
// Its own module, so the runtime test can stub it (a static render reads no layout).
import { useEffect, useMemo, useState } from "react";
import { INITIATIVE_KIND } from "../combat-tracker/window";
import type { FirstRow } from "../play-shell/content-heights";
import { firstRows } from "../play-shell/content-heights";
import { renderedWindowRects, useContentHeights } from "../play-shell/free-area";
import { type Rect, TITLE_H } from "../play-shell/geometry";
import { useViewport } from "../play-shell/hooks";
import { hardRects, useKeepOuts } from "../play-shell/keep-outs";
import { windowId } from "../play-shell/manager";
import { useAvailableKinds, useRegistry, useShellState } from "../play-shell/ShellContext";
import { pushedByPlan, type StackWindow } from "./keep-out";
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

/** The body's drawn boxes, in document order: its leaf elements and record rows (padded cards). */
function* drawnBoxes(body: Element): Generator<DOMRect> {
  const walk = document.createTreeWalker(body, NodeFilter.SHOW_ELEMENT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    const el = n as Element;
    if (el.childElementCount === 0 || el.hasAttribute("data-record-id")) {
      yield el.getBoundingClientRect();
    }
  }
}

/**
 * FR-NOTE-75: how far below its top a window's drawn content ends, px (nothing drawn → its title
 * bar); null when the window isn't in the DOM.
 */
function usedHeight(id: string): number | null {
  if (typeof document === "undefined") return null;
  const section = document.querySelector(`${WINDOW_SELECTOR}[data-record-id="${CSS.escape(id)}"]`);
  const body = section?.querySelector(BODY_SELECTOR);
  if (!section || !body) return null;
  const top = section.getBoundingClientRect().top;
  const b = body.getBoundingClientRect();
  const end = contentEnd(b.top, b.bottom, drawnBoxes(body));
  return end === null ? TITLE_H : Math.ceil(end - top);
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
        // FR-NOTE-75: the drawn content's end, on this rect (it may move before the DOM does).
        const h = measure ? usedHeight(id) : null;
        const used = h === null ? {} : { used: r.y + Math.min(r.h, h) };
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
