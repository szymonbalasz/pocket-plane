// Sync probe domain events, test mode only (CON-05).
import { z } from "zod";
import { defineEvent } from "./types";

export const ProbeSet = defineEvent({
  type: "ProbeSet",
  payload: z.object({
    probeId: z.string(),
    text: z.string(),
    hidden: z.boolean(),
    ownerPlayerId: z.string().nullable(),
  }),
  logged: true,
  undoable: false,
});

export const ProbeEdited = defineEvent({
  type: "ProbeEdited",
  payload: z.object({ probeId: z.string(), text: z.string() }),
  logged: true,
  undoable: false,
});
