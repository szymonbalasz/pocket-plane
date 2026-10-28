// Pure client rules of notifications (NOTE §6–§7): which store transitions toast, the pending
// summary, unread count, button rules, list order and labels. No React, no browser APIs.
import { ENCOUNTER_TYPE } from "@shared/combat-tracker/schemas";
import {
  addressedTo,
  isActionOwner,
  type NoteViewer,
  type NotificationRecord,
} from "@shared/notifications/schemas";
import type { RecordStore } from "@shared/protocol/store";
import { encounterIdOfView, type NotificationViews } from "./views";

export const NOTIFICATION_TYPE = "notification";
export const HISTORY_KIND = "note.history";

export type ConnState = "connecting" | "live" | "reconnecting" | "waiting" | "rejected";

/** What the sync connection exposes on every change (`SyncSnapshot` subset). */
export interface SyncView {
  state: ConnState;
  store: RecordStore;
}

export function notificationsOf(store: RecordStore): NotificationRecord[] {
  return Object.values(store.records[NOTIFICATION_TYPE] ?? {}) as NotificationRecord[];
}

export function viewerOf(store: RecordStore): NoteViewer | null {
  const you = store.you;
  return you ? { role: you.role, playerId: you.playerId } : null;
}

export function maxSeq(store: RecordStore): number {
  let m = 0;
  for (const n of notificationsOf(store)) if (n.seq > m) m = n.seq;
  return m;
}

/**
 * One sync change, classified (FR-NOTE-13/15):
 * - `connect`: the first snapshot of a page load or a (re)connection (state was not `live`, or
 *   the campaign changed); also the runtime's first look (`prev` null) at a store, even if
 *   events already followed the snapshot before it mounted;
 * - `resync`: a snapshot while `live` (scene switch, gap);
 * - `event`: one `event` frame applied (store `seq` + 1);
 * - null: no store change.
 */
export type Transition = "connect" | "resync" | "event" | null;

export function classify(prev: SyncView | null, next: SyncView): Transition {
  if (!next.store.you) return null;
  if (prev === null) return "connect";
  if (next.store === prev.store) return null;
  if (next.store.seq === 0) {
    const same = prev.state === "live" && prev.store.you?.campaignId === next.store.you.campaignId;
    return same ? "resync" : "connect";
  }
  if (next.store.seq === prev.store.seq + 1) return "event";
  return null;
}

/**
 * Notifications an `event` frame created (FR-NOTE-13): IDs not yet in the store and newer than
 * every row the client holds. Audience is immutable and rows are never deleted, so a new ID in
 * an event is a `NotificationCreated` upsert; the `seq` check excludes the only other case,
 * a state change of a row below the snapshot window floor (ADR-0029).
 * Inferred from the store (no `cause` hook in the sync client; orchestrator-approved). Known
 * edge case: a client holding no notification rows at all that receives a below-floor row it
 * can see being reopened would read it as created. In MVP only `damage-card` is reopened and
 * its action owner (the only toast target for pending) is the DM, who holds every row, so the
 * rule is exact; revisit if a reopenable kind ever gets a player action owner.
 */
export function createdIn(prev: RecordStore, next: RecordStore): NotificationRecord[] {
  const before = prev.records[NOTIFICATION_TYPE] ?? {};
  const floor = maxSeq(prev);
  return notificationsOf(next)
    .filter((n) => !(n.id in before) && n.seq > floor)
    .sort((a, b) => a.seq - b.seq);
}

/** FR-NOTE-13: info → the audience (DM: `dm`/`all`); pending → the action owner only. */
export function toastsFor(n: NotificationRecord, v: NoteViewer): boolean {
  if (n.state === "pending") return isActionOwner(n, v);
  if (n.state === "info") return addressedTo(n, v);
  return false;
}

/** Toasts for one transition: only `event` frames ever toast per item. */
export function toastTriggers(
  prev: SyncView | null,
  next: SyncView,
  t: Transition = classify(prev, next),
): NotificationRecord[] {
  if (t !== "event" || prev === null) return [];
  const v = viewerOf(next.store);
  if (!v) return [];
  return createdIn(prev.store, next.store).filter((n) => toastsFor(n, v));
}

/** FR-NOTE-15: pending notifications whose action owner is this client. */
export function pendingForMe(store: RecordStore): NotificationRecord[] {
  const v = viewerOf(store);
  if (!v) return [];
  return notificationsOf(store).filter((n) => n.state === "pending" && isActionOwner(n, v));
}

/** FR-NOTE-15: summary count after a `connect` snapshot; 0 = no summary toast. */
export function summaryCount(t: Transition, store: RecordStore): number {
  return t === "connect" ? pendingForMe(store).length : 0;
}

