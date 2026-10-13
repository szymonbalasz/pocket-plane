// entities boundary schemas (ENT §6, §8, §9): kind registry, creature core, wire records,
// REST bodies, derived values. One schema for pipeline, commands, fixtures and clients.
import { z } from "zod";

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

export const Attack = z.strictObject({
  name: z.string().trim().min(1).max(40),
  toHit: int(-10, 30),
  damage: Damage,
  damageType: DamageType.optional(),
});
export type Attack = z.infer<typeof Attack>;

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

const core = {
  size: Size,
  ac: int(0, 30),
  hpMax: int(1, 999),
  initBonus: int(-10, 20),
  /** MVP: one weapon attack (ADR-0012). */
  attacks: z.array(Attack).max(1),
  /** Absent = unknown: no movement indicator (FR-ENT-21). */
  speed: Speed.optional(),
  abilities: Abilities.optional(),
  /** Absent = none; needs `abilities` (FR-ENT-23). */
  saveProficiencies: SaveProficiencies.optional(),
};

/** FR-ENT-23: `saveProficiencies` without `abilities` → `invalid`. */
function savesNeedAbilities(
  s: { abilities?: Abilities; saveProficiencies?: Ability[] },
  c: z.RefinementCtx,
) {
  if (s.saveProficiencies !== undefined && s.abilities === undefined) {
    c.addIssue({
      code: "custom",
      path: ["saveProficiencies"],
      message: "Save proficiencies need ability scores",
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

export const MonsterStatBlock = z.strictObject({ ...core, cr: Cr }).superRefine(savesNeedAbilities);
export type MonsterStatBlock = z.infer<typeof MonsterStatBlock>;

export const CharacterStatBlock = z
  .strictObject({
    ...core,
    level: int(1, 20),
    className: z.string().trim().max(40),
  })
  .superRefine(savesNeedAbilities);
export type CharacterStatBlock = z.infer<typeof CharacterStatBlock>;

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

const Id = z.string().min(1).max(64);

// ---------- wire records (ENT §9) ----------

const recordBase = {
  id: z.string(),
  name: z.string(),
  portraitAssetId: z.string().nullable(),
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
  }),
]);
export type EntityRecord = z.infer<typeof EntityRecord>;
export type MonsterRecord = Extract<EntityRecord, { kind: "monster" }>;
export type CharacterRecord = Extract<EntityRecord, { kind: "character" }>;

/** What a player receives of another player's character (FR-ENT-15). */
export const RedactedCharacter = z.object({
  id: z.string(),
  kind: z.literal("character"),
  name: z.string(),
  portraitAssetId: z.string().nullable(),
  ownerPlayerId: z.string(),
});
export type RedactedCharacter = z.infer<typeof RedactedCharacter>;

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

/** POST /api/entities. Strict: spoofed `campaignId` / `source` / … → `invalid`. */
export const CreateEntityBody = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("monster"),
    name: EntityName,
    portraitAssetId: portrait,
    statBlock: MonsterStatBlock,
    derivedFromId: Id.optional(),
  }),
  z.strictObject({
    kind: z.literal("character"),
    name: EntityName,
    portraitAssetId: portrait,
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

/** What the ability helpers read: scores, save proficiencies and `level` (character) or `cr` (monster). */
export type AbilityStats = { abilities?: Abilities; saveProficiencies?: readonly Ability[] } & (
  | { level: number }
  | { cr: string }
);

/** Characters: 2 + floor((level − 1) / 4); monsters: the SRD CR table. */
export function proficiencyBonus(stats: AbilityStats): number {
  return "level" in stats ? 2 + Math.floor((stats.level - 1) / 4) : crProficiency(stats.cr);
}

/** Check bonus = the ability modifier; null without scores. */
export function checkBonus(stats: AbilityStats, ability: Ability): number | null {
  return stats.abilities ? abilityMod(stats.abilities[ability]) : null;
}

/** Save bonus = modifier + proficiency bonus if proficient; null without scores. */
export function saveBonus(stats: AbilityStats, ability: Ability): number | null {
  if (!stats.abilities) return null;
  const prof = stats.saveProficiencies?.includes(ability) ? proficiencyBonus(stats) : 0;
  return abilityMod(stats.abilities[ability]) + prof;
}

/**
 * Creatures window order (FR-ENT-18): name case-insensitive, then custom before imported,
 * then id. Code-point order on the folded name, so it is the same on every machine.
 */
export function definitionOrder(
  a: { id: string; name: string; campaignId: string | null },
  b: { id: string; name: string; campaignId: string | null },
): number {
  const ka = entityNameKey(a.name);
  const kb = entityNameKey(b.name);
  if (ka !== kb) return ka < kb ? -1 : 1;
  const ia = a.campaignId === null ? 1 : 0;
  const ib = b.campaignId === null ? 1 : 0;
  if (ia !== ib) return ia - ib;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** HTML5 drag contract Creatures → canvas (FR-ENT-18, FR-MAP-13). */
export const DEFINITION_DRAG_MIME = "application/x-pp-definition";
export const DefinitionDragData = z.strictObject({ definitionId: Id });
export type DefinitionDragData = z.infer<typeof DefinitionDragData>;
