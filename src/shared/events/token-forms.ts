// Domain events of token forms (FORM §9, ADR-0081). Logged, not undoable. Tokens and combatants
// that follow a form change ride the same event's changes.
import { z } from "zod";
import { defineEvent } from "./types";

const logged = { logged: true, undoable: false } as const;

export const TokenFormsSaved = defineEvent({
  type: "TokenFormsSaved",
  payload: z.object({ characterId: z.string() }).strict(),
  ...logged,
});
export const TokenFormChosen = defineEvent({
  type: "TokenFormChosen",
  payload: z.object({ characterId: z.string(), formId: z.string().nullable() }).strict(),
  ...logged,
});
