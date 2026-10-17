// entities boundary schemas (ENT §6, §8, §9): kind registry, creature core, wire records,
// REST bodies, derived values. One schema for pipeline, commands, fixtures and clients.
import { DeathSaveCount, TempHp } from "@shared/combat-extras/schemas";
import { sourceRank } from "@shared/compendium/match";
import { z } from "zod";
import { HP_FORMULA_MESSAGE, normalizeHpFormula, parseHpFormula } from "./hp-formula";

export { clampRolledHp, hpAverage, hpRollSpec, parseHpFormula } from "./hp-formula";

// ---------- creature core (FR-ENT-02, ENT §8) ----------

export const SIZES = ["tiny", "small", "medium", "large", "huge", "gargantuan"] as const;
export const Size = z.enum(SIZES);
export type Size = z.infer<typeof Size>;

/** SRD 5.1 damage types. */
export const DAMAGE_TYPES = [
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
] as const;
export const DamageType = z.enum(DAMAGE_TYPES);

/** `NdM[+K|-K]`: N 1–20, M ∈ 4/6/8/10/12/20/100, K 0–30 (ENT §8; subset of the dice grammar). */
export const DAMAGE_RE = /^([1-9]|1\d|20)d(4|6|8|10|12|20|100)([+-]([0-9]|[12]\d|30))?$/;
export const Damage = z.string().regex(DAMAGE_RE, { message: "Damage must look like 1d6+2" });

const int = (min: number, max: number) => z.number().int().min(min).max(max);

const Id = z.string().min(1).max(64);

export const Attack = z.strictObject({
  /** Row id from `ctx.ids` (FR-CHARX-16); legacy rows have none until their first sheet write. */
  id: Id.optional(),
  name: z.string().trim().min(1).max(40),
  toHit: int(-10, 30),
  damage: Damage,
  damageType: DamageType.optional(),
});
export type Attack = z.infer<typeof Attack>;

/** FR-CHARX-01: 0–20 attack rows (was 0–1); ids unique where set. */
export const ATTACKS_MAX = 20;
export const Attacks = z
  .array(Attack)
  .max(ATTACKS_MAX)
  .refine(
    (rows) => {
      const ids = rows.flatMap((r) => (r.id === undefined ? [] : [r.id]));
      return new Set(ids).size === ids.length;
    },
    { message: "Attack ids must be unique" },
  );

// ---------- abilities (FR-ENT-23) ----------

export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"] as const;
export const Ability = z.enum(ABILITIES);
export type Ability = z.infer<typeof Ability>;

export const ABILITY_NAMES: Readonly<Record<Ability, string>> = {
  str: "Strength",
  dex: "Dexterity",
  con: "Constitution",
  int: "Intelligence",
  wis: "Wisdom",
  cha: "Charisma",
};

/** All six scores together, int 1–30. */
export const Abilities = z.strictObject({
  str: int(1, 30),
  dex: int(1, 30),
  con: int(1, 30),
  int: int(1, 30),
  wis: int(1, 30),
  cha: int(1, 30),
});
export type Abilities = z.infer<typeof Abilities>;

export const SaveProficiencies = z
  .array(Ability)
  .max(ABILITIES.length)
  .refine((a) => new Set(a).size === a.length, { message: "Save proficiencies must be unique" });

/** Walking speed in ft: 0–200, multiple of 5 (FR-ENT-21). */
export const Speed = int(0, 200).refine((n) => n % 5 === 0, {
  message: "Speed must be a multiple of 5",
});

// ---------- skills, overrides, spellcasting, classes (FR-CHARX-01, CHARX §8.1) ----------

/** The 18 SRD skills (camelCase keys) and the ability each uses. */
export const SKILL_ABILITY = {
  acrobatics: "dex",
  animalHandling: "wis",
  arcana: "int",
  athletics: "str",
  deception: "cha",
  history: "int",
  insight: "wis",
  intimidation: "cha",
  investigation: "int",
  medicine: "wis",
  nature: "int",
  perception: "wis",
  performance: "cha",
  persuasion: "cha",
  religion: "int",
  sleightOfHand: "dex",
  stealth: "dex",
  survival: "wis",
} as const satisfies Record<string, Ability>;
export type Skill = keyof typeof SKILL_ABILITY;
export const SKILLS = Object.keys(SKILL_ABILITY) as [Skill, ...Skill[]];
export const SkillName = z.enum(SKILLS);

