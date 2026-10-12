// Toast stack model (FR-NOTE-14/15): pure state + an injected clock. Info toasts hide after 6 s,
// timers pause while the stack is hovered or the tab is hidden; pending toasts stay until their
// notification leaves `pending` or the user closes them (closing ≠ dismissing). At most 3 show;
// the rest count as "+N more". Client memory only.
import type { NotificationRecord } from "@shared/notifications/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { NOTIFICATION_TYPE, pendingForMe } from "./logic";

export const INFO_TOAST_MS = 6000;
export const MAX_VISIBLE = 3;
export const SUMMARY_KEY = "summary";

export type Toast =
  | { key: string; kind: "note"; notificationId: string; sticky: boolean; remaining: number }
  | { key: typeof SUMMARY_KEY; kind: "summary"; count: number; sticky: true; remaining: number };

export interface ToastState {
  /** Insertion order, oldest first. */
  toasts: Toast[];
  hovered: boolean;
  hidden: boolean;
  /** When timers last ran up to; null while paused. */
  runningSince: number | null;
}

export function initialToasts(now: number, hidden = false): ToastState {
  return { toasts: [], hovered: false, hidden, runningSince: hidden ? null : now };
}

const isPaused = (s: ToastState) => s.hovered || s.hidden;

/** Runs timers up to `now` and drops expired info toasts. */
export function advance(s: ToastState, now: number): ToastState {
  if (s.runningSince === null) return s;
  const dt = Math.max(0, now - s.runningSince);
  const toasts = s.toasts
    .map((t) => (t.sticky ? t : { ...t, remaining: t.remaining - dt }))
    .filter((t) => t.sticky || t.remaining > 0);
  return { ...s, toasts, runningSince: now };
}

function withPause(s: ToastState, patch: Partial<ToastState>, now: number): ToastState {
  const ran = advance(s, now);
  const next = { ...ran, ...patch };
  return { ...next, runningSince: isPaused(next) ? null : now };
}

export function setHovered(s: ToastState, hovered: boolean, now: number): ToastState {
  return withPause(s, { hovered }, now);
}

export function setHidden(s: ToastState, hidden: boolean, now: number): ToastState {
  return withPause(s, { hidden }, now);
}

/** FR-NOTE-13/14: a toast per created notification; pending → sticky. */
export function addNote(s: ToastState, n: NotificationRecord, now: number): ToastState {
  const ran = advance(s, now);
  if (ran.toasts.some((t) => t.key === n.id)) return ran;
  const sticky = n.state === "pending";
  return {
    ...ran,
    toasts: [
      ...ran.toasts,
      { key: n.id, kind: "note", notificationId: n.id, sticky, remaining: INFO_TOAST_MS },
    ],
  };
}

/** FR-NOTE-15: one summary toast; replaces an older one; count 0 removes it. */
export function setSummary(s: ToastState, count: number, now: number): ToastState {
  const ran = advance(s, now);
  const rest = ran.toasts.filter((t) => t.kind !== "summary");
  if (count <= 0) return { ...ran, toasts: rest };
  return {
    ...ran,
    toasts: [...rest, { key: SUMMARY_KEY, kind: "summary", count, sticky: true, remaining: 0 }],
  };
}

export function closeToast(s: ToastState, key: string, now: number): ToastState {
  const ran = advance(s, now);
  return { ...ran, toasts: ran.toasts.filter((t) => t.key !== key) };
}

/** Clears every toast (campaign switch). */
export function clearToasts(s: ToastState, now: number): ToastState {
  return { ...advance(s, now), toasts: [] };
}

/**
 * Keeps toasts in line with the store: a pending toast whose notification left `pending` (or
 * is gone) disappears; the summary follows the current pending-for-me count.
 */
export function pruneToasts(s: ToastState, store: RecordStore, now: number): ToastState {
  const ran = advance(s, now);
  const rows = (store.records[NOTIFICATION_TYPE] ?? {}) as Record<string, NotificationRecord>;
  const mine = pendingForMe(store).length;
  let changed = false;
  const toasts: Toast[] = [];
  for (const t of ran.toasts) {
    if (t.kind === "note" && t.sticky && rows[t.notificationId]?.state !== "pending") {
      changed = true;
      continue;
    }
    if (t.kind === "summary" && t.count !== mine) {
      changed = true;
      if (mine > 0) toasts.push({ ...t, count: mine });
      continue;
    }
    toasts.push(t);
  }
  return changed ? { ...ran, toasts } : ran;
}

/** The newest `MAX_VISIBLE` toasts (oldest first) and how many more are held back. */
export function visibleToasts(s: ToastState): { shown: Toast[]; more: number } {
  const more = Math.max(0, s.toasts.length - MAX_VISIBLE);
  return { shown: s.toasts.slice(more), more };
}

/** Milliseconds until the next info toast expires; null if none or paused. */
export function nextExpiry(s: ToastState): number | null {
  if (s.runningSince === null) return null;
  let min: number | null = null;
  for (const t of s.toasts) if (!t.sticky && (min === null || t.remaining < min)) min = t.remaining;
  return min;
}
