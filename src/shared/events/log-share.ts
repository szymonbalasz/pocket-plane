// Domain events of log-share (SHARE §9). Logged, not undoable: the DM's Hide (FR-DICE-99) takes a
// share back out of the players' logs.
import { z } from "zod";
import { defineEvent } from "./types";

/** `share.toLog`: changes = the new `game-log-entry`, plus any older share it folded. */
export const LogEntryShared = defineEvent({
  type: "LogEntryShared",
  payload: z.strictObject({
    entryId: z.string(),
    from: z.enum(["compendium", "sheet"]),
    title: z.string(),
  }),
  logged: true,
  undoable: false,
});