/**
 * FR-NOTE-45 (BL-48, DM only): pending rows of the started encounter whose action owner is a player
 * (Initiative's "Waiting for …" rows, FR-CBT-79, linked by their kind's view, FR-NOTE-29); 0 for
 * players or with no started encounter. With the DM's own N, N + M = Initiative's "Pending (n)".
 */
export function waitingForPlayers(store: RecordStore, views: NotificationViews): number {
  if (viewerOf(store)?.role !== "dm") return 0;
  const started = Object.values(store.records[ENCOUNTER_TYPE] ?? {}).find(
    (e) => (e as { status?: string }).status === "started",
  ) as { id: string } | undefined;
  return encounterPending(notificationsOf(store), started?.id, views).filter(
    (n) => n.actionRole === "player",
  ).length;
}

/**
 * BL-120: the pending rows linked to `encounterId` by their kind's view (FR-NOTE-29), store order:
 * the one count source of Initiative's "Pending (n)" (FR-CBT-79) and the summary's waiting part.
 */
export function encounterPending(
  notes: readonly NotificationRecord[],
  encounterId: string | null | undefined,
  views: NotificationViews,
): NotificationRecord[] {
  if (!encounterId) return [];
  return notes.filter(
    (n) => n.state === "pending" && encounterIdOfView(views.get(n.kind), n.payload) === encounterId,
  );
}

/**
 * FR-NOTE-15: "2 pending actions"; FR-NOTE-45: " · 1 waiting for a player" appended (M >= 1), or
 * the waiting part alone when the DM has none of their own ("2 waiting for players").
 */
export function summaryText(n: number, waiting = 0): string {
  const own = `${n} pending action${n === 1 ? "" : "s"}`;
  if (waiting <= 0) return own;
  const others = waiting === 1 ? "1 waiting for a player" : `${waiting} waiting for players`;
  return n > 0 ? `${own} · ${others}` : others;
}

/**
 * FR-NOTE-79 (BL-141): the compact summary's one short line: "N pending" (the DM's own), else
 * "N waiting"; the whole `summaryText` is its Tooltip and label.
 */
export function compactSummaryText(n: number, waiting = 0): string {
  return n > 0 || waiting <= 0 ? `${n} pending` : `${waiting} waiting`;
}

/**
 * FR-NOTE-18: addressed to this client by the FR-NOTE-13 rule (owner for actions). FR-NOTE-24
 * (#178): an action row counts only while `pending`; applied, dismissed or closed at End leaves
 * the bell, reopened counts again. FR-NOTE-27 (G9): the DM also counts a player-owned pending row
 * (the DM may act on it, FR-NOTE-08); it still doesn't toast for the DM (`toastsFor`).
 * BL-130 (sim-16 h04: the bell 7 beside Initiative's "Pending (5)", two unread fight summaries):
 * the DM's bell counts pending actions only, the rows the summary and Pending count (FR-NOTE-15,
 * -45); an info row doesn't (it toasts; the window lists it). Players unchanged.
 */
export function addressedForUnread(n: NotificationRecord, v: NoteViewer): boolean {
  if (n.actionRole === null) return v.role !== "dm" && addressedTo(n, v);
  if (n.state !== "pending") return false;
  return isActionOwner(n, v) || (v.role === "dm" && n.actionRole === "player");
}

/** FR-NOTE-18: addressed notifications with row `seq` > last seen. */
export function unreadCount(store: RecordStore, lastSeen: number): number {
  const v = viewerOf(store);
  if (!v) return 0;
  return notificationsOf(store).filter((n) => n.seq > lastSeen && addressedForUnread(n, v)).length;
}

/** FR-NOTE-18 storage key per (campaign, owner). */
export function seenKey(store: RecordStore): string | null {
  const you = store.you;
  if (!you) return null;
  const owner = you.role === "dm" ? "dm" : (you.playerId ?? "player");
  return `pp.note.seen.v1.${you.campaignId}.${owner}`;
}

export type ButtonMode = "none" | "disabled" | "enabled";

/**
 * FR-NOTE-16: the action button exists on a pending notification for its action owner and the
 * DM, if the kind has an `onAction` or is `genericResolve`; it is enabled only while `live`
 * (§7: disconnected → disabled).
 */
export function actionButton(
  n: NotificationRecord,
  v: NoteViewer,
  live: boolean,
  view: { onAction?: unknown; genericResolve?: boolean } | undefined,
): ButtonMode {
  if (n.state !== "pending" || n.actionLabel === null) return "none";
  if (v.role !== "dm" && !isActionOwner(n, v)) return "none";
  if (!view?.onAction && !view?.genericResolve) return "none";
  return live ? "enabled" : "disabled";
}

