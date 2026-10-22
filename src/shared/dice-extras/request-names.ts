// Roll-request names and constants without zod (FR-DICEX-73–78, FR-NOTE-58): the clients'
// initial chunk (the prompt, the request sound) reads only these, so `requests.ts`' schemas stay
// out of it (DICEX §12 initial budget). `requests.ts` re-exports them.
import type { RollCategory } from "../events/dice-roll-log";

export const ROLL_REQUEST_TYPE = "roll-request";
/** FR-NOTE-58: the prompt's notification kind (toast class card, FR-NOTE-52). */
export const ROLL_REQUEST_KIND = "roll-request";

export const DICEX_REQUEST_INTENTS = {
  request: "dicex.request",
  answerRequest: "dicex.answerRequest",
  declineRequest: "dicex.declineRequest",
  closeRequest: "dicex.closeRequest",
  rollForMissing: "dicex.rollForMissing",
} as const;

export const REQUEST_ROLL_KINDS = ["skill", "save", "check", "custom"] as const;
export type RequestRollKind = (typeof REQUEST_ROLL_KINDS)[number];

/** FR-DICEX-76: the roll's log category per kind. */
export const REQUEST_CATEGORY: Readonly<Record<RequestRollKind, RollCategory>> = {
  skill: "skill-check",
  save: "saving-throw",
  check: "ability-check",
  custom: "other",
};