export const SKILL_NAMES: Readonly<Record<Skill, string>> = {
  acrobatics: "Acrobatics",
  animalHandling: "Animal Handling",
  arcana: "Arcana",
  athletics: "Athletics",
  deception: "Deception",
  history: "History",
  insight: "Insight",
  intimidation: "Intimidation",
  investigation: "Investigation",
  medicine: "Medicine",
  nature: "Nature",
  perception: "Perception",
  performance: "Performance",
  persuasion: "Persuasion",
  religion: "Religion",
  sleightOfHand: "Sleight of Hand",
  stealth: "Stealth",
  survival: "Survival",
};

export const PASSIVE_SKILLS = ["perception", "investigation", "insight"] as const;
export type PassiveSkill = (typeof PASSIVE_SKILLS)[number];

export const SkillProficiency = z.enum(["proficient", "expertise"]);
export type SkillProficiency = z.infer<typeof SkillProficiency>;
/** Absent skill = not proficient; needs `abilities`. */
export const Skills = z.partialRecord(SkillName, SkillProficiency);
export type Skills = z.infer<typeof Skills>;

/** FR-CHARX-06: the fixed override key list. */
export const OVERRIDE_KEYS = [
  "proficiency",
  ...ABILITIES.map((a) => `check.${a}` as const),
  ...ABILITIES.map((a) => `save.${a}` as const),
  ...SKILLS.map((s) => `skill.${s}` as const),
  ...PASSIVE_SKILLS.map((s) => `passive.${s}` as const),
  "spellAttack",
  "spellDc",
] as const;
export type OverrideKey = (typeof OVERRIDE_KEYS)[number];
export const OverrideKeyName = z.enum(OVERRIDE_KEYS);

export const Override = z.strictObject({
  value: int(-20, 40),
  note: z.string().trim().max(60).optional(),
});
export type Override = z.infer<typeof Override>;
export const Overrides = z.partialRecord(OverrideKeyName, Override);
export type Overrides = z.infer<typeof Overrides>;

export const SPELL_LEVELS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;
export const SpellLevelKey = z.enum(SPELL_LEVELS);
export type SpellLevelKey = z.infer<typeof SpellLevelKey>;

/** Slot maxima per spell level (absent = 0); needs `abilities`. */
export const Spellcasting = z.strictObject({
  ability: Ability,
  slots: z.partialRecord(SpellLevelKey, int(0, 9)),
});
export type Spellcasting = z.infer<typeof Spellcasting>;

export const HIT_DICE = ["d6", "d8", "d10", "d12"] as const;
export const HitDie = z.enum(HIT_DICE);
export type HitDie = z.infer<typeof HitDie>;

export const ClassRow = z.strictObject({
  name: z.string().trim().min(1).max(30),
  level: int(1, 20),
  hitDie: HitDie,
  subclass: z.string().trim().max(30).optional(),
});
export type ClassRow = z.infer<typeof ClassRow>;

export const CLASS_NAME_MAX = 40;
export const LEVEL_MAX = 20;

/** FR-CHARX-03: serialized stat block cap (UTF-8 bytes of its JSON). */
export const STAT_BLOCK_MAX_BYTES = 12 * 1024;
export const SHEET_FULL_MESSAGE = "Sheet is full";

const jsonBytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).length;

/** FR-ENT-25: optional HP formula, stored normalised (`2d8+2`). */
export const HpFormula = z
  .string()
  .max(20)
  .transform(normalizeHpFormula)
  .refine((f) => parseHpFormula(f) !== null, { message: HP_FORMULA_MESSAGE });

/** FR-CHARX-49: darkvision 0–120 ft, step 5 (OQ-FOG-35). */
export const SENSE_FT_MAX = 120;
/** FR-CHARX-49 (sprint 4, OQ-FOG-51): stored vision 0–995 ft; Normal (999) is "absent", never stored. */
export const VISION_FT_MAX = 995;
const step5 = (max: number) => int(0, max).refine((v) => v % 5 === 0, "Must be a multiple of 5");
const SenseFt = step5(SENSE_FT_MAX);

/**
 * FR-CHARX-49 / -53 (ADR-0042): stored senses that drive fog's dynamic vision. Sprint 4 (#243 [1],
 * OQ-FOG-51): `visionFt` absent (or no `senses`) = Normal = 999 ft; a stored value, 0 included,
 * is kept. Darkvision absent = 0; no see-through, no sees-invisible. `seesInvisible` (#210)
 * absent = false.
 */