/** FR-NOTE-11/17: Dismiss on pending rows, DM only. */
export function dismissButton(n: NotificationRecord, v: NoteViewer, live: boolean): ButtonMode {
  if (n.state !== "pending" || v.role !== "dm") return "none";
  return live ? "enabled" : "disabled";
}

/**
 * FR-NOTE-17: Pending (DM: all; player: pending they own), then History; newest first. BL-137
 * (sprint 14, K9: a player's own attack cards listed under History as "Waiting for DM"): a pending
 * row a player sees but doesn't own is in `waiting` (its own section between them), never in
 * History, which holds closed and info rows only. The DM has none. The rows are what the player
 * already receives (FR-NOTE-06): no new data.
 */
export function historySections(store: RecordStore): {
  pending: NotificationRecord[];
  waiting: NotificationRecord[];
  history: NotificationRecord[];
} {
  const v = viewerOf(store);
  const all = notificationsOf(store).sort((a, b) => b.seq - a.seq);
  if (!v) return { pending: [], waiting: [], history: [] };
  const isPendingRow = (n: NotificationRecord) =>
    n.state === "pending" && (v.role === "dm" || isActionOwner(n, v));
  // BL-137: a player's row pending on someone else (their attack's card "Waiting for DM").
  const isWaiting = (n: NotificationRecord) => n.state === "pending" && !isPendingRow(n);
  return {
    pending: all.filter(isPendingRow),
    waiting: all.filter(isWaiting),
    history: all.filter((n) => n.state !== "pending"),
  };
}

type Names = (playerId: string | null) => string;

/**
 * FR-NOTE-17 state badge; null for info rows. FR-NOTE-28 (G9): a resolved row with no actor was
 * closed by a rule → "Closed" (the kind's view says why).
 */
export function stateLabel(n: NotificationRecord, nameOf: Names): string | null {
  switch (n.state) {
    case "pending":
      return "Pending";
    case "dismissed":
      return "Dismissed";
    case "resolved":
      if (n.closedByRole === null) return "Closed";
      return `Resolved by ${n.closedByRole === "player" ? nameOf(n.closedByPlayerId) : "DM"}`;
    default:
      return null;
  }
}

/** Who a row names: the DM or a player (a `ColorPerson`, FR-CAMP-28). */
export interface NotePerson {
  role: "dm" | "player";
  playerId: string | null;
}

/** FR-NOTE-39: who caused the row (`byRole` / `byPlayerId`); null = no one (old row, system). */
export const causerOf = (n: NotificationRecord): NotePerson | null =>
  n.byRole === null ? null : { role: n.byRole, playerId: n.byPlayerId };

/** FR-NOTE-40: who "Resolved by ‹name›" names; null for every other badge ("Closed" too). */
export const closerOf = (n: NotificationRecord): NotePerson | null =>
  n.state === "resolved" && n.closedByRole !== null
    ? { role: n.closedByRole, playerId: n.closedByPlayerId }
    : null;

/** `data-by` on toasts and rows: the causer's player id, `dm`, or absent. */
export const byAttr = (n: NotificationRecord): string | undefined =>
  n.byRole === "dm" ? "dm" : n.byRole === "player" ? (n.byPlayerId ?? undefined) : undefined;

/** FR-NOTE-17 DM audience tag. */
export function audienceLabel(n: NotificationRecord, nameOf: Names): string {
  if (n.audience === "dm") return "DM";
  if (n.audience === "all") return "All";
  return nameOf(n.audiencePlayerId);
}

/** FR-NOTE-20: message for a rejected action. */
export function rejectMessage(err: unknown): string {
  const e = err as { code?: unknown; message?: unknown } | null;
  if (e && e.code === "conflict") return "No longer pending";
  return typeof e?.message === "string" && e.message ? e.message : "Action failed";
}

/**
 * FR-KIT-56: a toast's small second line, from `createdAt`: "just now" under a minute, then
 * "N min ago", "N h ago", "N d ago". A future or unreadable stamp reads "just now".
 */
export function relativeTime(iso: string, now: number): string {
  const at = Date.parse(iso);
  const s = Number.isNaN(at) ? 0 : Math.floor((now - at) / 1000);
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

/**
 * FR-KIT-56: the text split where the causing player's name starts it ("**Player 1** wants to
 * add …"); `lead` is null when the text doesn't start with the name.
 */
export function leadName(text: string, name: string | null): { lead: string | null; rest: string } {
  if (!name || !text.startsWith(name)) return { lead: null, rest: text };
  const next = text.charAt(name.length);
  // A whole word only ("Mira" never bolds "Miranda …").
  if (next && /[\p{L}\p{N}]/u.test(next)) return { lead: null, rest: text };
  return { lead: name, rest: text.slice(name.length) };
}
