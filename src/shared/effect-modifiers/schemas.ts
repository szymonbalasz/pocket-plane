// effect-modifiers boundary schemas (MOD §8, §9; data model §23): the modifier JSON leaf, roll
// selectors and subjects, the `effect-preset` record, built-in preset keys and limits.
//
// A leaf module: `@shared/entities/schemas` imports `@shared/combat-extras/schemas`, which
// imports this one, so abilities and damage types are listed here (type-checked against
// entities' lists, and equal by test) instead of imported at runtime.
import type { Ability, DAMAGE_TYPES } from "@shared/entities/schemas";
import { z } from "zod";

export const EFFECT_PRESET_TYPE = "effect-preset";

/** FR-MOD-01, -06, -07 limits; MOD §8.2 text lengths. */
export const MODIFIERS_MAX = 6;
export const FLAT_MAX = 10;
export const PRESET_NAME_MAX = 40;
export const PRESET_KEY_MAX = 40;
export const PRESET_NOTE_MAX = 200;
export const CAMPAIGN_PRESETS_MAX = 40;
export const CHARACTER_PRESETS_MAX = 6;
export const PRESET_DURATION_MAX = 100;

/**
 * The highest modifier tier this build has built (MOD §14.2; tier 1 #190, tier 2 sprint 3 R1).
 * Modifiers of a higher tier are `invalid` everywhere; built-in presets ship only parts of built
 * tiers. Tier 3 adds no kind.
 */
export const BUILT_TIER = 2;

const MOD_ABILITIES = [
  "str",
  "dex",
  "con",
  "int",
  "wis",
  "cha",
] as const satisfies readonly Ability[];
const MOD_DAMAGE_TYPES = [
  "acid",
  "bludgeoning",
  "cold",
  "fire",
  "force",
  "lightning",
  "necrotic",
  "piercing",
  "poison",
  "psychic",
  "radiant",
  "slashing",
  "thunder",
] as const satisfies readonly (typeof DAMAGE_TYPES)[number][];
/** Same lists as `ABILITIES` / `DAMAGE_TYPES` (`@shared/entities/schemas`; equal by test). */
export const MODIFIER_ABILITIES: readonly Ability[] = MOD_ABILITIES;
export const MODIFIER_DAMAGE_TYPES: readonly (typeof DAMAGE_TYPES)[number][] = MOD_DAMAGE_TYPES;
const AbilityKey = z.enum(MOD_ABILITIES);
const DamageTypeKey = z.enum(MOD_DAMAGE_TYPES);
/** A damage type on a typed part (FR-MOD-19: trigger parts, line parts). */
export const PartDamageType = DamageTypeKey;
export type PartDamageType = z.infer<typeof PartDamageType>;

/** Roll kinds a selector or a roll subject names (FR-MOD-02). */
export const ROLL_KINDS = ["attack", "damage", "save", "check", "initiative"] as const;
export const RollKind = z.enum(ROLL_KINDS);
export type RollKind = z.infer<typeof RollKind>;

export const ROLL_VIA = ["weapon", "spell"] as const;
export const RollVia = z.enum(ROLL_VIA);
export type RollVia = z.infer<typeof RollVia>;

const takesAbilities = (k: RollKind) => k === "save" || k === "check";
const takesVia = (k: RollKind) => k === "attack" || k === "damage";

/**
 * Roll selector (FR-MOD-02): `abilities` on save / check only (absent = every one), `via` on
 * attack / damage only (absent = both).
 */
export const RollSel = z
  .strictObject({
    roll: RollKind,
    abilities: z.array(AbilityKey).min(1).max(MOD_ABILITIES.length).optional(),
    via: RollVia.optional(),
  })
  .superRefine((s, ctx) => {
    if (s.abilities && !takesAbilities(s.roll)) {
      ctx.addIssue({
        code: "custom",
        path: ["abilities"],
        message: "Abilities: saves and checks only",
      });
    }
    if (s.abilities && new Set(s.abilities).size !== s.abilities.length) {
      ctx.addIssue({ code: "custom", path: ["abilities"], message: "Abilities: no duplicates" });
    }
    if (s.via && !takesVia(s.roll)) {
      ctx.addIssue({
        code: "custom",
        path: ["via"],
        message: "Weapon / spell: attacks and damage only",
      });
    }
  });
export type RollSel = z.infer<typeof RollSel>;

/** `flat` on AC (tier 2). */
export const AcSel = z.strictObject({ roll: z.literal("ac") });

/** `NdM`: N 1–4, M ∈ 4/6/8/10/12; the sign is its own field. */
export const MOD_DICE_RE = /^[1-4]d(4|6|8|10|12)$/;

export const DiceModifier = z.strictObject({
  kind: z.literal("dice"),
  on: RollSel,
  dice: z.string().regex(MOD_DICE_RE, { message: "Dice must look like 1d4 (1–4 dice, d4–d12)" }),
  sign: z.union([z.literal(1), z.literal(-1)]),
});
export const FlatModifier = z.strictObject({
  kind: z.literal("flat"),
  on: z.union([RollSel, AcSel]),
  value: z
    .int()
    .min(-FLAT_MAX)
    .max(FLAT_MAX)
    .refine((v) => v !== 0, "Value must not be 0"),
});
export const ModeModifier = z.strictObject({
  kind: z.literal("mode"),
  on: RollSel,
  mode: z.enum(["advantage", "disadvantage"]),
});
export const DefenseModifier = z.strictObject({
  kind: z.literal("defense"),
  types: z.array(DamageTypeKey).min(1).max(MOD_DAMAGE_TYPES.length),
  level: z.enum(["resistance", "vulnerability", "immunity"]),
});