export const Senses = z.strictObject({
  visionFt: step5(VISION_FT_MAX).optional(),
  darkvisionFt: SenseFt,
  seesMagicalDarkness: z.boolean(),
  seesInvisible: z.boolean().optional(),
});
export type Senses = z.infer<typeof Senses>;

const core = {
  size: Size,
  ac: int(0, 30),
  hpMax: int(1, 999),
  /** FR-ENT-25: absent = only Average HP (the stat block's `hpMax`) is offered. */
  hpFormula: HpFormula.optional(),
  initBonus: int(-10, 20),
  attacks: Attacks,
  /** Absent = unknown: no movement indicator (FR-ENT-21). */
  speed: Speed.optional(),
  abilities: Abilities.optional(),
  /** Absent = none; needs `abilities` (FR-ENT-23). */
  saveProficiencies: SaveProficiencies.optional(),
  /** FR-CHARX-01: needs `abilities`. */
  skills: Skills.optional(),
  /** FR-CHARX-06: replace the derived value of each key. */
  overrides: Overrides.optional(),
  /** FR-CHARX-01: needs `abilities`. */
  spellcasting: Spellcasting.optional(),
  /** FR-CHARX-49 (sprint 3): absent = no vision (FOG v2). Not on the summary whitelist. */
  senses: Senses.optional(),
};

/**
 * FR-ENT-23 / FR-CHARX-01: `saveProficiencies`, `skills`, `spellcasting` without `abilities` →
 * `invalid`. FR-CHARX-03: the whole block ≤ 12 KB.
 */
function coreRules(
  s: {
    abilities?: Abilities;
    saveProficiencies?: Ability[];
    skills?: Skills;
    spellcasting?: Spellcasting;
  },
  c: z.RefinementCtx,
) {
  if (s.abilities === undefined) {
    const needs = [
      ["saveProficiencies", "Save proficiencies need ability scores"],
      ["skills", "Skills need ability scores"],
      ["spellcasting", "Spellcasting needs ability scores"],
    ] as const;
    for (const [key, message] of needs) {
      if (s[key] !== undefined) c.addIssue({ code: "custom", path: [key], message });
    }
  }
  if (jsonBytes(s) > STAT_BLOCK_MAX_BYTES) {
    c.addIssue({ code: "custom", path: [], message: SHEET_FULL_MESSAGE });
  }
}

/** FR-CHARX-04: what the server writes for `level` / `className` when `classes` is set. */
export function classTotals(classes: readonly ClassRow[]): { level: number; className: string } {
  return {
    level: classes.reduce((n, c) => n + c.level, 0),
    className: classes.map((c) => c.name).join("/"),
  };
}

/** FR-CHARX-04: Σ levels ≤ 20, joined names ≤ 40. */
function classRules(s: { classes?: ClassRow[] }, c: z.RefinementCtx) {
  if (!s.classes) return;
  const t = classTotals(s.classes);
  if (t.level > LEVEL_MAX) {
    c.addIssue({ code: "custom", path: ["classes"], message: "Total level must be at most 20" });
  }
  if (t.className.length > CLASS_NAME_MAX) {
    c.addIssue({
      code: "custom",
      path: ["classes"],
      message: `Class names together must be at most ${CLASS_NAME_MAX} characters`,
    });
  }
}

export const CR_VALUES = [
  "0",
  "1/8",
  "1/4",
  "1/2",
  ...Array.from({ length: 30 }, (_, i) => String(i + 1)),
] as const;
export const Cr = z.enum(CR_VALUES as unknown as [string, ...string[]]);

export const MonsterStatBlock = z.strictObject({ ...core, cr: Cr }).superRefine(coreRules);
export type MonsterStatBlock = z.infer<typeof MonsterStatBlock>;

export const CharacterStatBlock = z
  .strictObject({
    ...core,
    level: int(1, LEVEL_MAX),
    className: z.string().trim().max(CLASS_NAME_MAX),
    /** FR-CHARX-04: 1–4 rows; when set, `level` / `className` are written from them. */
    classes: z.array(ClassRow).min(1).max(4).optional(),
    species: z.string().trim().max(40).optional(),
  })
  .superRefine((s, c) => {
    coreRules(s, c);
    classRules(s, c);
  });
export type CharacterStatBlock = z.infer<typeof CharacterStatBlock>;

