// log-share (SHARE §8, §9): the `share.toLog` intent and the `share.entry` log kind's payload.
// The client names what to share; the server builds the text (FR-SHARE-03), so a client can only
// post what the sender may read, never free text.
import { z } from "zod";

export const SHARE_TO_LOG = "share.toLog";
export const LOG_KIND_SHARE = "share.entry";

/** FR-SHARE-06: one share's text; longer is cut with an ellipsis (`cut`). */
export const SHARE_TEXT_MAX = 16_000;
/** FR-SHARE-08: shared text kept across the log's 100-entry window, newest first. */
export const SHARE_WINDOW_TEXT_MAX = 64_000;

export const SHARE_TITLE_MAX = 80;
export const SHARE_LINE_MAX = 120;

const Id = z.string().min(1).max(64);

/** FR-SHARE-02: the sheet lists with a share button. */
export const SHARE_SHEET_LISTS = ["attacks", "spells", "features", "items"] as const;
export const ShareSheetList = z.enum(SHARE_SHEET_LISTS);
export type ShareSheetList = z.infer<typeof ShareSheetList>;

export const ShareToLogIntent = z.discriminatedUnion("from", [
  z.strictObject({ from: z.literal("compendium"), entryId: Id }),
  z.strictObject({
    from: z.literal("sheet"),
    creatureId: Id,
    list: ShareSheetList,
    rowId: Id,
  }),
]);
export type ShareToLogIntent = z.infer<typeof ShareToLogIntent>;

export const ShareToLogResult = z.object({ entryId: z.string() });
export type ShareToLogResult = z.infer<typeof ShareToLogResult>;

export const SharePayload = z.strictObject({
  title: z.string().min(1).max(SHARE_TITLE_MAX),
  /** The muted summary after the title ("Level 3 evocation"); may be empty. */
  line: z.string().max(SHARE_LINE_MAX),
  /** Markdown-lite (FR-CMP-26). Empty when `folded`, or when the row has no words of its own. */
  text: z.string().max(SHARE_TEXT_MAX),
  /** FR-SHARE-06: the text passed `SHARE_TEXT_MAX`. */
  cut: z.literal(true).optional(),
  /** FR-SHARE-08: dropped to keep the window's shared text bounded. */
  folded: z.literal(true).optional(),
});
export type SharePayload = z.infer<typeof SharePayload>;
