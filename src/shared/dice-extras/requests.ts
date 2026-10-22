// DM roll requests (DICEX sprint 8, FR-DICEX-73–92, ADR-0061): record `roll-request` (DM only),
// its prompt notification kind `roll-request` (FR-NOTE-58), intents and caps. The DC, pass / fail
// and every target's state live only in the DM-only record; a prompt carries the DC only when the
// DM shows it.
import { z } from "zod";
import { EXPRESSION_MAX_CHARS } from "../dice-roll-log/grammar";
import {
  checkManualParts,
  DiceExpression,
  LABEL_MAX,
  ManualEntry,
  ManualParts,
  RollLabel,
} from "../dice-roll-log/schemas";
import { Ability, ENTITY_NAME_MAX, SKILL_NAMES, SkillName } from "../entities/schemas";
import { RollMode } from "../events/dice-roll-log";
import {
  DICEX_REQUEST_INTENTS,
  REQUEST_CATEGORY,
  REQUEST_ROLL_KINDS,
  type RequestRollKind,
  ROLL_REQUEST_KIND,
  ROLL_REQUEST_TYPE,
} from "./request-names";

export {
  DICEX_REQUEST_INTENTS,
  REQUEST_CATEGORY,
  REQUEST_ROLL_KINDS,
  type RequestRollKind,
  ROLL_REQUEST_KIND,
  ROLL_REQUEST_TYPE,
};

/** FR-DICEX-73, -74: targets per request. */
export const REQUEST_TARGETS_MAX = 12;
/** FR-DICEX-74: open requests per campaign. */
export const OPEN_REQUESTS_MAX = 5;
/** FR-DICEX-73 (review A #1): closed requests in the snapshot window (open rows are pinned). */
export const CLOSED_REQUESTS_WINDOW = 10;
/** FR-DICEX-77: DC range. */
export const DC_MIN = 1;
export const DC_MAX = 40;

const Id = z.string().min(1).max(64);

/**
 * FR-DICEX-73, -76: what is asked. Skill → a skill key; save / check → an ability; custom → an
 * FR-DICE-01 expression rolled as the PC with no sheet bonuses or roll hooks (FR-DICEX-78).
 */
export const RequestRoll = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("skill"), key: SkillName, expression: z.null() }),
  z.strictObject({ kind: z.literal("save"), key: Ability, expression: z.null() }),
  z.strictObject({ kind: z.literal("check"), key: Ability, expression: z.null() }),
  z.strictObject({
    kind: z.literal("custom"),
    key: z.null(),
    expression: z.string().min(1).max(EXPRESSION_MAX_CHARS).pipe(DiceExpression),
  }),
]);
export type RequestRoll = z.infer<typeof RequestRoll>;

/** FR-DICEX-76: the default label ("Perception", "DEX save", "STR check", the expression). */
export function defaultRequestLabel(roll: RequestRoll): string {
  switch (roll.kind) {
    case "skill":
      return SKILL_NAMES[roll.key];
    case "save":
      return `${roll.key.toUpperCase()} save`;
    case "check":
      return `${roll.key.toUpperCase()} check`;
    case "custom":
      return roll.expression;
  }
}

export const REQUEST_RESULTS = ["public", "hidden"] as const;
export const RequestResults = z.enum(REQUEST_RESULTS);
export type RequestResults = z.infer<typeof RequestResults>;

export const REQUEST_STATES = ["open", "closed"] as const;
export const RequestState = z.enum(REQUEST_STATES);
export type RequestState = z.infer<typeof RequestState>;

/** FR-DICEX-73, -79–81: open → rolled (answered) / declined / missed (closed or owner change). */
export const TARGET_STATES = ["open", "rolled", "declined", "missed"] as const;
export const TargetState = z.enum(TARGET_STATES);
export type TargetState = z.infer<typeof TargetState>;

/**
 * One target (FR-DICEX-73): the PC, its player at send (the prompt's audience), the name copied at
 * send, the prompt, then the answer: entry, total, natural d20 and `success` (total ≥ dc; DM only,
 * FR-DICEX-85). `at` = when the target left `open`.
 */
export const RequestTarget = z.strictObject({
  characterId: Id,
  playerId: Id,
  name: z.string().min(1).max(ENTITY_NAME_MAX),
  notificationId: Id,
  state: TargetState,
  entryId: Id.nullable(),
  total: z.int().nullable(),
  natural: z.int().nullable(),
  success: z.boolean().nullable(),
  at: z.string().nullable(),
});
export type RequestTarget = z.infer<typeof RequestTarget>;