/** FR-CHARX-04: a character block with `level` / `className` written from `classes` (if set). */
export function withClassTotals<S extends CharacterStatBlock>(s: S): S {
  return s.classes ? { ...s, ...classTotals(s.classes) } : s;
}

/** FR-CHARX-16: legacy attacks without `id` get one from `nextId` (`ctx.ids`); others kept. */
export function withAttackIds<S extends { attacks: Attack[] }>(s: S, nextId: () => string): S {
  if (s.attacks.every((a) => a.id !== undefined)) return s;
  return { ...s, attacks: s.attacks.map((a) => (a.id === undefined ? { ...a, id: nextId() } : a)) };
}

// ---------- token shape (FR-ENT-22, FR-MAP-35) ----------

export const TOKEN_SHAPES = ["round", "square", "none"] as const;
export const TokenShape = z.enum(TOKEN_SHAPES);
export type TokenShape = z.infer<typeof TokenShape>;

// ---------- kind registry (FR-ENT-01) ----------

export const ENTITY_KINDS = ["character", "monster"] as const;
export const EntityKind = z.enum(ENTITY_KINDS);
export type EntityKind = z.infer<typeof EntityKind>;

/** Per-kind stat block schema. New kinds register here; fields are only ever added as optional. */
export const kindRegistry = {
  character: { statBlock: CharacterStatBlock },
  monster: { statBlock: MonsterStatBlock },
} as const satisfies Record<EntityKind, { statBlock: z.ZodType }>;

export type StatBlockOf<K extends EntityKind> = z.infer<(typeof kindRegistry)[K]["statBlock"]>;
export type StatBlock = MonsterStatBlock | CharacterStatBlock;

// ---------- name (FR-ENT-08) ----------

// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the rule (FR-ENT-08).
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export const ENTITY_NAME_MAX = 60;

/** Trimmed, 1–60 chars, no control chars. */
export const EntityName = z
  .string()
  .refine((s) => !CONTROL.test(s), { message: "Name must not contain control characters" })
  .transform((s) => s.trim())
  .refine((s) => s.length >= 1, { message: "Name is required" })
  .refine((s) => [...s].length <= ENTITY_NAME_MAX, {
    message: `Name must be at most ${ENTITY_NAME_MAX} characters`,
  });

/** Case-insensitive name key for uniqueness (FR-ENT-08). */
export const entityNameKey = (s: string) => s.normalize("NFC").toLowerCase();

// ---------- wire records (ENT §9) ----------

const recordBase = {
  id: z.string(),
  name: z.string(),
  portraitAssetId: z.string().nullable(),
  /** Default shape for new tokens; null = round (FR-ENT-22). Imported rows null. */
  tokenShape: TokenShape.nullable(),
  derivedFromId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
};

/** `entity` (campaign scope): customs + characters, row minus provenance. DM full view. */
export const EntityRecord = z.discriminatedUnion("kind", [
  z.object({
    ...recordBase,
    kind: z.literal("monster"),
    campaignId: z.string(),
    statBlock: MonsterStatBlock,
    ownerPlayerId: z.null(),
    hpCurrent: z.null(),
  }),
  z.object({
    ...recordBase,
    kind: z.literal("character"),
    campaignId: z.string(),
    statBlock: CharacterStatBlock,
    ownerPlayerId: z.string(),
    hpCurrent: z.number().int(),
    // combat-extras play state (FR-CBTX-14/19), like `hpCurrent`: DM + owner only (FR-CBTX-32).
    // Never in `statBlock`; `PUT /api/entities` never writes them. Default 0 = the DB default
    // (records built before CBTX still parse).
    tempHp: TempHp.default(0),
    deathSuccesses: DeathSaveCount.default(0),
    deathFailures: DeathSaveCount.default(0),
  }),
]);
export type EntityRecord = z.infer<typeof EntityRecord>;
export type MonsterRecord = Extract<EntityRecord, { kind: "monster" }>;
export type CharacterRecord = Extract<EntityRecord, { kind: "character" }>;

/** FR-CBTX-19: derived from the death-save columns (`deathStateOf`); null = not at 0 HP. */
export const DeathState = z.enum(["dying", "stable", "dead"]);
export type DeathState = z.infer<typeof DeathState>;

