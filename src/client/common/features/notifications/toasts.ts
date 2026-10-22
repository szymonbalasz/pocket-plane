// Toast stack model (FR-NOTE-14/15, -50): pure state + an injected clock. One stack per client;
// each toast has a class (FR-NOTE-50): cards (pending) stay until their notification leaves
// `pending` or the user closes them (closing ≠ dismissing); alert and info toasts hide after 6 s;
// one callout (not a notification, `showCallout`) hides after 4 s and a new one replaces it.
// Timers pause while the stack is hovered or the tab is hidden. At most 3 cards / alerts / info
// show (info held back first, then alerts); the rest count as "+N more". Client memory only.
import type { NotificationRecord } from "@shared/notifications/schemas";
import {
  type NotificationToastClass,
  TOAST_CLASS_MS,
  toastClassOf,
} from "@shared/notifications/toast-class";
import type { RecordStore } from "@shared/protocol/store";
import type { ReactNode } from "react";
import { createStore, type StoreApi } from "zustand";
import {
  NOTIFICATION_TYPE,
  pendingForMe,
  type SyncView,
  summaryCount,
  type Transition,
  toastTriggers,
} from "./logic";

export const INFO_TOAST_MS = TOAST_CLASS_MS.info ?? 6000;
export const CALLOUT_MS = TOAST_CLASS_MS.callout ?? 4000;
export const MAX_VISIBLE = 3;
export const SUMMARY_KEY = "summary";

/** A row's toast class; the runtime passes its views' (FR-NOTE-52). */
export type ClassOf = (n: NotificationRecord) => NotificationToastClass;
const BY_STATE: ClassOf = (n) => toastClassOf(undefined, n.state);

export type Toast =
  | {
      key: string;
      kind: "note";
      notificationId: string;
      /** FR-NOTE-50: card (sticky), alert or info; absent (older memory) = by `sticky`. */
      cls?: NotificationToastClass;
      sticky: boolean;
      remaining: number;
    }
  | {
      /** FR-NOTE-50: an alert-class toast from the client's `toast()` calls (sonner's store). */
      key: string;
      kind: "alert";
      alertId: string | number;
      /** An infinite duration: stays until closed or dismissed. */
      sticky: boolean;
      remaining: number;
    }
  | {
      key: typeof SUMMARY_KEY;
      kind: "summary";
      count: number;
      /** FR-NOTE-45 (DM): the started encounter's pending rows a player owns; absent = 0. */
      waiting?: number;
      sticky: true;
      remaining: number;
    };

/** FR-NOTE-50: the one callout (not a notification): a newer one replaces it. */
export interface Callout {
  id: string;
  content: ReactNode;
  remaining: number;
}

