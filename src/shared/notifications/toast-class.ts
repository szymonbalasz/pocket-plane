// Toast classes (FR-NOTE-50, -52; sprint 8, seams S3–S5, S13): every toast in a client's one
// stack has a class. A notification kind names its class (server `kinds.ts`, client
// `notification-views.ts`); callouts are not notifications (`showCallout`, client only).
import type { NotificationState } from "./schemas";

/** Classes a notification kind may name: pending → card, else info (or alert). */
export const NOTIFICATION_TOAST_CLASSES = ["card", "alert", "info"] as const;
export type NotificationToastClass = (typeof NOTIFICATION_TOAST_CLASSES)[number];

/** Every class in the stack, in order from home (after the DM summary, FR-NOTE-50). */
export const TOAST_CLASSES = [...NOTIFICATION_TOAST_CLASSES, "callout"] as const;
export type ToastClass = (typeof TOAST_CLASSES)[number];

/** How long a toast of each class shows, ms; null = sticky (a card stays while pending). */
export const TOAST_CLASS_MS: Readonly<Record<ToastClass, number | null>> = {
  card: null,
  alert: 6000,
  info: 6000,
  callout: 4000,
};

/**
 * A row's toast class: a pending row is always a card (it carries the action); any other row is
 * its kind's `alert`, else info (a card kind's info row is info).
 */
export function toastClassOf(
  declared: NotificationToastClass | undefined,
  state: NotificationState,
): NotificationToastClass {
  if (state === "pending") return "card";
  return declared === "alert" ? "alert" : "info";
}

/** Load check (FR-NOTE-52): a registered kind names a known class. */
export function checkToastClass(kind: string, cls: string | undefined): void {
  if (cls === undefined || (NOTIFICATION_TOAST_CLASSES as readonly string[]).includes(cls)) return;
  throw new Error(`Notification kind "${kind}": unknown toast class "${cls}"`);
}
