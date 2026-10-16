// party-board (PARTY): record types `handout`, `handout-body`, `party-item` (lazy, ADR-0045) and
// the core intents (handouts, `party.addItem`). Notification kind, windows and the other item /
// split intents come with slices 2–4 (PARTY §14.1).
import type { Feature } from "../../services";
import { addItem, createHandout, deleteHandout, shareHandout, updateHandout } from "./commands";
import { handoutBodyType, handoutType, partyItemType } from "./records";

export const partyBoard: Feature = {
  name: "party-board",
  register(r) {
    r.command(createHandout, { intent: true });
    r.command(updateHandout, { intent: true });
    r.command(shareHandout, { intent: true });
    r.command(deleteHandout, { intent: true });
    r.command(addItem, { intent: true });
    r.recordType(handoutType);
    r.recordType(handoutBodyType);
    r.recordType(partyItemType);
  },
};
