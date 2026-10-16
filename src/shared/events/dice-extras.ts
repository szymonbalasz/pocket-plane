// Domain events of dice-extras (DICEX §9). Throws need no event (derived from `roll` entries).
import { z } from "zod";
import { defineEvent } from "./types";

/** `dicex.setLook` (FR-DICEX-26): changes = one `dice-look` upsert; every player sees it. */
export const DiceLookSet = defineEvent({
  type: "DiceLookSet",
  payload: z.strictObject({ lookId: z.string().min(1).max(64) }),
  logged: true,
  undoable: false,
});
