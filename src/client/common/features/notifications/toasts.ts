// Toast stack model (FR-NOTE-14/15, -50): pure state + an injected clock. One stack per client;
// each toast has a class (FR-NOTE-50): cards (pending) stay until their notification leaves
// `pending` or the user closes them (closing ≠ dismissing); alert and info toasts hide after 6 s;
// one callout (not a notification, `showCallout`) hides after 4 s and a new one replaces it.
// Timers pause while the stack is hovered or the tab is hidden. At most 3 cards / alerts / info
// show (info held back first, then alerts); the rest count as "+N more". Client memory only.
// *(Sprint 9)* FR-NOTE-72: while this client's Notifications window is open, cards and the summary
// fold into it (`visibleToasts(…, folded)`), and come back silently when it closes (`unfold`).
// FR-NOTE-73: each callout show has a page-wide `seq` (its node's key). Kit parity K3
// (FR-KIT-59, OQ-KIT-03 A): the DM's turn card, first in the stack for 4 s (`showTurnCard`).
import type { NotificationRecord } from "@shared/notifications/schemas";
import {
  type NotificationToastClass,
  TOAST_CLASS_MS,
  toastClassOf,
} from "@shared/notifications/toast-class";
import type { RecordStore } from "@shared/protocol/store";
import type { ReactNode } from "react";
import { createStore, type StoreApi } from "zustand";
import { pauseGate } from "../pause/gate";
import { isPausedFor } from "../pause/logic";
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
/** FR-NOTE-60: kinds whose pending rows re-toast on a connect (the view's `restoreToast`). */
export type Restores = (n: NotificationRecord) => boolean;
const NO_RESTORE: Restores = () => false;

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
  /** FR-NOTE-73: this show's page-wide counter (a fresh node per show); absent = 0. */
  seq?: number;
  content: ReactNode;
  remaining: number;
}

/** FR-KIT-59 (OQ-KIT-03 A): the DM's turn card ("Mira's turn"); a newer one replaces it. */
export interface TurnCardToast {
  text: string;
  /** This show's page-wide counter (a fresh node per show). */
  seq: number;
  remaining: number;
}

