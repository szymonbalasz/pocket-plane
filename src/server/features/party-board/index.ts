// party-board (PARTY): record types `handout`, `handout-body`, `party-item` (lazy, ADR-0045), the
// handout intents and the party inventory intents (add / edit / remove / move). `loot.split` is
// party-loot's; the notification kind and windows are registered in their registries. *(S5)*
// `handout-present` (in the snapshot) and `party.presentHandout` / `party.closePresent`.
import type { Feature } from "../../services";
import { addItem, createHandout, deleteHandout, shareHandout, updateHandout } from "./commands";
import { editItem, moveItem, removeItem } from "./item-commands";
import { closePresent, presentHandout } from "./present-commands";
import { handoutBodyType, handoutPresentType, handoutType, partyItemType } from "./records";

export const partyBoard: Feature = {
  name: "party-board",
  register(r) {
    r.command(createHandout, { intent: true });
    r.command(updateHandout, { intent: true });
    r.command(shareHandout, { intent: true });
    r.command(deleteHandout, { intent: true });
    r.command(addItem, { intent: true });
    r.command(editItem, { intent: true });
    r.command(removeItem, { intent: true });
    r.command(moveItem, { intent: true });
    r.command(presentHandout, { intent: true });
    r.command(closePresent, { intent: true });
    r.recordType(handoutType);
    r.recordType(handoutBodyType);
    r.recordType(partyItemType);
    r.recordType(handoutPresentType);
  },
};
