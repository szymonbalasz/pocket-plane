// The roll-request prompt's logic (FR-DICEX-78, -83; FR-NOTE-59): the expression the server will
// build (`characterRolls`), the preview subject, the answer intent and the outcome text. No zod:
// it ships in both clients' initial chunk with the prompt (DICEX §12).
import { characterRolls, type RollSheet } from "@shared/character-sheet/logic";
import type {
  AnswerRequestInput,
  RequestRoll,
  RollRequestPromptPayload,
  RollRequestPromptResolution,
} from "@shared/dice-extras/requests";
import type { RollSubject } from "@shared/effect-modifiers/schemas";
import { type CharacterStatBlock, SKILL_ABILITY } from "@shared/entities/schemas";
import type { NotificationRecord } from "@shared/notifications/schemas";
import type { RollRequest } from "../dice-roll-log/roll-control";

/** FR-DICEX-83: the expression the server will roll (sheet specs; custom as sent). */
export function promptExpression(
  roll: RequestRoll,
  stats: CharacterStatBlock | null,
  sheet: RollSheet,
): string {
  if (roll.kind === "custom") return roll.expression;
  if (!stats) return "1d20";
  const ref = roll.kind === "skill" ? { skill: roll.key } : { ability: roll.key };
  const r = characterRolls(stats, sheet, roll.kind, ref);
  return r.ok ? (r.specs[0]?.expression ?? "1d20") : "1d20";
}

/** FR-MOD-27: the preview subject of an asked roll (none for custom, FR-DICEX-78). */
export function promptSubject(roll: RequestRoll, characterId: string): RollSubject | null {
  const creature = { characterId };
  if (roll.kind === "save") return { creature, roll: "save", ability: roll.key };
  if (roll.kind === "check") return { creature, roll: "check", ability: roll.key };
  if (roll.kind === "skill") return { creature, roll: "check", ability: SKILL_ABILITY[roll.key] };
  return null;
}

/** FR-DICEX-78: the answer intent of a roll control's request (one roll, one manual entry). */
export function answerIntent(
  p: Pick<RollRequestPromptPayload, "requestId" | "characterId">,
  r: RollRequest,
): AnswerRequestInput {
  return {
    requestId: p.requestId,
    characterId: p.characterId,
    mode: r.mode,
    ...(r.manual?.[0] ? { manual: r.manual[0] } : {}),
    ...(r.manualParts?.[0] ? { manualParts: r.manualParts[0] } : {}),
  };
}

/** The prompt's payload (server-built, FR-NOTE-58); null when it isn't one. */
export function promptPayload(
  n: Pick<NotificationRecord, "payload">,
): RollRequestPromptPayload | null {
  const p = n.payload as Partial<RollRequestPromptPayload> | null;
  return p && typeof p.requestId === "string" && typeof p.characterId === "string" && p.roll
    ? (p as RollRequestPromptPayload)
    : null;
}

/** FR-NOTE-59: "Rolled 17" / "Declined" / "Closed"; null while pending. */
export function promptOutcome(n: Pick<NotificationRecord, "state" | "resolution">): string | null {
  if (n.state === "pending") return null;
  if (n.state !== "resolved") return "Closed";
  const r = n.resolution as Partial<RollRequestPromptResolution> | null;
  if (r?.outcome === "rolled") return typeof r.total === "number" ? `Rolled ${r.total}` : "Rolled";
  return r?.outcome === "declined" ? "Declined" : "Closed";
}
