// Keep-out regions (FR-SHELL-48): parts of the work area auto placement avoids. Registry-driven:
// (a) the client's toast box (`toastKeepOut`, FR-SHELL-49), always: players' bottom-right corner
// = hard, the DM's top-centre region = soft; (b) rects reported by chrome floating over the map
// (`reportKeepOut`; sprint 5: scenes-map's active tool bar `map.toolbar`), hard. Client memory,
// recomputed; never stored or sent.
import { useMemo, useSyncExternalStore } from "react";
import type { Rect, Viewport } from "./geometry";
import { useViewport } from "./hooks";
import type { ShellClient } from "./registry";
import { toastKeepOut } from "./toast-region";

/**
 * `hard`: auto placement treats it like an open window (FR-SHELL-45 (1)); growth stops above it.
 * `soft`: only ranked (FR-SHELL-45 (4)): avoided when a spot clear of it exists.
 */
export type KeepOutKind = "hard" | "soft";

export interface KeepOut {
  /** `toasts`, or the reporter's id (e.g. `map.toolbar`). */
  id: string;
  rect: Rect;
  kind: KeepOutKind;
}

/** Id of the toast box region. */
export const TOASTS_KEEP_OUT = "toasts";

let reported: ReadonlyMap<string, Rect> = new Map();
const listeners = new Set<() => void>();

/**
 * Chrome floating over the map reports its rect while shown (hard), null when gone (FR-SHELL-48
 * (b)). Same rect again → no change.
 */
export function reportKeepOut(id: string, rect: Rect | null): void {
  const cur = reported.get(id);
  if (rect === null ? cur === undefined : cur && sameRect(cur, rect)) return;
  const next = new Map(reported);
  if (rect === null) next.delete(id);
  else next.set(id, { x: rect.x, y: rect.y, w: rect.w, h: rect.h });
  reported = next;
  for (const fn of [...listeners]) fn();
}

const sameRect = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

/** Rects reported so far on this page (a new Map on every change). */
export function reportedKeepOuts(): ReadonlyMap<string, Rect> {
  return reported;
}

/** This client's keep-out regions in viewport `vp`: the toast box, then the reported rects. */
export function keepOuts(
  client: ShellClient,
  vp: Viewport,
  reports: ReadonlyMap<string, Rect> = reported,
): KeepOut[] {
  const out: KeepOut[] = [
    {
      id: TOASTS_KEEP_OUT,
      rect: toastKeepOut(client, vp),
      kind: client === "player" ? "hard" : "soft",
    },
  ];
  for (const [id, rect] of reports) out.push({ id, rect, kind: "hard" });
  return out;
}

/** The hard regions' rects (placement blockers, growth caps). */
export const hardRects = (list: readonly KeepOut[]) =>
  list.filter((k) => k.kind === "hard").map((k) => k.rect);

/** `ui-play-page` `data-keep-outs` (walkthroughs): "id:x,y,w,h;…". */
export function keepOutsAttr(list: readonly KeepOut[]): string {
  return list
    .map(({ id, rect: r }) => `${id}:${Math.round(r.x)},${Math.round(r.y)},${r.w},${r.h}`)
    .join(";");
}

/** Calls `fn` after every reported change (FR-SHELL-81: a tool bar going returns windows). */
export const subscribeKeepOuts = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** This client's keep-out regions now; re-renders on viewport resize and on reports. */
export function useKeepOuts(client: ShellClient): KeepOut[] {
  const vp = useViewport();
  const reports = useSyncExternalStore(subscribeKeepOuts, reportedKeepOuts, reportedKeepOuts);
  return useMemo(() => keepOuts(client, vp, reports), [client, vp, reports]);
}