/**
 * What a player receives of another player's character: the **one whitelist** (ADR-0036
 * "Refines ADR-0024", FR-CHARX-35, FR-CBTX-32). Every spec adding a key amends this schema; its
 * keys are `REDACTED_CHARACTER_KEYS`. `down` = `hpCurrent = 0`, derived in the visibility fn;
 * never the HP number (#154). No `tokenShape` (FR-ENT-22), stat-block numbers or text.
 */
export const RedactedCharacter = z.strictObject({
  // ADR-0024 (#120)
  id: z.string(),
  kind: z.literal("character"),
  name: z.string(),
  portraitAssetId: z.string().nullable(),
  ownerPlayerId: z.string(),
  // #154, FR-ENT-15
  down: z.boolean(),
  // FR-CHARX-35 (OQ-CHARX-05); `species` null when unset
  level: z.number().int(),
  className: z.string(),
  species: z.string().nullable(),
  // combat-extras (OQ-CBTX-09, FR-CBTX-32): derived from the counters + HP; null = not at 0 HP.
  // Never the counters or temp HP.
  deathState: DeathState.nullable(),
});
export type RedactedCharacter = z.infer<typeof RedactedCharacter>;
export const REDACTED_CHARACTER_KEYS = Object.keys(
  RedactedCharacter.shape,
) as readonly (keyof RedactedCharacter)[];

export const Provenance = z.object({
  source: z.string(),
  sourceKey: z.string(),
  licence: z.string(),
  attribution: z.string(),
  importedAt: z.string(),
});

/** `imported-entity` (global scope): row incl. provenance; DM only (FR-ENT-16). MVP: monsters. */
export const ImportedEntityRecord = z.object({
  ...recordBase,
  ...Provenance.shape,
  kind: z.literal("monster"),
  campaignId: z.null(),
  statBlock: MonsterStatBlock,
  ownerPlayerId: z.null(),
  hpCurrent: z.null(),
});
export type ImportedEntityRecord = z.infer<typeof ImportedEntityRecord>;

export type DefinitionRecord = EntityRecord | ImportedEntityRecord;

export const ENTITY_TYPE = "entity";
export const IMPORTED_ENTITY_TYPE = "imported-entity";

// ---------- import batch record data (FR-ENT-06) ----------

/** `data` of an import batch record, per kind: `{name, statBlock}`. */
export const importData = {
  monster: z.strictObject({ name: EntityName, statBlock: MonsterStatBlock }),
} as const;

// ---------- REST bodies (ENT §9) ----------

const portrait = Id.nullable().optional();
/** FR-ENT-22: omitted or null = round; an update without it sets null (FR-ENT-11). */
const tokenShape = TokenShape.nullable().optional();

/** POST /api/entities. Strict: spoofed `campaignId` / `source` / … → `invalid`. */
export const CreateEntityBody = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("monster"),
    name: EntityName,
    portraitAssetId: portrait,
    tokenShape,
    statBlock: MonsterStatBlock,
    derivedFromId: Id.optional(),
  }),
  z.strictObject({
    kind: z.literal("character"),
    name: EntityName,
    portraitAssetId: portrait,
    tokenShape,
    statBlock: CharacterStatBlock,
    ownerPlayerId: Id,
  }),
]);
export type CreateEntityBody = z.input<typeof CreateEntityBody>;

/**
 * PUT /api/entities/:id: whole replace (FR-ENT-11). The stat block is checked against the
 * stored kind by the command; `ownerPlayerId` is required for characters, absent for monsters.
 */
export const UpdateEntityBody = z.strictObject({
  name: EntityName,
  portraitAssetId: portrait,
  tokenShape,
  statBlock: z.record(z.string(), z.unknown()),
  ownerPlayerId: Id.optional(),
});
export type UpdateEntityBody = z.input<typeof UpdateEntityBody>;

export const EntityResponse = z.object({ entity: EntityRecord });
export type EntityResponse = z.infer<typeof EntityResponse>;

// ---------- derived values (FR-ENT-03, 05, 13) ----------

/** SRD / DMG XP by CR. CR 0 → 10 *(proposed, OQ-ENT-11)*. */
export const XP_BY_CR: Readonly<Record<string, number>> = {
  "0": 10,
  "1/8": 25,
  "1/4": 50,
  "1/2": 100,
  "1": 200,
  "2": 450,
  "3": 700,
  "4": 1100,
  "5": 1800,
  "6": 2300,
  "7": 2900,
  "8": 3900,
  "9": 5000,
  "10": 5900,
  "11": 7200,
  "12": 8400,
  "13": 10000,
  "14": 11500,
  "15": 13000,
  "16": 15000,
  "17": 18000,
  "18": 20000,
  "19": 22000,
  "20": 25000,
  "21": 33000,
  "22": 41000,
  "23": 50000,
  "24": 62000,
  "25": 75000,
  "26": 90000,
  "27": 105000,
  "28": 120000,
  "29": 135000,
  "30": 155000,
};

