// Measured content heights (FR-SHELL-39): what each `growToContent` window's content asks for,
// reported by `ShellWindow`. Read by the free area, toasts, and auto placement (FR-SHELL-40).
// Also each open window's first content row (FR-NOTE-44), read by the DM toast stack.
import { useSyncExternalStore } from "react";

/** Window id (`kind:instance`) → window height its content asks for, reported by `ShellWindow`. */
let heights: ReadonlyMap<string, number> = new Map();
const heightListeners = new Set<() => void>();

/** `ShellWindow` of a `growToContent` type reports its needed height; null = gone / not growing. */
export function reportContentHeight(id: string, h: number | null): void {
  if (h === null ? !heights.has(id) : heights.get(id) === h) return;
  const next = new Map(heights);
  if (h === null) next.delete(id);
  else next.set(id, h);
  heights = next;
  for (const fn of [...heightListeners]) fn();
}

/**
 * FR-NOTE-44: a window's first content row, viewport px: the window's rendered top-left and the
 * row's bottom. Reported by `ShellWindow` while open; read by the DM toast stack.
 */
export interface FirstRow {
  x: number;
  y: number;
  bottom: number;
}

let rows: ReadonlyMap<string, FirstRow> = new Map();

/**
 * `ShellWindow` reports where its first content row ends (null = closed / none). Notifies the
 * height listeners too (a new heights Map), so whatever reads the measured heights re-renders.
 */
export function reportFirstRow(id: string, row: FirstRow | null): void {
  const cur = rows.get(id);
  if (
    row === null ? !cur : cur && cur.x === row.x && cur.y === row.y && cur.bottom === row.bottom
  ) {
    return;
  }
  const next = new Map(rows);
  if (row === null) next.delete(id);
  else next.set(id, row);
  rows = next;
  heights = new Map(heights);
  for (const fn of [...heightListeners]) fn();
}

/** The first rows reported so far (a new Map on every change). */
export function firstRows(): ReadonlyMap<string, FirstRow> {
  return rows;
}

/** The heights reported so far on this page (a new Map on every change). */
export function contentHeights(): ReadonlyMap<string, number> {
  return heights;
}

const subscribeHeights = (fn: () => void) => {
  heightListeners.add(fn);
  return () => {
    heightListeners.delete(fn);
  };
};

/** Re-renders when a grown window's content height changes. */
export function useContentHeights(): ReadonlyMap<string, number> {
  return useSyncExternalStore(subscribeHeights, contentHeights, contentHeights);
}

/** No frames (hidden tab): give up waiting after this, ms. */
const FRAME_WAIT_MAX = 100;

/**
 * Resolves after the next layout frame, once its ResizeObserver reports are in (a task after the
 * frame), or after `FRAME_WAIT_MAX` when no frame comes: heights read then include what that
 * frame laid out.
 */
export function afterLayoutFrame(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, FRAME_WAIT_MAX);
    if (typeof requestAnimationFrame !== "function") return;
    requestAnimationFrame(() =>
      setTimeout(() => {
        clearTimeout(timer);
        resolve();
      }, 0),
    );
  });
}
