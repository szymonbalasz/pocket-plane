// Client notification view contract (FR-NOTE-19). Each client lists its views in
// `src/client/{dm,player}/notification-views.ts` (append-only, AGENTS §9.9).
import { checkEndRule, type EncounterEndRule } from "@shared/notifications/end-rule";
import type { NotificationRecord } from "@shared/notifications/schemas";
import { checkToastClass, type NotificationToastClass } from "@shared/notifications/toast-class";
import type { RecordStore } from "@shared/protocol/store";
import type { ComponentType } from "react";

/** FR-NOTE-26: where the action was clicked; `rect` = the toast's or row's box, viewport px. */
export interface NotificationActionOrigin {
  source: "toast" | "history";
  rect: { x: number; y: number; w: number; h: number };
}

export interface NotificationActionContext {
  /** Sends an intent; rejects with the server's reject (FR-NOTE-20 toasts it). */
  send(name: string, payload: unknown): Promise<unknown>;
  /** Opens (or brings to front) a window of this client. */
  openWindow(kind: string, instance?: string): void;
  /** FR-NOTE-26: the clicked toast / row. */
  origin: NotificationActionOrigin;
  /** FR-NOTE-26: closes this notification's toast locally (as the user's close; no dismiss). */
  closeToast(): void;
}

export interface NotificationView {
  kind: string;
  icon: ComponentType<{ className?: string }>;
  /** Row / toast body; default: the notification's text. Renders text, never HTML. */
  render?: ComponentType<{ notification: NotificationRecord }>;
  /** Action click (FR-NOTE-16); a returned promise that rejects is toasted (FR-NOTE-20). */
  onAction?: (n: NotificationRecord, ctx: NotificationActionContext) => unknown;
  /** No `onAction`: the button sends `note.resolve` (server kind is `genericResolve`). */
  genericResolve?: boolean;
  /** FR-NOTE-23: the same end-rule constant as the server kind (pending rows End will close). */
  endRule?: EncounterEndRule;
  /**
   * FR-NOTE-29: the encounter this row belongs to (combat's DM Pending list, FR-CBT-79). Plain
   * function; absent → the end rule's `encounterIdOf`, else none.
   */
  encounterIdOf?: (payload: unknown) => string | null;
  /**
   * FR-NOTE-30 (DM view only): tokens to cue for a new pending player action. Absent → the
   * default rule (the action player's tokens on the viewed scene, `token-cue.ts`).
   * `viewedSceneId`: the DM's viewed scene (only its tokens are drawn).
   */
  cueTokens?: (n: NotificationRecord, store: RecordStore, viewedSceneId: string | null) => string[];
  /**
   * FR-NOTE-32 (DM view only, P3 glitch 2): tokens this row's toast should keep clear of (a card's
   * likely targets); only the drawn ones count. Absent → none.
   */
  avoidTokens?: (n: NotificationRecord, store: RecordStore) => string[];
  /**
   * Sprint 8 (FR-NOTE-50, -52): the kind's toast class, the same as its server kind's: pending →
   * card, else info (or alert). Named on every line of the client lists; a pending row is always
   * a card. Absent → by the row's state.
   */
  toastClass?: NotificationToastClass;
}

/** A client list's line: the view with its toast class named (FR-NOTE-52). */
export type RegisteredView = NotificationView & { toastClass: NotificationToastClass };

export function defineNotificationView(v: NotificationView): NotificationView {
  return v;
}

/** FR-NOTE-29: the view's `encounterIdOf`, else its end rule's, else null. */
export function encounterIdOfView(
  v: NotificationView | undefined,
  payload: unknown,
): string | null {
  if (v?.encounterIdOf) return v.encounterIdOf(payload);
  return v?.endRule ? v.endRule.encounterIdOf(payload) : null;
}

export interface NotificationViews {
  get(kind: string): NotificationView | undefined;
}

/** Throws on a duplicate kind, so a broken registration fails at load. */
export function createNotificationViews(list: readonly NotificationView[]): NotificationViews {
  const map = new Map<string, NotificationView>();
  for (const v of list) {
    if (map.has(v.kind)) throw new Error(`notification view "${v.kind}" registered twice`);
    checkEndRule(v.kind, v.endRule);
    checkToastClass(v.kind, v.toastClass);
    map.set(v.kind, v);
  }
  return { get: (kind) => map.get(kind) };
}

/** FR-NOTE-26: the origin of a click inside a toast / row element (its bounding box). */
export function originOf(
  source: NotificationActionOrigin["source"],
  el: Element | null,
): NotificationActionOrigin {
  const r = el?.getBoundingClientRect();
  return {
    source,
    rect: r ? { x: r.left, y: r.top, w: r.width, h: r.height } : { x: 0, y: 0, w: 0, h: 0 },
  };
}