/** A modifier of any tier (MOD §8.1): built-in presets are written with every tier's parts. */
export const AnyModifier = z.discriminatedUnion("kind", [
  DiceModifier,
  FlatModifier,
  ModeModifier,
  DefenseModifier,
]);
export type AnyModifier = z.infer<typeof AnyModifier>;

/** Tier of a modifier (MOD §2): `dice`, `flat` on a roll → 1; `mode`, `defense`, `flat` on AC → 2. */
export function modifierTier(m: AnyModifier): number {
  if (m.kind === "dice") return 1;
  if (m.kind === "flat") return m.on.roll === "ac" ? 2 : 1;
  return 2;
}

/** FR-MOD-01: a modifier of a built tier; unbuilt tiers → `invalid`. Stored and sent shape. */
export const Modifier = AnyModifier.superRefine((m, ctx) => {
  if (modifierTier(m) > BUILT_TIER) {
    ctx.addIssue({ code: "custom", message: "This modifier kind is not available yet" });
  }
});
export type Modifier = z.infer<typeof Modifier>;

/** An effect's list (FR-MOD-03): 0–6, default `[]`. */
export const Modifiers = z.array(Modifier).max(MODIFIERS_MAX);
/** A preset's list (MOD §8.2): 1–6. */
export const PresetModifiers = z.array(Modifier).min(1).max(MODIFIERS_MAX);

/**
 * `RollSubject.row` (FR-MOD-13, #209): the attack / spell row's name. Attack rows are ≤ 40,
 * spell rows ≤ 60 (CHARX), so the subject takes 60; a `row` filter's names are ≤ 40.
 */
export const ROLL_ROW_MAX = 60;

/**
 * Who rolls what (FR-MOD-13): `dice.evaluate`'s optional subject. A PC combatant's subject is
 * its character. `ability` on saves / checks (a death save has none); `via` on attacks / damage;
 * `crit` on damage rolled for a natural 20. Rule triggers (ADR-0043): `card` = this damage roll
 * belongs to a damage card (`cbt.attack`, `cbt.rollDamage`; `hit` triggers are offered on it);
 * `toHitMode` = that card's to-hit mode (`DamageCardPayload.mode`, the final mode after
 * `modes()`; a damage-only card: absent = `normal`), read by `mode` filters (FR-MOD-37, R4);
 * `row` = the attack / spell row's name (absent for ability, save, initiative rolls), read only
 * by the `row` filter.
 */
export const RollSubject = z.strictObject({
  creature: z.union([
    z.strictObject({ combatantId: z.string().min(1) }),
    z.strictObject({ characterId: z.string().min(1) }),
  ]),
  roll: RollKind,
  ability: AbilityKey.optional(),
  via: RollVia.optional(),
  crit: z.boolean().optional(),
  card: z.boolean().optional(),
  toHitMode: z.enum(["normal", "advantage", "disadvantage"]).optional(),
  row: z.string().min(1).max(ROLL_ROW_MAX).optional(),
});
export type RollSubject = z.infer<typeof RollSubject>;

/** Built-in preset keys (MOD §8.3); the data itself ships with the presets (FR-MOD-05). */
export const BUILTIN_PRESET_KEYS = [
  "bless",
  "bane",
  "rage",
  "hunters-mark",
  "guidance",
  "resistance",
  "shield-of-faith",
  "reckless",
  "dodge",
] as const;
export type BuiltinPresetKey = (typeof BUILTIN_PRESET_KEYS)[number];

export const isBuiltinPresetKey = (k: string | null): k is BuiltinPresetKey =>
  k !== null && (BUILTIN_PRESET_KEYS as readonly string[]).includes(k);

/** FR-MOD-21: what a player gets of an effect's `presetKey`: built-in keys only, ids → null. */
export const playerPresetKey = (k: string | null): BuiltinPresetKey | null =>
  isBuiltinPresetKey(k) ? k : null;

const Id = z.string();

/**
 * `effect-preset` row = DM view (MOD §8.2). Campaign preset: `characterId` null (`key` set =
 * customises that built-in). Character preset: `characterId` set, owner copy, toggle state in
 * `activeEffectId`, tier-3 `usesFeatureId`.
 */
export const EffectPresetRecordShape = z.object({
  id: Id,
  campaignId: Id,
  seq: z.int(),
  key: z.string().min(1).max(PRESET_KEY_MAX).nullable(),
  characterId: Id.nullable(),
  ownerPlayerId: Id.nullable(),
  name: z.string().min(1).max(PRESET_NAME_MAX),
  modifiers: PresetModifiers,
  durationRounds: z.int().min(1).max(PRESET_DURATION_MAX).nullable(),
  concentration: z.boolean(),
  activeEffectId: Id.nullable(),
  usesFeatureId: Id.nullable(),
  /**
   * FR-MOD-36 (review R5): the built-in key "Start from" copied; null for a blank preset or a
   * customised built-in (its `key` already is it). Origin match for rule triggers' `requires`.
   */
  originKey: z.string().min(1).max(PRESET_KEY_MAX).nullable(),
  note: z.string().max(PRESET_NOTE_MAX),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const EffectPresetRecord = EffectPresetRecordShape.superRefine((r, ctx) => {
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if (r.characterId === null) {
    if (r.ownerPlayerId !== null) issue("Owner on character presets only");
    if (r.activeEffectId !== null) issue("Toggle state on character presets only");
    if (r.usesFeatureId !== null) issue("Uses on character presets only");
  } else if (r.key !== null) {
    issue("Key on campaign presets only");
  }
  if (r.key !== null && r.originKey !== null) issue("A customised built-in has no origin");
});
export type EffectPresetRecord = z.infer<typeof EffectPresetRecordShape>;
