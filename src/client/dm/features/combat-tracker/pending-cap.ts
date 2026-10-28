// DM Initiative (sprint 14 F2). BL-131 (sim-16 h04: with 5–7 pending cards a squeezed 400 × 380
// Initiative showed about one combatant row, its name clipped): the Pending block keeps its own
// scroll (FR-CBT-77, ≤ 3 lines) and takes only as many lines as leave the row list two combatant
// rows at the window's largest height. BL-137 (K9 walkthrough: Fire Elemental's turn sat in
// "↓ 7 more"): a turn change scrolls the row list to the active row.

import { INITIATIVE_KIND } from "@ui/features/combat-tracker/window";
import { useGrowthCaps } from "@ui/features/play-shell/free-area";
import { windowRect } from "@ui/features/play-shell/geometry";
import { useViewport } from "@ui/features/play-shell/hooks";
import { windowId } from "@ui/features/play-shell/manager";
import { useRegistry, useShellState } from "@ui/features/play-shell/ShellContext";
import { type RefObject, useLayoutEffect, useState } from "react";

/** One Pending line (`h-8`) and the list's `gap-1`. */
export const PENDING_LINE_H = 36;
/** FR-CBT-77 (G4): at most three lines, then the block scrolls. */
export const PENDING_MAX_LINES = 3;
/** BL-131: the row list keeps two combatant rows (54 px each and their gap). */
export const MIN_LIST_H = 112;
/** "↓ N more" and its gap, counted whether it shows or not (so the lines never flip with it). */
export const MORE_H = 28;

/**
 * BL-131: how many Pending lines show (the rest scroll in the block): as many as `maxH` (the
 * window's largest height) holds beside `fixed` (everything but the two lists: title bar, header,
 * the Pending heading, footer, gaps), "↓ N more" and `MIN_LIST_H`; 1..3, never more than `count`.
 */
export function pendingLines(maxH: number, fixed: number, count: number): number {
  const fit = Math.floor((maxH - fixed - MORE_H - MIN_LIST_H + 4) / PENDING_LINE_H);
  return Math.max(1, Math.min(PENDING_MAX_LINES, count, fit));
}

/** The block's height for `lines` lines (no gap after the last). */
export const pendingMaxH = (lines: number) => lines * PENDING_LINE_H - 4;

/**
 * BL-131: the Pending lines for the DM's Initiative: `pendingRef` = the Pending list (`ul`),
 * `listRef` = the row list, `footerRef` = "↓ N more". The window's largest height is its grown cap
 * (FR-SHELL-39) or its user size; the other parts are measured once laid out.
 */
export function usePendingLines(
  pendingRef: RefObject<HTMLElement | null>,
  listRef: RefObject<HTMLElement | null>,
  footerRef: RefObject<HTMLElement | null>,
  count: number,
): number {
  const [fixed, setFixed] = useState<number | null>(null);
  const win = useShellState((s) =>
    s.windows.find((w) => windowId(w.kind, w.instance) === windowId(INITIATIVE_KIND)),
  );
  const def = useRegistry().get(INITIATIVE_KIND);
  const vp = useViewport();
  const caps = useGrowthCaps(windowId(INITIATIVE_KIND));
  const shown = count > 0;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `shown` mounts the Pending list
  useLayoutEffect(() => {
    const pending = pendingRef.current;
    const list = listRef.current;
    const section = list?.closest<HTMLElement>('[data-testid="ui-window"]');
    if (!pending || !list || !section) return;
    const measure = () => {
      const f = footerRef.current;
      const more = f && !f.hidden ? f.offsetHeight + 8 : 0;
      const h = section.offsetHeight - list.offsetHeight - pending.offsetHeight - more;
      setFixed((x) => (x === h ? x : h));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    for (const el of [section, list, pending]) ro.observe(el);
    return () => ro.disconnect();
  }, [pendingRef, listRef, footerRef, shown]);
  if (count === 0) return 0;
  if (fixed === null || !win || !def) return Math.min(PENDING_MAX_LINES, count);
  const maxH = windowRect(win, def, vp, 100_000, caps).h;
  return pendingLines(maxH, fixed, count);
}

/**
 * BL-137: the list's new `scrollTop` that brings a row into view, centred, when any of it is
 * outside the list's visible box (viewport px); null while it is wholly visible.
 */
export function scrollToShow(
  row: { top: number; bottom: number },
  view: { top: number; bottom: number },
  scrollTop: number,
): number | null {
  if (row.top >= view.top - 1 && row.bottom <= view.bottom + 1) return null;
  const by = (row.top + row.bottom) / 2 - (view.top + view.bottom) / 2;
  return Math.max(0, Math.round(scrollTop + by));
}

/**
 * BL-137: on a turn change (and when opened) the row list scrolls to the active row (an
 * in-turn companion's line: its owner's row) when it is out of view.
 */
export function useActiveRowScroll(
  listRef: RefObject<HTMLElement | null>,
  turnId: string | null | undefined,
): void {
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || !turnId) return;
    const id = CSS.escape(turnId);
    const row = list
      .querySelector(
        `[data-testid="cbt-init-row"][data-record-id="${id}"], [data-testid="cbt-init-companion"][data-record-id="${id}"]`,
      )
      ?.closest<HTMLElement>('[data-testid="cbt-init-row"]');
    if (!row) return;
    const to = scrollToShow(
      row.getBoundingClientRect(),
      list.getBoundingClientRect(),
      list.scrollTop,
    );
    if (to !== null) list.scrollTop = to;
  }, [listRef, turnId]);
}
