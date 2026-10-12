// character-sheet boundary schemas (CHAR §9): intents `char.roll`, `char.adjustHp` and results.
// Strict: no expression, bonus or HP field (FR-CHAR-05, FR-CHAR-10, CHAR §11).
import { ManualEntry, RollMode } from "@shared/dice-roll-log/schemas";
import { z } from "zod";

export const CHAR_ROLL = "char.roll";
export const CHAR_ADJUST_HP = "char.adjustHp";

export const CHAR_ROLL_KINDS = ["initiative", "attack"] as const;
export const CharRollKind = z.enum(CHAR_ROLL_KINDS);
export type CharRollKind = z.infer<typeof CharRollKind>;

/** FR-CHAR-07: one manual entry per roll — initiative 1, attack 2 (to-hit, damage). */
export const MANUAL_COUNT: Record<CharRollKind, number> = { initiative: 1, attack: 2 };

const Id = z.string().min(1).max(64);

/** Intent `char.roll` (FR-CHAR-05–07, FR-CHAR-17). */
export const CharRollIntent = z
  .strictObject({
    characterId: Id,
    kind: CharRollKind,
    mode: RollMode.default("normal"),
    manual: z.array(ManualEntry).min(1).max(2).optional(),
    public: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    const n = MANUAL_COUNT[v.kind];
    if (v.manual && v.manual.length !== n) {
      ctx.addIssue({
        code: "custom",
        path: ["manual"],
        message: `Enter ${n} physical ${n === 1 ? "roll" : "rolls"} for ${v.kind}`,
      });
    }
  });
export type CharRollIntent = z.input<typeof CharRollIntent>;

export const CharRollResult = z.object({ rollIds: z.array(z.string()), entryId: z.string() });
export type CharRollResult = z.infer<typeof CharRollResult>;

export const HP_DELTA_MAX = 999;

/** Intent `char.adjustHp` (FR-CHAR-10): integer −999…999, ≠ 0. */
export const CharAdjustHpIntent = z.strictObject({
  characterId: Id,
  delta: z
    .int()
    .min(-HP_DELTA_MAX)
    .max(HP_DELTA_MAX)
    .refine((d) => d !== 0, "Amount must not be 0"),
});
export type CharAdjustHpIntent = z.infer<typeof CharAdjustHpIntent>;

export const CharAdjustHpResult = z.object({ hpBefore: z.int(), hpAfter: z.int() });
export type CharAdjustHpResult = z.infer<typeof CharAdjustHpResult>;
