// FR-NOTE-51 (BL-59): what the DM stack's spot depends on, each one subscribed (never read once),
// so the runtime re-places on every change: the open windows as rendered, Initiative, the hard
// keep-outs (the active tool bar) and the windows' first-row reports. Code read (BL-59): the
// window rects were grown against keep-outs read inside a memo that never re-ran on a keep-out
// change, the first rows were a default argument read inside the placement memo, and the stack
// stayed below a pushed window for as long as the window wasn't returned (the placer's part).
// FR-NOTE-72 (sprint 9): this client's open Notifications window counts like Initiative
// (`blocks`). Remembered windows (window memory) are ordinary rendered windows here.
// Its own module, so the runtime test can stub it (a static render reads no layout).
import { useMemo } from "react";
import { INITIATIVE_KIND } from "../combat-tracker/window";
import type { FirstRow } from "../play-shell/content-heights";
import { firstRows } from "../play-shell/content-heights";
import { renderedWindowRects, useContentHeights } from "../play-shell/free-area";
import type { Rect } from "../play-shell/geometry";
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

/** The DM stack's inputs (players: none; their stack keeps its corner). */
export function useStackInputs(isDm: boolean): StackInputs {
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
        const how = placed.get(windowId(w.kind, w.instance));
        const pushed = pushedByPlan(how, causes(w.kind, w.instance));
        return w.kind === HISTORY_KIND ? { ...r, pushed, blocks: true } : { ...r, pushed };
      }),
      hard,
      rows: [...firstRows().values()],
    };
  }, [isDm, windows, registry, available, vp, measured, keepOuts, placed, memory]);
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
