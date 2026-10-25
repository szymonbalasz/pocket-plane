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
 * FR-NOTE-18: addressed to this client by the FR-NOTE-13 rule (owner for actions). FR-NOTE-24
 * (#178): an action row counts only while `pending`; applied, dismissed or closed at End leaves
 * the bell, reopened counts again. FR-NOTE-27 (G9): the DM also counts a player-owned pending row
 * (the DM may act on it, FR-NOTE-08); it still doesn't toast for the DM (`toastsFor`).
 */
export function addressedForUnread(n: NotificationRecord, v: NoteViewer): boolean {
  if (n.actionRole === null) return addressedTo(n, v);
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

/** FR-NOTE-17: Pending (DM: all; player: pending they own), then History; newest first. */
export function historySections(store: RecordStore): {
  pending: NotificationRecord[];
  history: NotificationRecord[];
} {
  const v = viewerOf(store);
  const all = notificationsOf(store).sort((a, b) => b.seq - a.seq);
  if (!v) return { pending: [], history: [] };
  const isPendingRow = (n: NotificationRecord) =>
    n.state === "pending" && (v.role === "dm" || isActionOwner(n, v));
  return { pending: all.filter(isPendingRow), history: all.filter((n) => !isPendingRow(n)) };
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
