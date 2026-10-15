// character-sheet boundary schemas (CHAR §9): intents `char.roll`, `char.adjustHp` and results.
// Strict: no expression, bonus or HP field (FR-CHAR-05, FR-CHAR-10, CHAR §11).
import { ManualEntry, RollMode } from "@shared/dice-roll-log/schemas";
import { Ability, SkillName } from "@shared/entities/schemas";
import { z } from "zod";

export const CHAR_ROLL = "char.roll";
export const CHAR_ADJUST_HP = "char.adjustHp";

/** Ability rolls (#149): `char.roll` (FR-CHAR-21) and `cbt.rollAbility` (FR-CBT-44). */
export const ABILITY_ROLL_KINDS = ["check", "save"] as const;
export const AbilityRollKind = z.enum(ABILITY_ROLL_KINDS);
export type AbilityRollKind = z.infer<typeof AbilityRollKind>;

/**
 * `char.roll` kinds and the roll-route contract (FR-CHAR-05, FR-CHAR-16, FR-CHAR-21); CHARX adds
 * `skill`, `damage`, `spellAttack`, `spellDamage` (FR-CHARX-20) and the to-hit-only `toHit`,
 * `spellToHit` (FR-CHARX-42, N7). `attack` / `spellAttack` stay to-hit + damage.
 */
export const SHEET_ROLL_KINDS = [
  "initiative",
  "attack",
  ...ABILITY_ROLL_KINDS,
  "skill",
  "damage",
  "spellAttack",
  "spellDamage",
  "toHit",
  "spellToHit",
] as const;
export const SheetRollKind = z.enum(SHEET_ROLL_KINDS);
export type SheetRollKind = z.infer<typeof SheetRollKind>;

export const isAbilityRollKind = (k: SheetRollKind): k is AbilityRollKind =>
  k === "check" || k === "save";

/** Kinds that may name an attack row (`attackId`; absent = the first attack). */
export const isAttackRowKind = (k: SheetRollKind): boolean =>
  k === "attack" || k === "damage" || k === "toHit";

/** Kinds that need a spell row (`spellId`). */
export const isSpellRowKind = (k: SheetRollKind): boolean =>
  k === "spellAttack" || k === "spellDamage" || k === "spellToHit";

/**
 * FR-CHAR-07, FR-CHAR-21, FR-CHARX-21, FR-CHARX-42: one manual entry per roll — attack 2
 * (to-hit, damage), else 1. `spellAttack` is 1 or 2 (damage if the spell has it): checked
 * against the roll specs.
 */
export const MANUAL_COUNT: Record<Exclude<SheetRollKind, "spellAttack">, number> = {
  initiative: 1,
  attack: 2,
  check: 1,
  save: 1,
  skill: 1,
  damage: 1,
  spellDamage: 1,
  toHit: 1,
  spellToHit: 1,
};

const Id = z.string().min(1).max(64);

/**
 * Intent `char.roll` (FR-CHAR-05–07, FR-CHAR-17, FR-CHAR-21, FR-CHARX-20, -42): `ability` iff
 * check / save; `skill` iff skill; `attackId` only with attack / damage / toHit (absent = the
 * first attack); `spellId` iff spellAttack / spellDamage / spellToHit. Wrong combinations →
 * `invalid`.
 */
export const SheetRollIntent = z
  .strictObject({
    characterId: Id,
    kind: SheetRollKind,
    ability: Ability.optional(),
    skill: SkillName.optional(),
    attackId: Id.optional(),
    spellId: Id.optional(),
    mode: RollMode.default("normal"),
    manual: z.array(ManualEntry).min(1).max(2).optional(),
    public: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    const n = v.kind === "spellAttack" ? null : MANUAL_COUNT[v.kind];
    if (v.manual && n !== null && v.manual.length !== n) {
      ctx.addIssue({
        code: "custom",
        path: ["manual"],
        message: `Enter ${n} physical ${n === 1 ? "roll" : "rolls"} for ${v.kind}`,
      });
    }
    if (isAbilityRollKind(v.kind) && v.ability === undefined) {
      ctx.addIssue({ code: "custom", path: ["ability"], message: `Pick an ability to ${v.kind}` });
    }
    if (!isAbilityRollKind(v.kind) && v.ability !== undefined) {
      ctx.addIssue({ code: "custom", path: ["ability"], message: `No ability for ${v.kind}` });
    }
    if ((v.kind === "skill") !== (v.skill !== undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["skill"],
        message: v.kind === "skill" ? "Pick a skill" : `No skill for ${v.kind}`,
      });
    }
    if (v.attackId !== undefined && !isAttackRowKind(v.kind)) {
      ctx.addIssue({ code: "custom", path: ["attackId"], message: `No attack for ${v.kind}` });
    }
    const spellKind = isSpellRowKind(v.kind);
    if (spellKind !== (v.spellId !== undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["spellId"],
        message: spellKind ? "Pick a spell" : `No spell for ${v.kind}`,
      });
    }
  });
export type SheetRollIntent = z.input<typeof SheetRollIntent>;

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
