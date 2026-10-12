// dice-roll-log boundary schemas (DICE §8, §9; data model §15). zod is the source of truth.
import { ROLL_CATEGORIES, ROLL_MODES, RollCategory, RollMode } from "@shared/events/dice-roll-log";
import { z } from "zod";
import { parseExpression } from "./grammar";

export { ROLL_CATEGORIES, ROLL_MODES, RollCategory, RollMode };

export const GAME_LOG_ENTRY_TYPE = "game-log-entry";
export const GAME_LOG_SETTINGS_TYPE = "game-log-settings";
/** FR-DICE-17: snapshot window. */
export const GAME_LOG_WINDOW = 100;
export const LABEL_MAX = 60;

const Id = z.string().min(1).max(64);

export const CATEGORY_LABEL: Record<RollCategory, string> = {
  attack: "Attack",
  damage: "Damage",
  "saving-throw": "Saving throw",
  "ability-check": "Ability check",
  "skill-check": "Skill check",
  contested: "Contested",
  initiative: "Initiative",
  healing: "Healing",
  other: "Other",
};

/** Settings column per category (data model §15: categories kebab-case, columns camelCase). */
export const SETTINGS_COLUMN = {
  attack: "attack",
  damage: "damage",
  "saving-throw": "savingThrow",
  "ability-check": "abilityCheck",
  "skill-check": "skillCheck",
  contested: "contested",
  initiative: "initiative",
  healing: "healing",
  other: "other",
} as const satisfies Record<RollCategory, string>;
export type SettingsColumn = (typeof SETTINGS_COLUMN)[RollCategory];

/** FR-DICE-01 as a zod check: the issue message names the broken limit. */
export const DiceExpression = z.string().superRefine((s, ctx) => {
  const r = parseExpression(s);
  if (!r.ok) ctx.addIssue({ code: "custom", message: r.message });
});

/** FR-DICE-11: trimmed, ≤ 60 chars, no control chars; empty → absent. */
export const RollLabel = z
  .string()
  .max(500)
  .transform((s) => s.trim())
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control chars is the point
  .refine((s) => !/[\u0000-\u001f\u007f-\u009f]/.test(s), "Label: no control characters")
  .refine((s) => s.length <= LABEL_MAX, `Label: at most ${LABEL_MAX} characters`);

/**
 * FR-DICE-06: physical dice. `diceTotal` = sum of kept dice; optional `dice` = every die value
 * in notation order (count and faces must match; kept is computed server-side).
 */
export const ManualEntry = z.strictObject({
  diceTotal: z.int().min(-50_000).max(50_000),
  dice: z.array(z.int().min(1).max(1000)).min(1).max(51).optional(),
});
export type ManualEntry = z.infer<typeof ManualEntry>;

/** FR-DICE-10: who the roll is for. Omitted = the roller (player name / "DM"). */
export const RollActorRef = z.union([
  z.strictObject({ entityId: Id }),
  z.strictObject({ tokenId: Id }),
]);
export type RollActorRef = z.infer<typeof RollActorRef>;

/** Intent `dice.roll` (FR-DICE-09). */
export const DiceRollIntent = z.strictObject({
  expression: DiceExpression,
  mode: RollMode.default("normal"),
  category: RollCategory.default("other"),
  label: RollLabel.optional(),
  actor: RollActorRef.optional(),
  manual: ManualEntry.optional(),
  public: z.boolean().optional(),
});
export type DiceRollIntent = z.input<typeof DiceRollIntent>;

export const DiceRollResult = z.object({ rollId: z.string(), entryId: z.string() });
export type DiceRollResult = z.infer<typeof DiceRollResult>;

/** Intent `dice.setCategoryPublic` (FR-DICE-12). */
export const SetCategoryPublicIntent = z.strictObject({
  category: RollCategory,
  public: z.boolean(),
});
export type SetCategoryPublicIntent = z.infer<typeof SetCategoryPublicIntent>;

/** One stored die (#140): every die incl. dropped; `value` null only for manual totals. */
export const DieResult = z.strictObject({
  faces: z.int().min(2).max(1000),
  value: z.int().nullable(),
  kept: z.boolean(),
});
export type DieResult = z.infer<typeof DieResult>;

/** `roll` kind payload item (data model §15). */
export const RollPayloadItem = z.strictObject({
  rollId: Id,
  expression: z.string().max(80),
  mode: RollMode,
  manual: z.boolean(),
  dice: z.array(DieResult).max(51),
  constant: z.int(),
  total: z.int(),
  natural: z.int().nullable(),
  label: z.string().max(LABEL_MAX).nullable(),
});
export type RollPayloadItem = z.infer<typeof RollPayloadItem>;

export const RollEntryPayload = z.array(RollPayloadItem).min(1).max(20);
export type RollEntryPayload = z.infer<typeof RollEntryPayload>;

/** `game-log-entry` as the DM receives it (full row). */
export const GameLogEntryRecord = z.strictObject({
  id: Id,
  campaignId: Id,
  n: z.int().min(1),
  at: z.string(),
  kind: z.string(),
  category: RollCategory,
  public: z.boolean(),
  undone: z.boolean(),
  rollerRole: z.enum(["dm", "player"]),
  rollerPlayerId: z.string().nullable(),
  actorName: z.string(),
  payload: z.unknown(),
  dmPayload: z.unknown().nullable(),
  rollIds: z.array(z.string()),
  encounterId: z.string().nullable(),
  supersededBy: z.string().nullable(),
});
export type GameLogEntryRecord = z.infer<typeof GameLogEntryRecord>;

/** FR-DICE-15: what a player receives (no `dmPayload` key). */
export const RedactedGameLogEntry = GameLogEntryRecord.omit({ dmPayload: true });
export type RedactedGameLogEntry = z.infer<typeof RedactedGameLogEntry>;

/** An entry as either client holds it. */
export type GameLogEntryView = RedactedGameLogEntry & { dmPayload?: unknown };

/** `game-log-settings` (DM only). */
export const GameLogSettingsRecord = z.strictObject({
  id: Id,
  campaignId: Id,
  attack: z.boolean(),
  damage: z.boolean(),
  savingThrow: z.boolean(),
  abilityCheck: z.boolean(),
  skillCheck: z.boolean(),
  contested: z.boolean(),
  initiative: z.boolean(),
  healing: z.boolean(),
  other: z.boolean(),
});
export type GameLogSettingsRecord = z.infer<typeof GameLogSettingsRecord>;

/** FR-DICE-12: no row = all hidden. */
export function defaultSettings(campaignId: string): GameLogSettingsRecord {
  return {
    id: campaignId,
    campaignId,
    attack: false,
    damage: false,
    savingThrow: false,
    abilityCheck: false,
    skillCheck: false,
    contested: false,
    initiative: false,
    healing: false,
    other: false,
  };
}

export const categoryPublic = (s: GameLogSettingsRecord, c: RollCategory): boolean =>
  s[SETTINGS_COLUMN[c]];
