// gems boundary schemas (GEM §8, §9): the `character-gems` record, the `gem.*` intents and the
// gem names. Everything here is tagged with the `gems` feature (ADR-0058): off = nothing reaches anyone.
import { CardDiePick, CardKnownDice, MAX_DICE_PICKS } from "@shared/combat-tracker/schemas";
import { ManualEntry } from "@shared/dice-roll-log/schemas";
import { z } from "zod";

export const CHARACTER_GEMS_TYPE = "character-gems";
export const GEM_ADJUST_INTENT = "gem.adjust";
export const GEM_SPEND_INTENT = "gem.spend";
export const LOG_KIND_GEM_AWARD = "gem.award";
export const LOG_KIND_GEM_SPEND = "gem.spend";

/** The five gems (#140), in display order; also the count columns. */
export const GEM_KINDS = ["inspiration", "fortune", "combat", "divine", "action"] as const;
export const GemKind = z.enum(GEM_KINDS);
export type GemKind = z.infer<typeof GemKind>;

/** Display name per gem (lines, rejects, Tooltip). */
export const GEM_NAME: Record<GemKind, string> = {
  inspiration: "Inspiration",
  fortune: "Fortune",
  combat: "Combat",
  divine: "Divine Knowledge",
  action: "Action",
};

/** FR-GEM-06: per-gem count bounds (the "max 5" is a label only, FR-GEM-08). */
export const GEM_COUNT_MAX = 99;
/** FR-GEM-07: one adjust moves a count by at most 5. */
export const GEM_DELTA_MAX = 5;

const Count = z.int().min(0).max(GEM_COUNT_MAX);

/** FR-GEM-06: `character-gems` (id = the character's entity id). Players get it whole (OQ-GEM-01 A). */
export const CharacterGemsRecord = z.strictObject({
  id: z.string(),
  campaignId: z.string(),
  characterId: z.string(),
  inspiration: Count,
  fortune: Count,
  combat: Count,
  divine: Count,
  action: Count,
});
export type CharacterGemsRecord = z.infer<typeof CharacterGemsRecord>;

const Id = z.string().min(1).max(64);

/** FR-GEM-07: `gem.adjust` (DM): `delta` −5…+5, never 0. */
export const GemAdjustInput = z.strictObject({
  characterId: Id,
  gem: GemKind,
  delta: z
    .int()
    .min(-GEM_DELTA_MAX)
    .max(GEM_DELTA_MAX)
    .refine((d) => d !== 0, { message: "Delta must not be 0" }),
});
export type GemAdjustInput = z.infer<typeof GemAdjustInput>;
export const GemAdjustResult = z.object({ held: Count });
export type GemAdjustResult = z.infer<typeof GemAdjustResult>;

/** FR-GEM-16 (OQ-GEM-12 A): what an Action gem buys, and its cost. */
export const ACTION_USES = ["bonus", "reaction", "action"] as const;
export const ActionUse = z.enum(ACTION_USES);
export type ActionUse = z.infer<typeof ActionUse>;
export const ACTION_COST: Record<ActionUse, number> = { bonus: 1, reaction: 1, action: 2 };

/**
 * FR-GEM-12: `gem.spend`, the plain spends (GM0): Fortune, Divine Knowledge, Action (`use`
 * required) and Inspiration "to recall" (OQ-GEM-06 A; no `entryId`). FR-GEM-18 (GM1): the
 * Inspiration reroll names the log line (`entryId`); physical mode sends the new d20(s) as
 * `manual` (FR-GEM-21, OQ-GEM-13 A; adv / dis: both dice). FR-GEM-25 (GM2): the Combat gem
 * names a pending damage card (`cardId`) and 1–3 of its weapon dice (`dice`); a part entered as a
 * physical total sends its per-die values first (`known`, FR-GEM-28).
 */
export const GemSpendInput = z
  .strictObject({
    characterId: Id,
    gem: GemKind,
    use: ActionUse.optional(),
    entryId: Id.optional(),
    manual: ManualEntry.optional(),
    cardId: Id.optional(),
    dice: z.array(CardDiePick).min(1).max(MAX_DICE_PICKS).optional(),
    known: z.array(CardKnownDice).min(1).max(MAX_DICE_PICKS).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.gem === "action" && v.use === undefined) {
      ctx.addIssue({ code: "custom", path: ["use"], message: "Pick bonus, reaction or action" });
    }
    if (v.gem !== "action" && v.use !== undefined) {
      ctx.addIssue({ code: "custom", path: ["use"], message: "Only Action gems take a use" });
    }
    if (v.entryId !== undefined && v.gem !== "inspiration") {
      ctx.addIssue({
        code: "custom",
        path: ["entryId"],
        message: "Only Inspiration rerolls a line",
      });
    }
    if (v.manual !== undefined && v.entryId === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["manual"],
        message: "Physical dice need a line to reroll",
      });
    }
    if (v.gem === "combat" && (v.cardId === undefined || v.dice === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["cardId"],
        message: "A Combat gem goes on a damage card",
      });
    }
    if (v.gem !== "combat" && (v.cardId ?? v.dice ?? v.known) !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["cardId"],
        message: "Only Combat gems max dice",
      });
    }
  });
export type GemSpendInput = z.infer<typeof GemSpendInput>;
/** FR-GEM-12: `entryId` = the spend line; `rerollEntryId` = a reroll's new roll line (GEM §9). */
export const GemSpendResult = z.object({
  held: Count,
  entryId: z.string(),
  rerollEntryId: z.string().optional(),
});
export type GemSpendResult = z.infer<typeof GemSpendResult>;

/** FR-GEM-12, -16: gems a spend costs. */
export const spendCost = (gem: GemKind, use?: ActionUse): number =>
  gem === "action" && use ? ACTION_COST[use] : 1;

/** FR-GEM-26: dice a Combat gem maxes at this level: 1 at 1–5, 2 at 6–11, 3 at 12+. */
export const combatDiceLimit = (level: number): number => (level >= 12 ? 3 : level >= 6 ? 2 : 1);

/** FR-GEM-26: the level a count of dice needs ("Level 6 needed for 2 dice"). */
export const combatDiceLevel = (count: number): number => (count >= 3 ? 12 : count === 2 ? 6 : 1);
