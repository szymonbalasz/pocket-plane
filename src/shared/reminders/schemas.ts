// Reminders (REM §6, §8, §9): record `reminder` (lazy `"all"`, ADR-0065), intents `rem.save` /
// `rem.delete`, caps and the pure visibility rule (FR-REM-13) shared by the registry, the leak
// tests and the clients. A reminder has no mechanics: rolls are plain `dice.roll` buttons.
import { z } from "zod";
import { EXPRESSION_MAX_CHARS, parseExpression, toNotation } from "../dice-roll-log/grammar";
import { RollCategory } from "../events/dice-roll-log";
import { cleanLine, cleanMultiline } from "./text";

export const REMINDER_TYPE = "reminder";

export const REM_INTENTS = { save: "rem.save", delete: "rem.delete" } as const;

/** FR-REM-02 bounds. */
export const REMINDER_TEXT_MAX = 500;
export const REMINDER_SOURCE_MAX = 60;
export const REMINDER_ROLLS_MAX = 4;
export const REMINDER_ROLL_LABEL_MAX = 40;
/** FR-REM-03 caps (the party is one target). */
export const REMINDERS_PER_CAMPAIGN = 200;
export const REMINDERS_PER_TARGET = 30;

/** FR-REM-03: the DM's message names the cap; a player's has no number (review ruling 7). */
export const reminderLimitMessage = (role: "dm" | "player", cap: number) =>
  role === "dm" ? `Reminder limit reached (${cap})` : "Reminder limit reached";
export const REMINDER_NOT_FOUND = "This reminder was removed";

const Id = z.string().min(1).max(64);

/** FR-REM-02: party or one character (`characterId` iff `kind = character`). */
export const ReminderTarget = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("party") }),
  z.strictObject({ kind: z.literal("character"), characterId: Id }),
]);
export type ReminderTarget = z.infer<typeof ReminderTarget>;

/** FR-DICE-01 notation, stored canonical ("1D4 + 1" → "1d4+1"); invalid → `invalid`. */
export const CanonicalNotation = z
  .string()
  .max(4 * EXPRESSION_MAX_CHARS)
  .transform((s, ctx) => {
    const r = parseExpression(s);
    if (!r.ok) {
      ctx.addIssue({ code: "custom", message: r.message });
      return z.NEVER;
    }
    return toNotation(r.value);
  });

/** FR-REM-02 / -04: a roll; `id` only when editing a kept roll (new ids come from `ctx.ids`). */
export const ReminderRollInput = z.strictObject({
  id: Id.optional(),
  label: cleanLine(1, REMINDER_ROLL_LABEL_MAX, "Label"),
  expression: CanonicalNotation,
  category: RollCategory.default("other"),
});
export type ReminderRollInput = z.output<typeof ReminderRollInput>;

/** `rem.save` (FR-REM-07): no `id` = create; with `id` = full replacement. */
export const SaveReminderIntent = z
  .strictObject({
    id: Id.optional(),
    target: ReminderTarget,
    text: cleanMultiline(1, REMINDER_TEXT_MAX, "Text"),
    source: cleanLine(0, REMINDER_SOURCE_MAX, "Source").default(""),
    rolls: z
      .array(ReminderRollInput)
      .max(REMINDER_ROLLS_MAX, `At most ${REMINDER_ROLLS_MAX} rolls`)
      .default([]),
    /** DM only (FR-REM-08, -12): absent on a DM save = false. */
    dmOnly: z.boolean().optional(),
    /** DM only (FR-REM-10): absent / null on a DM save = no link. */
    strongholdId: Id.nullable().optional(),
    facilityId: Id.nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.facilityId != null && v.strongholdId == null)
      ctx.addIssue({
        code: "custom",
        message: "A facility link needs its stronghold",
        path: ["facilityId"],
      });
    const ids = v.rolls.flatMap((r) => (r.id === undefined ? [] : [r.id]));
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", message: "Each roll once", path: ["rolls"] });
  });