export function xpForCr(cr: string): number {
  const xp = XP_BY_CR[cr];
  if (xp === undefined) throw new Error(`Unknown CR "${cr}"`);
  return xp;
}

/** `readOnly = source != null` (FR-ENT-05). */
export const isReadOnlyDefinition = (d: { source?: string | null }) =>
  d.source !== undefined && d.source !== null;

/**
 * The stats an instance plays with (FR-ENT-13). MVP: the definition's stat block; instance
 * modifiers hook in here later (tier A). The only place instance stats are read.
 */
export function effectiveStats<S extends StatBlock>(def: { statBlock: S }, _instance?: unknown): S {
  return def.statBlock;
}

// ---------- ability derivation (FR-ENT-24, ADR-0032): never stored ----------

/** `floor((score − 10) / 2)`. */
export const abilityMod = (score: number): number => Math.floor((score - 10) / 2);

/** SRD proficiency bonus by CR: 0–4 +2, 5–8 +3, …, 29–30 +9 (fractions count as 0). */
function crProficiency(cr: string): number {
  const n = cr.includes("/") ? 0 : Number(cr);
  return 2 + Math.floor(Math.max(n - 1, 0) / 4);
}

/**
 * What the derivation helpers read: scores, proficiencies, overrides, spellcasting and `level`
 * (character) or `cr` (monster). Any stat block of either kind fits.
 */
export type AbilityStats = {
  abilities?: Abilities;
  saveProficiencies?: readonly Ability[];
  skills?: Skills;
  overrides?: Overrides;
  spellcasting?: Spellcasting;
} & ({ level: number } | { cr: string });

// ---------- full-sheet derivation with overrides (FR-CHARX-05–07, ADR-0036) ----------
//
// Every helper takes the stat block and returns the number the sheet shows, the server rolls and
// combat uses. An override (`overrides[key].value`) replaces the derived value; `proficiency`
// feeds every PB-based value, the other keys are leaves. A leaf whose base data is missing
// (no scores; no spellcasting) stays null even with an override: null = "not on this sheet".

/** The override value for `key`, if set. */
export const overrideOf = (stats: AbilityStats, key: OverrideKey): number | undefined =>
  stats.overrides?.[key]?.value;

export const isOverridden = (stats: AbilityStats, key: OverrideKey): boolean =>
  overrideOf(stats, key) !== undefined;

/** The same stats without the override for `key` (the "Derived +3" value of a tooltip). */
export function withoutOverride<S extends AbilityStats>(stats: S, key: OverrideKey): S {
  if (!stats.overrides || !(key in stats.overrides)) return stats;
  const { [key]: _dropped, ...rest } = stats.overrides;
  return { ...stats, overrides: rest };
}

/** Characters: 2 + floor((level − 1) / 4); monsters: the SRD CR table. Override `proficiency`. */
export function proficiencyBonus(stats: AbilityStats): number {
  return (
    overrideOf(stats, "proficiency") ??
    ("level" in stats ? 2 + Math.floor((stats.level - 1) / 4) : crProficiency(stats.cr))
  );
}

/** Check bonus = the ability modifier; null without scores. Override `check.<ability>`. */
export function checkBonus(stats: AbilityStats, ability: Ability): number | null {
  if (!stats.abilities) return null;
  return overrideOf(stats, `check.${ability}`) ?? abilityMod(stats.abilities[ability]);
}

/**
 * Save bonus = modifier + proficiency bonus if proficient; null without scores. Override
 * `save.<ability>`. Combat-extras' concentration save is `saveBonus(stats, "con")` (§7.1).
 */
export function saveBonus(stats: AbilityStats, ability: Ability): number | null {
  if (!stats.abilities) return null;
  const o = overrideOf(stats, `save.${ability}`);
  if (o !== undefined) return o;
  const prof = stats.saveProficiencies?.includes(ability) ? proficiencyBonus(stats) : 0;
  return abilityMod(stats.abilities[ability]) + prof;
}

