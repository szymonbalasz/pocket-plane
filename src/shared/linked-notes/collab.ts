// Note co-writing on the wire (NOTES §9, ADR-0078; slice N2): the `notes.open` / `push` / `close`
// intents and results, the server signals `notes.updates` / `notes.here` / `notes.closed`, the
// client signal `notes.cursor`, and the push frame split. Changes travel as `ChangeSet.toJSON()`
// (src/shared stays zod-only; the server and the editor turn them into `ChangeSet`s).
import { z } from "zod";

export const NOTES_UPDATES_SIGNAL = "notes.updates";
export const NOTES_HERE_SIGNAL = "notes.here";
export const NOTES_CLOSED_SIGNAL = "notes.closed";
export const NOTES_CURSOR_SIGNAL = "notes.cursor";

/** FR-NOTES-13: notes one connection may have open at once. */
export const NOTES_OPEN_MAX = 8;
/** ADR-0078: a push frame carries a prefix of the unconfirmed updates of at most this size. */
export const NOTES_PUSH_FRAME_BYTES = 48 * 1024;
/** Updates per push (a frame of 48 KiB holds far fewer real ones). */
export const NOTES_PUSH_UPDATES_MAX = 200;
/** FR-NOTES-15: selections per cursor signal. */
export const NOTES_CURSOR_RANGES_MAX = 10;
/** ADR-0078: unfolded changes before the body is rewritten (`bodyVersion` catches up). */
export const NOTES_FOLD_EVERY = 100;
/** ADR-0078: `note_change` rows kept per note after a fold: the last 1,000, at most 1 MiB. */
export const NOTES_KEEP_ROWS = 1_000;
export const NOTES_KEEP_BYTES = 1024 * 1024;
/** ADR-0078: `updatedAt` / `updatedBy` move at most once a minute while typing. */
export const NOTES_TOUCH_MS = 60_000;

export const NOTE_NOT_OPEN = "Open the note first";
export const NOTE_EDITOR_MISMATCH = "Not this connection's editor";
export const NOTE_EDITOR_IN_USE = "That editor ID is in use";
export const NOTE_OPEN_LIMIT = `Up to ${NOTES_OPEN_MAX} notes open at once`;
export const NOTE_BAD_CHANGE = "Change doesn't fit the note";

const Id = z.string().min(1).max(64);
/** The editor's collab client ID (`@codemirror/collab` `clientID`); "server" is reserved (N6). */
export const NoteClientId = z
  .string()
  .min(1)
  .max(64)
  .refine((s) => s !== "server", { message: "Reserved client ID" });

/** `ChangeSet.toJSON()`: a retained length, or `[deleted, ...inserted lines]`. */
export const ChangeJson = z
  .array(z.union([z.int().min(0), z.tuple([z.int().min(0)]).rest(z.string())]))
  .max(10_000);
export type ChangeJson = z.infer<typeof ChangeJson>;

/** One collab update: whose editor made it and its changes. */
export const NoteUpdate = z.strictObject({ clientId: NoteClientId, changes: ChangeJson });
export type NoteUpdate = z.infer<typeof NoteUpdate>;

/** Who has a note open (FR-NOTES-16): one entry per open editor (a tab), DM `playerId` null. */
export const NoteHere = z.strictObject({
  role: z.enum(["dm", "player"]),
  playerId: z.string().nullable(),
  clientId: z.string(),
});
export type NoteHere = z.infer<typeof NoteHere>;

/** `notes.open` (FR-NOTES-13, -16, -18): `version` = what the client has, on a re-open. */
export const OpenNoteIntent = z.strictObject({
  noteId: Id,
  clientId: NoteClientId,
  version: z.int().min(0).optional(),
});
/**
 * `updates` (the client's `version` is still covered: the changes since it, maybe none) or `doc`
 * (the whole text at `version`); either way who is here.
 */
export type OpenNoteResult =
  | { mode: "updates"; version: number; updates: NoteUpdate[]; here: NoteHere[] }
  | { mode: "doc"; version: number; doc: string; here: NoteHere[] };

/** `notes.push` (FR-NOTES-14, -21): updates based on `version`, all from the bound editor. */
export const PushNoteIntent = z.strictObject({
  noteId: Id,
  version: z.int().min(0),
  updates: z.array(NoteUpdate).min(1).max(NOTES_PUSH_UPDATES_MAX),
});
/** Stale: the updates since `version` to rebase on; `reload`: those are gone, re-open. */
export type PushNoteResult =
  | { accepted: true }
  | { accepted: false; updates: NoteUpdate[] }
  | { accepted: false; reload: true };

/** `notes.close` (FR-NOTES-16). */
export const CloseNoteIntent = z.strictObject({ noteId: Id });

/** Server signal `notes.updates`: accepted updates starting at version `from`. */
export const NoteUpdatesSignal = z.strictObject({
  noteId: z.string(),
  from: z.int().min(0),
  updates: z.array(NoteUpdate),
});
export type NoteUpdatesSignal = z.infer<typeof NoteUpdatesSignal>;

/** Server signal `notes.here`: the note's open editors now. */
export const NoteHereSignal = z.strictObject({ noteId: z.string(), here: z.array(NoteHere) });
export type NoteHereSignal = z.infer<typeof NoteHereSignal>;

/** Server signal `notes.closed` (FR-NOTES-20): the note was binned while open. */
export const NoteClosedSignal = z.strictObject({
  noteId: z.string(),
  reason: z.enum(["deleted"]),
});
export type NoteClosedSignal = z.infer<typeof NoteClosedSignal>;

const Range = z.strictObject({ anchor: z.int().min(0), head: z.int().min(0) });

/**
 * Client signal `notes.cursor` (FR-NOTES-15): carets and selections at `version`, or `left`.
 * Never stored; receivers map them forward and drop them after 10 s.
 */
export const NoteCursorSignal = z.strictObject({
  noteId: Id,
  clientId: NoteClientId,
  version: z.int().min(0),
  ranges: z.array(Range).max(NOTES_CURSOR_RANGES_MAX),
  left: z.literal(true).optional(),
});
export type NoteCursorSignal = z.infer<typeof NoteCursorSignal>;

const utf8 = new TextEncoder();
const bytes = (v: unknown) => utf8.encode(JSON.stringify(v)).length;

/**
 * ADR-0078 push frame split: the longest prefix of `updates` whose push frame (envelope
 * included) stays within `max` bytes, at least one update (a single bigger one goes alone).
 */
export function pushPrefix(
  noteId: string,
  version: number,
  updates: readonly NoteUpdate[],
  max = NOTES_PUSH_FRAME_BYTES,
): NoteUpdate[] {
  const envelope = bytes({
    type: "intent",
    intentId: "0".repeat(36),
    name: "notes.push",
    payload: { noteId, version, updates: [] },
  });
  const out: NoteUpdate[] = [];
  let size = envelope;
  for (const u of updates.slice(0, NOTES_PUSH_UPDATES_MAX)) {
    const n = bytes(u) + (out.length > 0 ? 1 : 0);
    if (out.length > 0 && size + n > max) break;
    out.push(u);
    size += n;
  }
  return out;
}
