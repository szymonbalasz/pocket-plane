// Toast stack model (FR-NOTE-14/15): pure state + an injected clock. Info toasts hide after 6 s,
// timers pause while the stack is hovered or the tab is hidden; pending toasts stay until their
// notification leaves `pending` or the user closes them (closing ≠ dismissing). At most 3 show;
// the rest count as "+N more". Client memory only.
import type { NotificationRecord } from "@shared/notifications/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { createStore, type StoreApi } from "zustand";
import {
  NOTIFICATION_TYPE,
  pendingForMe,
  type SyncView,
  summaryCount,
  type Transition,
  toastTriggers,
} from "./logic";

export const INFO_TOAST_MS = 6000;
export const MAX_VISIBLE = 3;
export const SUMMARY_KEY = "summary";

export type Toast =
  | { key: string; kind: "note"; notificationId: string; sticky: boolean; remaining: number }
  | { key: typeof SUMMARY_KEY; kind: "summary"; count: number; sticky: true; remaining: number };

export interface ToastState {
  /** Insertion order, oldest first. */
  toasts: Toast[];
  /**
   * FR-NOTE-26: notifications whose toast was hidden (`closeToast()` of an action, `hideToast`);
   * their toast doesn't come back in this page load. Optional: absent = none.
   */
  hiddenIds?: readonly string[];
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
  if (ran.toasts.some((t) => t.key === n.id) || ran.hiddenIds?.includes(n.id)) return ran;
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

/**
 * FR-NOTE-26: closes a notification's toast as the user's close would (no dismiss) and keeps it
 * hidden for this page load; the row stays in `note.history` and the bell.
 */
export function hideNote(s: ToastState, notificationId: string, now: number): ToastState {
  const ran = closeToast(s, notificationId, now);
  if (ran.hiddenIds?.includes(notificationId)) return ran;
  return { ...ran, hiddenIds: [...(ran.hiddenIds ?? []), notificationId] };
}

/** Clears every toast (campaign switch). */
export function clearToasts(s: ToastState, now: number): ToastState {
  return { ...advance(s, now), toasts: [] };
}

/**
 * FR-NOTE-15 (P3 glitch 8: one toast per pending action): the pending-for-me rows without their
 * own toast on the stack; the summary counts only these (0 → no summary).
 */
export function untoastedPending(s: ToastState, store: RecordStore): number {
  const toasted = new Set(s.toasts.flatMap((t) => (t.kind === "note" ? [t.notificationId] : [])));
  return pendingForMe(store).filter((n) => !toasted.has(n.id)).length;
}

/**
 * Keeps toasts in line with the store: a pending toast whose notification left `pending` (or
 * is gone) disappears; the summary follows the current count of pending-for-me rows without a
 * toast of their own.
 */
export function pruneToasts(s: ToastState, store: RecordStore, now: number): ToastState {
  const ran = advance(s, now);
  const rows = (store.records[NOTIFICATION_TYPE] ?? {}) as Record<string, NotificationRecord>;
  const kept = ran.toasts.filter(
    (t) => !(t.kind === "note" && t.sticky && rows[t.notificationId]?.state !== "pending"),
  );
  const mine = untoastedPending({ ...ran, toasts: kept }, store);
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

/**
 * The page's toast memory: the stack and the campaign it belongs to. Lives outside the runtime
 * component, so a remount of the shell within one page (the DM's fresh connection after a
 * throttled 4401, #163) keeps sticky toasts (FR-NOTE-14); a reload starts empty.
 */
export interface ToastMemory {
  toasts: ToastState;
  campaignId: string | null;
}

export type ToastMemoryStore = StoreApi<ToastMemory>;

export function createToastMemory(now: number, hidden = false): ToastMemoryStore {
  return createStore<ToastMemory>()(() => ({
    toasts: initialToasts(now, hidden),
    campaignId: null,
  }));
}

/**
 * One classified sync change applied to the stack (FR-NOTE-13/14/15): a `connect` to another
 * campaign clears it, every `connect` sets the summary (rows already toasted don't count, P3
 * glitch 8); created rows toast; then the stack follows the store.
 */
export function syncToasts(
  m: ToastMemory,
  prev: SyncView | null,
  next: SyncView,
  t: Transition,
  now: number,
): ToastMemory {
  if (t === null) return m;
  const store = next.store;
  let s = m.toasts;
  let campaignId = m.campaignId;
  if (t === "connect") {
    const cid = store.you?.campaignId ?? null;
    if (cid !== campaignId) s = clearToasts(s, now);
    campaignId = cid;
    // Only pending rows without a toast of their own (a sticky card kept over a reconnect).
    s = setSummary(s, Math.min(summaryCount(t, store), untoastedPending(s, store)), now);
  }
  for (const n of toastTriggers(prev, next, t)) s = addNote(s, n, now);
  s = pruneToasts(s, store, now);
  return s === m.toasts && campaignId === m.campaignId ? m : { toasts: s, campaignId };
}

/**
 * The newest `max` (default `MAX_VISIBLE`) toasts (oldest first) and how many more are held back;
 * the runtime lowers `max` while the stack doesn't fit the viewport (P3 E3).
 */
export function visibleToasts(
  s: ToastState,
  max: number = MAX_VISIBLE,
): { shown: Toast[]; more: number } {
  const more = Math.max(0, s.toasts.length - Math.max(1, max));
  return { shown: s.toasts.slice(more), more };
}

/** Milliseconds until the next info toast expires; null if none or paused. */
export function nextExpiry(s: ToastState): number | null {
  if (s.runningSince === null) return null;
  let min: number | null = null;
  for (const t of s.toasts) if (!t.sticky && (min === null || t.remaining < min)) min = t.remaining;
  return min;
}

// ---- FR-NOTE-26: `hideToast(id)` for kind owners' own UI ----

const memories = new Set<ToastMemoryStore>();

/** The toast runtime registers its page memory while mounted (one per client page). */
export function registerToastMemory(m: ToastMemoryStore): () => void {
  memories.add(m);
  return () => {
    memories.delete(m);
  };
}

/**
 * FR-NOTE-26 client export: hides a notification's toast (same effect as an action's
 * `closeToast()`), e.g. combat's popup opened from its Pending list. Client memory only.
 */
export function hideToast(notificationId: string): void {
  const now = Date.now();
  for (const m of memories)
    m.setState((x) => ({ toasts: hideNote(x.toasts, notificationId, now) }));
}
