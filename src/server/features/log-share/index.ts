// log-share (SHARE): the intent `share.toLog`. No record type of its own: a share is a
// `game-log-entry` of kind `share.entry` (FR-DICE-18).
import { LogEntryShared } from "@shared/events/log-share";
import type { Feature } from "../../services";
import { shareToLog } from "./share";

export const logShare: Feature = {
  name: "log-share",
  register(r) {
    r.event(LogEntryShared);
    r.command(shareToLog, { intent: true });
  },
};
