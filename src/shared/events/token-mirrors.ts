// Domain events of token mirrors (MIR §9). Logged, not undoable, like props. A mirror that follows
// its token joins the token's own event (the token-changed hook's rows).
import { z } from "zod";
import { defineEvent } from "./types";

const logged = { logged: true, undoable: false } as const;
const payload = z.object({ mirrorId: z.string() }).strict();

export const MirrorCreated = defineEvent({ type: "MirrorCreated", payload, ...logged });
export const MirrorMoved = defineEvent({ type: "MirrorMoved", payload, ...logged });
export const MirrorModeSet = defineEvent({ type: "MirrorModeSet", payload, ...logged });
export const MirrorDeleted = defineEvent({ type: "MirrorDeleted", payload, ...logged });