export type SaveReminderIntent = z.input<typeof SaveReminderIntent>;
export type SaveReminderInput = z.output<typeof SaveReminderIntent>;

/** `rem.delete` (FR-REM-09). */
export const DeleteReminderIntent = z.strictObject({ id: Id });
export type DeleteReminderIntent = z.input<typeof DeleteReminderIntent>;

export const ReminderResult = z.strictObject({ reminderId: z.string() });
export type ReminderResult = z.infer<typeof ReminderResult>;

export const ReminderRoll = z.strictObject({
  id: z.string(),
  label: z.string(),
  expression: z.string(),
  category: RollCategory,
});
export type ReminderRoll = z.infer<typeof ReminderRoll>;

const playerFields = {
  id: z.string(),
  campaignId: z.string(),
  /** null = the party. */
  characterId: z.string().nullable(),
  text: z.string(),
  source: z.string(),
  rolls: z.array(ReminderRoll).max(REMINDER_ROLLS_MAX),
  strongholdId: z.string().nullable(),
  facilityId: z.string().nullable(),
  /** null = the DM (FR-REM-08 edit rights). */
  createdByPlayerId: z.string().nullable(),
  /** Strictly increasing per campaign (FR-REM-07): players' order, then `id`. */
  createdAt: z.string(),
};

/** Record `reminder`, DM view (REM §8): with `seq`, `updatedAt` and the DM keys. */
export const ReminderRecord = z.strictObject({
  ...playerFields,
  seq: z.int(),
  dmOnly: z.boolean(),
  /** Copy (FR-REM-05): the target character's owner at write; null for the party. */
  ownerPlayerId: z.string().nullable(),
  /** Copy (FR-REM-06): the linked stronghold or facility is DM-only. */
  linkHidden: z.boolean(),
  updatedAt: z.string(),
});
export type ReminderRecord = z.infer<typeof ReminderRecord>;

/** Record `reminder`, player view (FR-REM-13): no `seq`, `updatedAt`, DM keys. */
export const PlayerReminderRecord = z.strictObject(playerFields);
export type PlayerReminderRecord = z.infer<typeof PlayerReminderRecord>;

export const ReminderView = z.union([ReminderRecord, PlayerReminderRecord]);
export type ReminderView = z.infer<typeof ReminderView>;

/** Structural slice of the connection's viewer. */
export interface ReminderViewer {
  role: "dm" | "player";
  playerId: string | null;
}

/**
 * FR-REM-13: DM full. A player: hidden if `dmOnly`, `linkHidden`, or another player's character;
 * else redacted. Reads the record only (the copies carry the cross-record facts).
 */
export function reminderVisibility(
  r: Pick<ReminderRecord, "dmOnly" | "linkHidden" | "characterId" | "ownerPlayerId">,
  v: ReminderViewer,
): "full" | "redacted" | "hidden" {
  if (v.role === "dm") return "full";
  if (r.dmOnly || r.linkHidden) return "hidden";
  if (r.characterId !== null && (v.playerId === null || r.ownerPlayerId !== v.playerId))
    return "hidden";
  return "redacted";
}

/** FR-REM-13 redaction: drops `dmOnly`, `linkHidden`, `ownerPlayerId`, `seq`, `updatedAt`. */
export function redactReminder(r: ReminderRecord): PlayerReminderRecord {
  return {
    id: r.id,
    campaignId: r.campaignId,
    characterId: r.characterId,
    text: r.text,
    source: r.source,
    rolls: r.rolls,
    strongholdId: r.strongholdId,
    facilityId: r.facilityId,
    createdByPlayerId: r.createdByPlayerId,
    createdAt: r.createdAt,
  };
}

/** Players' order (FR-REM-13): `createdAt`, then id. */
export function byCreated<T extends { createdAt: string; id: string }>(a: T, b: T): number {
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
