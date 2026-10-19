// notifications record shape, intents and pure rules (NOTE §6, §8, §9; protocol §20–§21).
// Shared by the server (record type, commands) and both clients (views, toasts).
import { z } from "zod";

export const NOTIFICATION_KIND_RE = /^[a-z][a-z0-9-]{0,31}$/;
export const AUDIENCES = ["dm", "player", "all"] as const;
export const NOTIFICATION_STATES = ["info", "pending", "resolved", "dismissed"] as const;
export const ACTION_ROLES = ["dm", "player"] as const;

export type Audience = (typeof AUDIENCES)[number];
export type NotificationState = (typeof NOTIFICATION_STATES)[number];
export type ActionRole = (typeof ACTION_ROLES)[number];

/** FR-NOTE-03 / §8 limits. */
export const TEXT_MAX = 280;
export const LABEL_MAX = 24;
export const PAYLOAD_MAX_BYTES = 1024;
export const RESOLUTION_MAX_BYTES = 256;
/** FR-NOTE-12 / ADR-0029: newest closed rows in a snapshot (pending rows are pinned on top). */
export const NOTIFICATION_WINDOW = 100;

/** Wire record = the full row (FR-NOTE-01, FR-NOTE-06: no redacted form). */
export const NotificationRecord = z.object({
  id: z.string(),
  campaignId: z.string(),
  seq: z.number().int(),
  kind: z.string(),
  audience: z.enum(AUDIENCES),
  audiencePlayerId: z.string().nullable(),
  text: z.string(),
  payload: z.unknown(),
  actionLabel: z.string().nullable(),
  actionRole: z.enum(ACTION_ROLES).nullable(),
  actionPlayerId: z.string().nullable(),
  state: z.enum(NOTIFICATION_STATES),
  resolution: z.unknown().nullable(),
  closedAt: z.string().nullable(),
  closedByRole: z.enum(ACTION_ROLES).nullable(),
  closedByPlayerId: z.string().nullable(),
  /** FR-NOTE-38 (sprint 5): who caused it, stamped by `notify`; null = system or an older row. */
  byRole: z.enum(ACTION_ROLES).nullable(),
  byPlayerId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type NotificationRecord = z.infer<typeof NotificationRecord>;

// biome-ignore lint/suspicious/noControlCharactersInRegex: FR-NOTE-21 strips control characters.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

/** FR-NOTE-21: control characters removed, then trimmed. */
export function cleanText(s: string): string {
  return s.replace(CONTROL_CHARS, "").trim();
}

/** FR-NOTE-21 text: cleaned, 1–280 chars. */
export const NotificationText = z
  .string()
  .max(4 * TEXT_MAX)
  .transform(cleanText)
  .pipe(z.string().min(1).max(TEXT_MAX));

/** FR-NOTE-05 action label: cleaned, 1–24 chars. */
export const ActionLabel = z
  .string()
  .max(4 * LABEL_MAX)
  .transform(cleanText)
  .pipe(z.string().min(1).max(LABEL_MAX));

/** UTF-8 bytes of the JSON serialisation (FR-NOTE-03 size limits). */
export function jsonBytes(v: unknown): number {
  return new TextEncoder().encode(JSON.stringify(v ?? null)).length;
}

const Id = z.string().min(1).max(64);

/** `note.dismiss` (DM, FR-NOTE-11). */
export const NoteDismissInput = z.object({ id: Id }).strict();
export type NoteDismissInput = z.infer<typeof NoteDismissInput>;

/** `note.resolve` (DM, player; genericResolve kinds, FR-NOTE-09). */
export const NoteResolveInput = z.object({ id: Id, resolution: z.unknown().optional() }).strict();
export type NoteResolveInput = z.infer<typeof NoteResolveInput>;

/**
 * `note.testSend` (test mode, FR-NOTE-22). The DM shape; a player may send only
 * `{text, actionLabel?}` (checked per role by the command, other fields → `invalid`).
 */
export const NoteTestSendInput = z
  .object({
    text: NotificationText,
    audience: z.enum(AUDIENCES).optional(),
    audiencePlayerId: Id.optional(),
    actionLabel: ActionLabel.optional(),
    actionRole: z.enum(ACTION_ROLES).optional(),
    actionPlayerId: Id.optional(),
  })
  .strict();
export type NoteTestSendInput = z.input<typeof NoteTestSendInput>;

export const PLAYER_TEST_SEND_FIELDS: readonly string[] = ["text", "actionLabel"];
/** Label of a player's test card when none is given (owner DM, like a damage card). */
export const DEFAULT_TEST_LABEL = "Resolve";

export const TEST_KIND = "test";

/** Viewer of a notification: the connection context's role and player. */
export interface NoteViewer {
  role: "dm" | "player";
  playerId: string | null;
}

/** FR-NOTE-06: DM sees all; a player sees `all` and rows addressed to them. */
export function notificationVisibleTo(
  r: Pick<NotificationRecord, "audience" | "audiencePlayerId">,
  v: NoteViewer,
): boolean {
  if (v.role === "dm") return true;
  if (r.audience === "all") return true;
  return r.audience === "player" && v.playerId !== null && r.audiencePlayerId === v.playerId;
}

/** FR-NOTE-13: the viewer is in the audience proper (DM: `dm` or `all`; player: visible). */
export function addressedTo(
  r: Pick<NotificationRecord, "audience" | "audiencePlayerId">,
  v: NoteViewer,
): boolean {
  if (v.role === "dm") return r.audience === "dm" || r.audience === "all";
  return notificationVisibleTo(r, v);
}

/** The action owner (FR-NOTE-05): who may act on a pending notification, besides the DM. */
export function isActionOwner(
  r: Pick<NotificationRecord, "actionRole" | "actionPlayerId">,
  v: NoteViewer,
): boolean {
  if (r.actionRole === null) return false;
  if (r.actionRole === "dm") return v.role === "dm";
  return v.role === "player" && v.playerId !== null && r.actionPlayerId === v.playerId;
}
