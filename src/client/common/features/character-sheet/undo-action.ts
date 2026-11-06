// FR-CRES-12 (class-resources): Undo on a `char.resourceUse` game-log line, for its sender (the
// owner who used it) or the DM; not once undone. The server checks again (and refuses after a
// long rest or once a created slot was spent).
import { LOG_KIND_RESOURCE_USE } from "@shared/character-sheet/resource-use-kind";
import { CHARX_INTENTS } from "@shared/character-sheet/sheet";
import type { GameLogEntryView } from "@shared/dice-roll-log/schemas";
import { Undo2Icon } from "lucide-react";
import type { EntryAction } from "../dice-roll-log/entry-actions";

export const resourceUndoAction: EntryAction = {
  id: "cres.undo",
  order: 40,
  available: (_store, entry: GameLogEntryView, you) =>
    entry.kind === LOG_KIND_RESOURCE_USE &&
    !entry.undone &&
    (you.role === "dm" || (entry.rollerRole === "player" && entry.rollerPlayerId === you.playerId)),
  Icon: Undo2Icon,
  label: "Undo",
  confirm: "Undo?",
  run: (entry, ctx) => ctx.send(CHARX_INTENTS.undoResourceUse, { entryId: entry.id }),
};
