// Server notification kind registry (FR-NOTE-03, protocol §23/§26). APPEND-ONLY (AGENTS §9.9):
// a kind owner adds one import and one line in the list; nothing else changes here.
import type { NotificationKindDef } from "./kind";
import { testKind } from "./test-kind";

export const notificationKinds: readonly NotificationKindDef[] = [
  testKind, // test (notifications, FR-NOTE-22), test mode only
];