/** Wire record = the full row (FR-DICEX-73): `audience: dm`, never sent to a player. */
export const RollRequestRecord = z.strictObject({
  id: Id,
  campaignId: Id,
  seq: z.int().min(1),
  roll: RequestRoll,
  label: z.string().min(1).max(LABEL_MAX),
  dc: z.int().min(DC_MIN).max(DC_MAX).nullable(),
  dcShown: z.boolean(),
  mode: RollMode,
  results: RequestResults,
  state: RequestState,
  targets: z.array(RequestTarget).min(1).max(REQUEST_TARGETS_MAX),
  createdAt: z.string(),
  closedAt: z.string().nullable(),
});
export type RollRequestRecord = z.infer<typeof RollRequestRecord>;

/** FR-DICEX-73: the snapshot window pins open requests. */
export const requestPinned = (r: Pick<RollRequestRecord, "state">): boolean => r.state === "open";

/** FR-DICEX-85: pass / fail, DM card only; null without a DC. */
export const requestSuccess = (dc: number | null, total: number): boolean | null =>
  dc === null ? null : total >= dc;

// ---- WS intents (TT2) ----

/** `dicex.request` (FR-DICEX-74, DM): 1–12 distinct PCs; `label` empty → the default. */
export const RequestInput = z.strictObject({
  roll: RequestRoll,
  characterIds: z
    .array(Id)
    .min(1)
    .max(REQUEST_TARGETS_MAX)
    .refine((ids) => new Set(ids).size === ids.length, "Characters must be unique"),
  dc: z.int().min(DC_MIN).max(DC_MAX).nullable().optional(),
  dcShown: z.boolean(),
  mode: RollMode,
  results: RequestResults,
  label: RollLabel.optional(),
});
export type RequestInput = z.infer<typeof RequestInput>;

/** `dicex.answerRequest` (FR-DICEX-78): the target's player or the DM; mode may change. */
export const AnswerRequestInput = z
  .strictObject({
    requestId: Id,
    characterId: Id,
    mode: RollMode,
    manual: ManualEntry.optional(),
    manualParts: ManualParts.optional(),
  })
  .superRefine(checkManualParts);
export type AnswerRequestInput = z.infer<typeof AnswerRequestInput>;

/** `dicex.declineRequest` (FR-DICEX-79). */
export const DeclineRequestInput = z.strictObject({ requestId: Id, characterId: Id });
export type DeclineRequestInput = z.infer<typeof DeclineRequestInput>;

/** `dicex.closeRequest` / `dicex.rollForMissing` (FR-DICEX-80, -81; DM). */
export const RequestIdInput = z.strictObject({ requestId: Id });
export type RequestIdInput = z.infer<typeof RequestIdInput>;

export const RequestResult = z.strictObject({ requestId: Id });
export const AnswerResult = z.strictObject({ rollId: Id, entryId: Id });
export const RollForMissingResult = z.strictObject({ entryIds: z.array(Id) });

// ---- Prompt notification (FR-NOTE-58) ----

/**
 * The prompt's payload (FR-NOTE-58, ≤ 1 KB): `dc` null unless the DM shows it (FR-DICEX-77);
 * never `success` or the results setting (FR-NOTE-64).
 */
export const RollRequestPromptPayload = z.strictObject({
  requestId: Id,
  characterId: Id,
  characterName: z.string().min(1).max(ENTITY_NAME_MAX),
  roll: RequestRoll,
  label: z.string().min(1).max(LABEL_MAX),
  dc: z.int().min(DC_MIN).max(DC_MAX).nullable(),
  mode: RollMode,
});
export type RollRequestPromptPayload = z.infer<typeof RollRequestPromptPayload>;

export const PROMPT_OUTCOMES = ["rolled", "declined", "missed"] as const;

/** FR-NOTE-58: resolution; `total` only on `rolled` (the row reaches DM + the roller, FR-NOTE-64). */
export const RollRequestPromptResolution = z.strictObject({
  outcome: z.enum(PROMPT_OUTCOMES),
  total: z.int().optional(),
});
export type RollRequestPromptResolution = z.infer<typeof RollRequestPromptResolution>;

/** FR-NOTE-58: "DM: ‹label›" (+ " · DC n" iff shown). */
export const promptText = (label: string, dc: number | null): string =>
  dc === null ? `DM: ${label}` : `DM: ${label} · DC ${dc}`;