export interface ToastState {
  /** Insertion order, oldest first. */
  toasts: Toast[];
  /** FR-NOTE-50: the callout showing, outside the count of 3. Optional: absent = none. */
  callout?: Callout | null;
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
  if (!s.callout) return { ...s, toasts, runningSince: now };
  const left = s.callout.remaining - dt;
  const callout = left > 0 ? { ...s.callout, remaining: left } : null;
  return { ...s, toasts, callout, runningSince: now };
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

/**
 * FR-NOTE-13/14, -50: a toast per created notification, in its class (`classOf`: the kind's
 * views); a pending row is a card (sticky), alert / info hide after 6 s.
 */
export function addNote(
  s: ToastState,
  n: NotificationRecord,
  now: number,
  classOf: ClassOf = BY_STATE,
): ToastState {
  const ran = advance(s, now);
  if (ran.toasts.some((t) => t.key === n.id) || ran.hiddenIds?.includes(n.id)) return ran;
  const cls = n.state === "pending" ? "card" : classOf(n);
  const sticky = cls === "card";
  const remaining = TOAST_CLASS_MS[cls] ?? INFO_TOAST_MS;
  const t: Toast = { key: n.id, kind: "note", notificationId: n.id, cls, sticky, remaining };
  return { ...ran, toasts: [...ran.toasts, t] };
}

/** One `toast()` call showing (sonner's store), for `syncAlerts`. */
export interface AlertInput {
  id: string | number;
  /** Its own duration, ms; absent → the alert class's 6 s; infinite → until closed. */
  ms?: number | undefined;
}

/** The stack key of the `toast()` with this id. */
export const alertKey = (id: string | number) => `toast:${typeof id}:${id}`;

/**
 * FR-NOTE-50: the alert toasts follow the client's `toast()` calls: a new one joins (its own
 * duration, else 6 s), one gone from the list leaves; one already showing keeps its timer.
 * Unchanged → the same state.
 */
export function syncAlerts(s: ToastState, list: readonly AlertInput[], now: number): ToastState {
  const want = new Map(list.map((a) => [alertKey(a.id), a]));
  const have = new Set(s.toasts.flatMap((t) => (t.kind === "alert" ? [t.key] : [])));
  const gone = [...have].some((k) => !want.has(k));
  const added = [...want.keys()].filter((k) => !have.has(k));
  if (!gone && added.length === 0) return s;
  const ran = advance(s, now);
  const toasts: Toast[] = ran.toasts.filter((t) => t.kind !== "alert" || want.has(t.key));
  for (const key of added) {
    const a = want.get(key) as AlertInput;
    const ms = a.ms !== undefined && a.ms > 0 ? a.ms : (TOAST_CLASS_MS.alert ?? INFO_TOAST_MS);
    const sticky = !Number.isFinite(ms);
    toasts.push({ key, kind: "alert", alertId: a.id, sticky, remaining: sticky ? 0 : ms });
  }
  return { ...ran, toasts };
}

/** FR-NOTE-50: shows a callout; one showing is replaced (one at a time). */
export function setCallout(s: ToastState, c: CalloutInput, now: number): ToastState {
  const ran = advance(s, now);
  return { ...ran, callout: { id: c.id, content: c.content, remaining: c.ms ?? CALLOUT_MS } };
}

/** Closes the callout (any; or only the one with `id`). */
export function clearCallout(s: ToastState, now: number, id?: string): ToastState {
  const ran = advance(s, now);
  if (!ran.callout || (id !== undefined && ran.callout.id !== id)) return ran;
  return { ...ran, callout: null };
}

/**
 * FR-NOTE-15: one summary toast; replaces an older one; count 0 removes it. FR-NOTE-45: `waiting`
 * (DM) counts too: 0 own + 1 waiting still shows the summary.
 */
export function setSummary(s: ToastState, count: number, now: number, waiting = 0): ToastState {
  const ran = advance(s, now);
  const rest = ran.toasts.filter((t) => t.kind !== "summary");
  if (count <= 0 && waiting <= 0) return { ...ran, toasts: rest };
  const summary: Toast =
    waiting > 0
      ? { key: SUMMARY_KEY, kind: "summary", count, waiting, sticky: true, remaining: 0 }
      : { key: SUMMARY_KEY, kind: "summary", count, sticky: true, remaining: 0 };
  return { ...ran, toasts: [...rest, summary] };
}

/** FR-NOTE-45: the DM's waiting-for-players count of a store (players: none). */
export type WaitingCount = (store: RecordStore) => number;
const NONE: WaitingCount = () => 0;

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

/** Clears every toast and the callout (campaign switch). */
export function clearToasts(s: ToastState, now: number): ToastState {
  const ran = advance(s, now);
  return ran.callout ? { ...ran, toasts: [], callout: null } : { ...ran, toasts: [] };
}

/**
 * FR-NOTE-15 (P3 glitch 8: one toast per pending action): the pending-for-me rows without their
 * own toast on the stack; the summary counts only these (0 → no summary). A row whose toast was
 * hidden (FR-NOTE-26, e.g. its popup is or was open) counts as toasted: it doesn't come back as
 * the summary either (sim-6 glitch 3).
 */
export function untoastedPending(s: ToastState, store: RecordStore): number {
  const toasted = new Set([
    ...s.toasts.flatMap((t) => (t.kind === "note" ? [t.notificationId] : [])),
    ...(s.hiddenIds ?? []),
  ]);
  return pendingForMe(store).filter((n) => !toasted.has(n.id)).length;
}

/**
 * Keeps toasts in line with the store: a pending toast whose notification left `pending` (or
 * is gone) disappears; the summary follows the current count of pending-for-me rows without a
 * toast of their own.
 */
export function pruneToasts(
  s: ToastState,
  store: RecordStore,
  now: number,
  waitingOf: WaitingCount = NONE,
): ToastState {
  const ran = advance(s, now);
  const rows = (store.records[NOTIFICATION_TYPE] ?? {}) as Record<string, NotificationRecord>;
  const kept = ran.toasts.filter(
    (t) => !(t.kind === "note" && t.sticky && rows[t.notificationId]?.state !== "pending"),
  );
  const mine = untoastedPending({ ...ran, toasts: kept }, store);
  const waiting = ran.toasts.some((t) => t.kind === "summary") ? waitingOf(store) : 0;
  let changed = false;
  const toasts: Toast[] = [];
  for (const t of ran.toasts) {
    if (t.kind === "note" && t.sticky && rows[t.notificationId]?.state !== "pending") {
      changed = true;
      continue;
    }
    if (t.kind === "summary" && (t.count !== mine || (t.waiting ?? 0) !== waiting)) {
      changed = true;
      const { waiting: _old, ...rest } = t;
      if (mine > 0 || waiting > 0)
        toasts.push(waiting > 0 ? { ...rest, count: mine, waiting } : { ...rest, count: mine });
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
 * glitch 8; FR-NOTE-45: plus the DM's waiting-for-players count, `waitingOf`); created rows toast;
 * then the stack follows the store.
 */
export function syncToasts(
  m: ToastMemory,
  prev: SyncView | null,
  next: SyncView,
  t: Transition,
  now: number,
  waitingOf: WaitingCount = NONE,
  classOf: ClassOf = BY_STATE,
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
    s = setSummary(
      s,
      Math.min(summaryCount(t, store), untoastedPending(s, store)),
      now,
      waitingOf(store),
    );
  }
  for (const n of toastTriggers(prev, next, t)) s = addNote(s, n, now, classOf);
  s = pruneToasts(s, store, now, waitingOf);
  return s === m.toasts && campaignId === m.campaignId ? m : { toasts: s, campaignId };
}

/** A toast's class (FR-NOTE-50); the summary comes before every class. */
export function classOfToast(t: Toast): NotificationToastClass | "summary" {
  if (t.kind === "summary") return "summary";
  if (t.kind === "alert") return "alert";
  return t.cls ?? (t.sticky ? "card" : "info");
}

/** FR-NOTE-50: order from home. */
const RANK: Record<NotificationToastClass | "summary", number> = {
  summary: 0,
  card: 1,
  alert: 2,
  info: 3,
};

/**
 * FR-NOTE-50: what the stack shows, in order from home: the summary (DM), cards, alerts, info
 * (each oldest first). At most `max` (default `MAX_VISIBLE`) cards / alerts / info: the newest of
 * each class are kept, info held back before alerts before cards; `more` counts the held-back
 * ones ("+N more"). The summary and the callout don't count. The runtime lowers `max` while the
 * stack doesn't fit the viewport (P3 E3).
 */
export function visibleToasts(
  s: ToastState,
  max: number = MAX_VISIBLE,
): { shown: Toast[]; more: number; callout: Callout | null } {
  const room = Math.max(1, max);
  const counted = s.toasts.filter((t) => t.kind !== "summary");
  const kept = new Set<Toast>();
  for (const cls of ["card", "alert", "info"] as const) {
    const of = counted.filter((t) => classOfToast(t) === cls);
    for (let i = of.length - 1; i >= 0 && kept.size < room; i--) kept.add(of[i] as Toast);
  }
  const shown = s.toasts
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.kind === "summary" || kept.has(t))
    .sort((a, b) => RANK[classOfToast(a.t)] - RANK[classOfToast(b.t)] || a.i - b.i)
    .map(({ t }) => t);
  return { shown, more: counted.length - kept.size, callout: s.callout ?? null };
}

/** Milliseconds until the next timed toast (alert, info, callout) ends; null if none or paused. */
export function nextExpiry(s: ToastState): number | null {
  if (s.runningSince === null) return null;
  let min: number | null = s.callout ? s.callout.remaining : null;
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

// ---- FR-NOTE-50, -52: `showCallout` for every callout (the overkill toast, SB's kill feed) ----

export interface CalloutInput {
  /** The callout's id (`data-callout-id`); a newer callout replaces whichever shows. */
  id: string;
  /** What it shows (the caller's text and test id). */
  content: ReactNode;
  /** How long it shows, ms (default 4 s); the timer pauses while the stack is hovered. */
  ms?: number | undefined;
}

/**
 * FR-NOTE-50, -52: shows a callout in this page's one stack, after the info toasts. Not a
 * notification (no row, bell or history), one at a time (a new one replaces it), outside the
 * count of 3; the caller keeps to live frames. Client memory only; no runtime mounted → dropped.
 */
export function showCallout(c: CalloutInput): void {
  const now = Date.now();
  for (const m of memories) m.setState((x) => ({ toasts: setCallout(x.toasts, c, now) }));
}
