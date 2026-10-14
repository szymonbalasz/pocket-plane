// Client notification view contract (FR-NOTE-19). Each client lists its views in
// `src/client/{dm,player}/notification-views.ts` (append-only, AGENTS §9.9).
import { checkEndRule, type EncounterEndRule } from "@shared/notifications/end-rule";
import type { NotificationRecord } from "@shared/notifications/schemas";
import type { ComponentType } from "react";

export interface NotificationActionContext {
  /** Sends an intent; rejects with the server's reject (FR-NOTE-20 toasts it). */
  send(name: string, payload: unknown): Promise<unknown>;
  /** Opens (or brings to front) a window of this client. */
  openWindow(kind: string, instance?: string): void;
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
}

export function defineNotificationView(v: NotificationView): NotificationView {
  return v;
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