/** Combat-extras' concentration save (CHARX §7.1): exactly the sheet's CON save. */
export const concentrationSaveBonus = (stats: AbilityStats): number | null =>
  saveBonus(stats, "con");

const SKILL_MULTIPLIER: Readonly<Record<SkillProficiency, number>> = {
  proficient: 1,
  expertise: 2,
};

/** Skill = mod + PB × {none 0, proficient 1, expertise 2}; null without scores. Override `skill.<skill>`. */
export function skillBonus(stats: AbilityStats, skill: Skill): number | null {
  if (!stats.abilities) return null;
  const o = overrideOf(stats, `skill.${skill}`);
  if (o !== undefined) return o;
  const p = stats.skills?.[skill];
  const mult = p ? SKILL_MULTIPLIER[p] : 0;
  return abilityMod(stats.abilities[SKILL_ABILITY[skill]]) + mult * proficiencyBonus(stats);
}

/** Passive = 10 + skill bonus (overrides of the skill included); null without scores. Override `passive.<skill>`. */
export function passiveScore(stats: AbilityStats, skill: PassiveSkill): number | null {
  const bonus = skillBonus(stats, skill);
  if (bonus === null) return null;
  return overrideOf(stats, `passive.${skill}`) ?? 10 + bonus;
}

/** Spell attack = PB + mod(spellcasting ability); null without spellcasting or scores. Override `spellAttack`. */
export function spellAttackBonus(stats: AbilityStats): number | null {
  if (!stats.spellcasting || !stats.abilities) return null;
  return (
    overrideOf(stats, "spellAttack") ??
    proficiencyBonus(stats) + abilityMod(stats.abilities[stats.spellcasting.ability])
  );
}

/** Spell save DC = 8 + PB + mod(spellcasting ability); null without spellcasting or scores. Override `spellDc`. */
export function spellSaveDc(stats: AbilityStats): number | null {
  if (!stats.spellcasting || !stats.abilities) return null;
  return (
    overrideOf(stats, "spellDc") ??
    8 + proficiencyBonus(stats) + abilityMod(stats.abilities[stats.spellcasting.ability])
  );
}

/**
 * The value behind any override key, overrides honoured (the sheet's Override popover:
 * `sheetValue(withoutOverride(stats, key), key)` = "Derived +3").
 */
export function sheetValue(stats: AbilityStats, key: OverrideKey): number | null {
  if (key === "proficiency") return proficiencyBonus(stats);
  if (key === "spellAttack") return spellAttackBonus(stats);
  if (key === "spellDc") return spellSaveDc(stats);
  const [group, name] = key.split(".") as [string, string];
  if (group === "check") return checkBonus(stats, name as Ability);
  if (group === "save") return saveBonus(stats, name as Ability);
  if (group === "skill") return skillBonus(stats, name as Skill);
  return passiveScore(stats, name as PassiveSkill);
}

/** Hit dice per die size = Σ class levels with that die; `{}` without `classes` (no block). */
export function hitDice(stats: { classes?: readonly ClassRow[] }): Partial<Record<HitDie, number>> {
  const out: Partial<Record<HitDie, number>> = {};
  for (const c of stats.classes ?? []) out[c.hitDie] = (out[c.hitDie] ?? 0) + c.level;
  return out;
}

/**
 * Creatures window order (FR-ENT-18): name case-insensitive, then custom before imported, then
 * imported by source rank (FR-CMP-38: `srd-5.1` before `fixture`), then id. Code-point order on
 * the folded name, so it is the same on every machine.
 */
export function definitionOrder(
  a: { id: string; name: string; campaignId: string | null; source?: string | null },
  b: { id: string; name: string; campaignId: string | null; source?: string | null },
): number {
  const ka = entityNameKey(a.name);
  const kb = entityNameKey(b.name);
  if (ka !== kb) return ka < kb ? -1 : 1;
  // Customs rank 0 (the campaign's own); imported 1–3 by source.
  const ra = a.campaignId === null ? sourceRank(a.source ?? "") : 0;
  const rb = b.campaignId === null ? sourceRank(b.source ?? "") : 0;
  if (ra !== rb) return ra - rb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** HTML5 drag contract Creatures → canvas (FR-ENT-18, FR-MAP-13). */
export const DEFINITION_DRAG_MIME = "application/x-pp-definition";
export const DefinitionDragData = z.strictObject({ definitionId: Id });
export type DefinitionDragData = z.infer<typeof DefinitionDragData>;