export interface ToastState {
  /** Insertion order, oldest first. */
  toasts: Toast[];
  /** FR-KIT-59: the turn card showing, first in the stack, outside the count of 3. */
  turn?: TurnCardToast | null;
  /** FR-NOTE-50: the callout showing, outside the count of 3. Optional: absent = none. */
  callout?: Callout | null;
  /**
   * FR-NOTE-26: notifications whose toast was hidden (`closeToast()` of an action, `hideToast`);
   * their toast doesn't come back in this page load. Optional: absent = none.
   */
  hiddenIds?: readonly string[];
  /**
   * BL-120: hidden rows whose popup closed while still pending (the damage-card popup's Later,
   * another card opened): they stay without a toast (FR-NOTE-26) and count in the summary.
   * Optional: absent = none.
   */
  releasedIds?: readonly string[];
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
  const tick = <T extends { remaining: number }>(x: T): T | null =>
    x.remaining - dt > 0 ? { ...x, remaining: x.remaining - dt } : null;
  const next: ToastState = { ...s, toasts, runningSince: now };
  if (s.callout) next.callout = tick(s.callout);
  if (s.turn) next.turn = tick(s.turn);
  return next;
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

/**
 * FR-NOTE-50: shows a callout; one showing is replaced (one at a time). FR-NOTE-73: `seq` (the
 * show's page-wide counter) makes the replacement a new node with its own 4 s.
 */
export function setCallout(s: ToastState, c: CalloutInput, now: number, seq = 0): ToastState {
  const ran = advance(s, now);
  const remaining = c.ms ?? CALLOUT_MS;
  return { ...ran, callout: { id: c.id, seq, content: c.content, remaining } };
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
  let ran = closeToast(s, notificationId, now);
  // BL-120: hidden again (its popup reopened): the popup shows it, the summary counts it no more.
  if (ran.releasedIds?.includes(notificationId)) {
    const releasedIds = ran.releasedIds.filter((id) => id !== notificationId);
    const toasts = ran.toasts.flatMap((t): Toast[] => {
      if (t.kind !== "summary") return [t];
      const count = Math.max(0, t.count - 1);
      return count > 0 || (t.waiting ?? 0) > 0 ? [{ ...t, count }] : [];
    });
    ran = { ...ran, toasts, releasedIds };
  }
  if (ran.hiddenIds?.includes(notificationId)) return ran;
  return { ...ran, hiddenIds: [...(ran.hiddenIds ?? []), notificationId] };
}

/**
 * BL-120 (sim-15 glitch 3: a card put off with "Later" was counted nowhere): the popups showing
 * `ids` closed. Each hidden row among them that is still pending for this client stays without a
 * toast (FR-NOTE-26) and counts in the summary, which shows for it if it didn't; resolved rows
 * stay hidden (their Undo's reopen doesn't toast, as before). Nothing to release → the same state.
 */
export function releaseHidden(
  s: ToastState,
  ids: readonly string[],
  store: RecordStore,
  now: number,
  waitingOf: WaitingCount = NONE,
): ToastState {
  const mine = new Set(pendingForMe(store).map((n) => n.id));
  const released = s.releasedIds ?? [];
  const add = ids.filter(
    (id) => mine.has(id) && s.hiddenIds?.includes(id) && !released.includes(id),
  );
  if (add.length === 0) return s;
  const next = { ...advance(s, now), releasedIds: [...released, ...add] };
  return setSummary(next, untoastedPending(next, store), now, waitingOf(store));
}

/** Clears every toast, the callout and the turn card (campaign switch). */
export function clearToasts(s: ToastState, now: number): ToastState {
  const ran = advance(s, now);
  const next: ToastState = { ...ran, toasts: [] };
  if (ran.callout) next.callout = null;
  if (ran.turn) next.turn = null;
  return next;
}

/** FR-KIT-59: how long the DM's turn card shows (OQ-KIT-03 A: 4 s; paused like the others). */
export const TURN_CARD_MS = 4000;

/** FR-KIT-59: shows the DM's turn card; one showing is replaced (a new node, its own 4 s). */
export function setTurnCard(s: ToastState, text: string, now: number, seq = 0): ToastState {
  return { ...advance(s, now), turn: { text, seq, remaining: TURN_CARD_MS } };
}

/**
 * FR-NOTE-15 (P3 glitch 8: one toast per pending action): the pending-for-me rows without their
 * own toast on the stack; the summary counts only these (0 → no summary). A row whose toast was
 * hidden (FR-NOTE-26, e.g. its popup is open) counts as toasted: it doesn't come back as the
 * summary either (sim-6 glitch 3). BL-120: once its popup closed with it still pending
 * (`releaseHidden`), it counts.
 */
export function untoastedPending(s: ToastState, store: RecordStore): number {
  const released = new Set(s.releasedIds ?? []);
  const toasted = new Set([
    ...s.toasts.flatMap((t) => (t.kind === "note" ? [t.notificationId] : [])),
    ...(s.hiddenIds ?? []).filter((id) => !released.has(id)),
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
  restores: Restores = NO_RESTORE,
): ToastMemory {
  if (t === null) return m;
  const store = next.store;
  let s = m.toasts;
  let campaignId = m.campaignId;
  if (t === "connect") {
    const cid = store.you?.campaignId ?? null;
    if (cid !== campaignId) s = clearToasts(s, now);
    campaignId = cid;
    // FR-NOTE-60: restorable pending rows of mine re-toast (silently: a connect starts no cue),
    // so they have a toast of their own and stay out of the summary.
    for (const n of pendingForMe(store)) if (restores(n)) s = addNote(s, n, now, classOf);
    // Only pending rows without a toast of their own (a sticky card kept over a reconnect).
    s = setSummary(
      s,
      Math.min(summaryCount(t, store), untoastedPending(s, store)),
      now,
      waitingOf(store),
    );
  }
  for (const n of toastTriggers(prev, next, t)) {
    // FR-SHELL-127, FR-NOTE-63: under the pause card info goes to history only; cards wait.
    if (isPausedFor(store) && classOf(n) === "info") continue;
    s = addNote(s, n, now, classOf);
  }
  s = pruneToasts(s, store, now, waitingOf);
  return s === m.toasts && campaignId === m.campaignId ? m : { toasts: s, campaignId };
}

/**
 * FR-NOTE-72: the Notifications window closed or minimised: the folded cards show again as they
 * are (silent: no cue starts here) and the summary comes back for the pending rows without a
 * toast of their own. A card the user closed stays closed (it is no longer on the stack).
 */
export function unfold(
  s: ToastState,
  store: RecordStore,
  now: number,
  waitingOf: WaitingCount = NONE,
): ToastState {
  return setSummary(s, untoastedPending(s, store), now, waitingOf(store));
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
 * (each oldest first). At most `max` (default `MAX_VISIBLE`) cards / alerts / info. Alerts always
 * show (an error is never held back, walkthrough T4): they take the room first, then the newest
 * cards, then the newest info (info held back before cards), at least one of those beside the
 * alerts; `more` counts the held-back ones
 * ("+N more"). The summary and the callout don't count. The runtime lowers `max` while the stack
 * doesn't fit the viewport (P3 E3). FR-NOTE-72: `folded` (this client's Notifications window open)
 * leaves out the summary and every card; they stay on the stack and neither shows nor counts.
 * FR-NOTE-77: `max` 0 while the summary shows (its Open keeps the pending actions one click
 * away) folds every card and info into "+N more"; without the summary one still shows.
 * BL-120 (sim-15 glitch 3: "1 pending action +2 more" beside Initiative's "Pending (3)"): while
 * the summary shows, the held-back cards count in it (`inSummary`, added to its count), not in
 * "+N more" (held-back alerts and info only), so each pending action counts once on the stack.
 */
export function visibleToasts(
  s: ToastState,
  max: number = MAX_VISIBLE,
  folded = false,
): { shown: Toast[]; more: number; inSummary: number; callout: Callout | null } {
  const out = (t: Toast) => folded && (t.kind === "summary" || classOfToast(t) === "card");
  const summary = !folded && s.toasts.some((t) => t.kind === "summary");
  const room = Math.max(summary ? 0 : 1, max);
  const counted = s.toasts.filter((t) => t.kind !== "summary" && !out(t));
  const kept = new Set<Toast>(counted.filter((t) => classOfToast(t) === "alert"));
  // P3 E3: at least one card / info still shows beside the alerts (a pending action stays one
  // click away); FR-NOTE-77: the summary's Open does that at `max` 0.
  const fill = room === 0 ? kept.size : Math.max(room, kept.size + 1);
  for (const cls of ["card", "info"] as const) {
    const of = counted.filter((t) => classOfToast(t) === cls);
    for (let i = of.length - 1; i >= 0 && kept.size < fill; i--) kept.add(of[i] as Toast);
  }
  const shown = s.toasts
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => (t.kind === "summary" && !folded) || kept.has(t))
    .sort((a, b) => RANK[classOfToast(a.t)] - RANK[classOfToast(b.t)] || a.i - b.i)
    .map(({ t }) => t);
  const inSummary = summary
    ? counted.filter((t) => !kept.has(t) && classOfToast(t) === "card").length
    : 0;
  const more = counted.length - kept.size - inSummary;
  return { shown, more, inSummary, callout: s.callout ?? null };
}

/**
 * FR-NOTE-78 (walkthrough F2 1b, 2a): the summary alone shows (every card and info folded) →
 * "+N more" sits in the summary's row, so the folded stack is the summary's height (58 px, not 92:
 * the taller one found no spot off the windows' forms).
 */
export const moreInSummary = (shown: readonly Toast[], more: number): boolean =>
  more > 0 && shown.length === 1 && shown[0]?.kind === "summary";

/** Milliseconds until the next timed toast (alert, info, callout, turn card) ends; null if none or paused. */
export function nextExpiry(s: ToastState): number | null {
  if (s.runningSince === null) return null;
  let min: number | null = s.callout ? s.callout.remaining : null;
  if (s.turn && (min === null || s.turn.remaining < min)) min = s.turn.remaining;
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

/** FR-NOTE-73: the page-wide callout show counter. */
let calloutSeq = 0;

/**
 * FR-NOTE-50, -52: shows a callout in this page's one stack, after the info toasts. Not a
 * notification (no row, bell or history), one at a time (a new one replaces it, as a new node:
 * FR-NOTE-73), outside the count of 3; the caller keeps to live frames. Client memory only; no
 * runtime mounted → dropped.
 */
export function showCallout(c: CalloutInput): void {
  if (pauseGate.paused()) return; // FR-SHELL-127: dropped under the pause card, not replayed
  const now = Date.now();
  calloutSeq += 1;
  const seq = calloutSeq;
  for (const m of memories) m.setState((x) => ({ toasts: setCallout(x.toasts, c, now, seq) }));
}

/** The runtime's fold state: its cap and the stack height it last folded at. */
export interface FoldState {
  cap: number;
  foldedAt: number | null;
}

/**
 * P3 E3, walkthrough WF4, FR-NOTE-77: one fold step. While the stack doesn't fit (`need`: taller
 * than the room, or only a spot on window content holds it), one shown card / info (`shown` of
 * them at this cap) folds into "+N more", down to `min`. Walkthrough H3 re-test 1a: the next step
 * waits for the stack's new height (`stackH` ≠ `foldedAt`, measured a frame after the cap
 * changes), so it never folds a card that fits.
 */
export function foldCap(
  s: FoldState,
  o: { need: boolean; min: number; stackH: number; shown: number },
): FoldState {
  if (!o.need || s.cap <= o.min) return s;
  if (s.foldedAt !== null && s.foldedAt === o.stackH) return s;
  const cap = Math.max(o.min, Math.min(s.cap, o.shown) - 1);
  return cap === s.cap ? s : { cap, foldedAt: o.stackH };
}

/** BL-115: how long the drawn spot may hold while the fold steps (a step that never re-measures). */
export const SETTLE_HOLD_MS = 300;

/** BL-115: a layout change (window rects, tool bars, dialogs) refolds once it held still this long. */
export const REFOLD_QUIET_MS = 250;

/** The runtime's fold and the spot it draws the DM stack at (BL-115). */
export interface StackSettle {
  fold: FoldState;
  /** The spot drawn: the computed one, held where it was while the fold steps. */
  drawn: { left: number; top: number } | null;
  /** The fold is stepping and `drawn` holds. */
  hold: boolean;
  /** When the hold began (`SETTLE_HOLD_MS` caps it); null while not stepping. */
  heldSince: number | null;
}

/** No fold, nothing drawn yet. */
export const UNSETTLED: StackSettle = {
  fold: { cap: MAX_VISIBLE, foldedAt: null },
  drawn: null,
  hold: false,
  heldSince: null,
};

/**
 * BL-115 (sim-14, H3 re-test 2 O1: 520,100 → 480,140 → 480,254 → 520,100 within ~70 ms): one
 * frame of the runtime's fold (`foldCap`) and the spot it draws. While the fold steps (it just
 * folded, or waits for the new height of a stack that still doesn't fit) the stack holds the spot
 * it was drawn at; once it rests it moves once, to the spot computed for its folded height. A hold
 * lasts at most `SETTLE_HOLD_MS`. Same state back when nothing changed.
 */
export function settleStack(
  s: StackSettle,
  o: {
    need: boolean;
    min: number;
    stackH: number;
    shown: number;
    spot: { left: number; top: number };
    now: number;
  },
): StackSettle {
  const fold = foldCap(s.fold, o);
  const stepping = o.stackH > 0 && o.need && fold.cap > o.min && fold.foldedAt === o.stackH;
  const fresh = s.heldSince === null || o.now - s.heldSince < SETTLE_HOLD_MS;
  const hold = stepping && s.drawn !== null && fresh;
  const drawn = hold ? s.drawn : { left: o.spot.left, top: o.spot.top };
  const heldSince = stepping ? (s.heldSince ?? o.now) : null;
  const same =
    fold === s.fold &&
    hold === s.hold &&
    heldSince === s.heldSince &&
    drawn?.left === s.drawn?.left &&
    drawn?.top === s.drawn?.top;
  return same ? s : { fold, drawn, hold, heldSince };
}

/** A new count or room (and a quiet layout change, `REFOLD_QUIET_MS`): the fold starts over. */
export const refold = (s: StackSettle): StackSettle =>
  s.fold.cap === MAX_VISIBLE && s.fold.foldedAt === null
    ? s
    : { ...s, fold: { cap: MAX_VISIBLE, foldedAt: null } };

/** FR-KIT-59: the page-wide turn card show counter. */
let turnSeq = 0;

/**
 * FR-KIT-59 (OQ-KIT-03 A): shows the DM's turn card first in this page's stack for 4 s. Client
 * memory only, from live frames (the caller's rule); dropped under the pause card, as a callout.
 */
export function showTurnCard(text: string): void {
  if (pauseGate.paused()) return;
  const now = Date.now();
  turnSeq += 1;
  const seq = turnSeq;
  for (const m of memories) m.setState((x) => ({ toasts: setTurnCard(x.toasts, text, now, seq) }));
}
