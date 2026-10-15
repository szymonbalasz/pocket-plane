// Client notification view contract (FR-NOTE-19). Each client lists its views in
// `src/client/{dm,player}/notification-views.ts` (append-only, AGENTS §9.9).
import { checkEndRule, type EncounterEndRule } from "@shared/notifications/end-rule";
import type { NotificationRecord } from "@shared/notifications/schemas";
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
  /**
   * FR-NOTE-26: the clicked toast / row. Optional until the runtime fills it
   * (fix/combat2-polish); a view must cope with it absent.
   */
  origin?: NotificationActionOrigin;
  /** FR-NOTE-26: closes this notification's toast locally (as the user's close; no dismiss). */
  closeToast?(): void;
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
   * default rule (the action player's tokens on the viewed scene).
   */
  cueTokens?: (n: NotificationRecord, store: RecordStore) => string[];
}

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
    map.set(v.kind, v);
  }
  return { get: (kind) => map.get(kind) };
}
