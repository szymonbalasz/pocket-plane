// character-sheet-full (CHARX §8.2, §9): the `creature-sheet` record, its row lists and the CHARX
// intents. Strict zod everywhere: one schema for commands, record type, fixtures and clients.
import {
  Abilities,
  Ability,
  Attack,
  ClassRow,
  Cr,
  Damage,
  DamageType,
  EntityName,
  HitDie,
  Overrides,
  SaveProficiencies,
  Senses,
  SHEET_FULL_MESSAGE,
  Size,
  Skills,
  Speed,
  Spellcasting,
  SpellLevelKey,
} from "@shared/entities/schemas";
import {
  type SHEET_EDIT_FIELDS,
  SheetResource,
  SheetRowList,
  SheetStatus,
} from "@shared/events/character-sheet";
import { z } from "zod";

export const CREATURE_SHEET_TYPE = "creature-sheet";

/** FR-CHARX-03: a `creature-sheet` row ≤ 48 KB (UTF-8 bytes of its JSON). */
export const SHEET_MAX_BYTES = 48 * 1024;

export const jsonBytes = (v: unknown): number => new TextEncoder().encode(JSON.stringify(v)).length;

const Id = z.string().min(1).max(64);
const int = (min: number, max: number) => z.number().int().min(min).max(max);
const rowName = (max: number) => z.string().trim().min(1).max(max);
const text = (max: number) => z.string().max(max);

// ---------- row lists (CHARX §8.2) ----------

export const SPELL_ROLLS = ["none", "attack", "save"] as const;
export const SpellRoll = z.enum(SPELL_ROLLS);
export type SpellRoll = z.infer<typeof SpellRoll>;
export const SpellEffect = z.enum(["damage", "healing"]);
export type SpellEffect = z.infer<typeof SpellEffect>;

const spellFields = {
  name: rowName(60),
  level: int(0, 9),
  prepared: z.boolean().default(false),
  concentration: z.boolean().default(false),
  ritual: z.boolean().default(false),
  roll: SpellRoll.default("none"),
  /** Iff `roll: save`. */
  saveAbility: Ability.optional(),
  /** Entities' damage grammar (`NdM±K`). */
  damage: Damage.optional(),
  effect: SpellEffect.default("damage"),
  damageType: DamageType.optional(),
  notes: text(200).default(""),
};

/** `saveAbility` iff `roll: save`; `roll: attack` ⇒ `effect: damage`. */
function spellRules(
  s: { roll: SpellRoll; saveAbility?: Ability; effect: SpellEffect },
  c: z.RefinementCtx,
) {
  if ((s.roll === "save") !== (s.saveAbility !== undefined)) {
    c.addIssue({
      code: "custom",
      path: ["saveAbility"],
      message: s.roll === "save" ? "Pick the save ability" : "Save ability only for save spells",
    });
  }
  if (s.roll === "attack" && s.effect !== "damage") {
    c.addIssue({ code: "custom", path: ["effect"], message: "An attack spell deals damage" });
  }
}

export const SpellRow = z.strictObject({ id: Id, ...spellFields }).superRefine(spellRules);
export type SpellRow = z.infer<typeof SpellRow>;
export type SpellRowInput = z.input<typeof SpellRow>;

const FEATURE_USES_MAX = 20;
/**
 * FR-CHARX-58 (sprint 4, OQ-CHARX-27): a feature row's `used` may pass `usesMax` by up to 9
 * (uses left down to −9, the floor). Slots and hit dice keep `0 … max`.
 */
export const FEATURE_OVERSPEND_MAX = 9;
const FEATURE_USED_MAX = FEATURE_USES_MAX + FEATURE_OVERSPEND_MAX;
const featureFields = {
  name: rowName(60),
  source: text(40).default(""),
  text: text(600).default(""),
  usesMax: int(1, FEATURE_USES_MAX).optional(),
  /** Label only: no rest buttons (OQ-CHARX-08). */
  reset: z.enum(["short", "long"]).optional(),
};

export const FeatureRow = z
  .strictObject({ id: Id, ...featureFields, used: int(0, FEATURE_USED_MAX).default(0) })
  .refine((f) => f.used <= (f.usesMax === undefined ? 0 : f.usesMax + FEATURE_OVERSPEND_MAX), {
    path: ["used"],
    message: `Used must not exceed the uses + ${FEATURE_OVERSPEND_MAX}`,
  });
export type FeatureRow = z.infer<typeof FeatureRow>;

const itemFields = {
  name: rowName(60),
  qty: int(0, 9999).default(1),
  equipped: z.boolean().default(false),
  notes: text(120).default(""),
};
export const ItemRow = z.strictObject({ id: Id, ...itemFields });
export type ItemRow = z.infer<typeof ItemRow>;

export const ProficiencyNotes = z.strictObject({
  armor: text(200).default(""),
  weapons: text(200).default(""),
  tools: text(200).default(""),
  languages: text(200).default(""),
});
export type ProficiencyNotes = z.infer<typeof ProficiencyNotes>;

/** Row limits per list (FR-CHARX-01, CHARX §8). */
export const ROW_LIMITS: Readonly<Record<SheetRowList, number>> = {
  attacks: 20,
  spells: 40,
  features: 30,
  items: 80,
};

const uniqueIds = <T extends { id: string }>(rows: T[]) =>
  new Set(rows.map((r) => r.id)).size === rows.length;

const rows = <S extends z.ZodType<{ id: string }>>(row: S, max: number) =>
  z.array(row).max(max).refine(uniqueIds, { message: "Row ids must be unique" });

/** Counters (FR-CHARX-17): absent = 0. */
export const SlotsUsed = z.partialRecord(SpellLevelKey, int(0, 9));
export type SlotsUsed = z.infer<typeof SlotsUsed>;
export const HitDiceUsed = z.partialRecord(HitDie, int(0, 20));
export type HitDiceUsed = z.infer<typeof HitDiceUsed>;

export const BACKGROUND_MAX = 40;
export const NOTES_MAX = 4000;

/** The sheet's content (everything but identity and timestamps). */
export const sheetDataShape = {
  status: SheetStatus,
  locked: z.boolean(),
  background: text(BACKGROUND_MAX),
  alignment: text(BACKGROUND_MAX),
  proficiencyNotes: ProficiencyNotes,
  spells: rows(SpellRow, ROW_LIMITS.spells),
  features: rows(FeatureRow, ROW_LIMITS.features),
  items: rows(ItemRow, ROW_LIMITS.items),
  notes: text(NOTES_MAX),
  slotsUsed: SlotsUsed,
  hitDiceUsed: HitDiceUsed,
};

/**
 * `creature-sheet` wire record = the `creature_sheet` row (CHARX §8.2) + `id` (= `entityId`: wire
 * records are keyed by `id`, like `wallet`). DM + owner only.
 */
export const CreatureSheetRecord = z
  .strictObject({
    id: z.string(),
    entityId: z.string(),
    campaignId: z.string(),
    /** Copy of the entity's owner; null for monsters (FR-CHARX-13). */
    ownerPlayerId: z.string().nullable(),
    ...sheetDataShape,
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .refine((r) => jsonBytes(r) <= SHEET_MAX_BYTES, { message: SHEET_FULL_MESSAGE });
export type CreatureSheetRecord = z.infer<typeof CreatureSheetRecord>;

export type SheetData = Omit<
  CreatureSheetRecord,
  "id" | "entityId" | "campaignId" | "ownerPlayerId" | "createdAt" | "updatedAt"
>;

/** FR-CHARX-02: a missing row = ready, unlocked, empty. */
export function defaultSheetData(): SheetData {
  return {
    status: "ready",
    locked: false,
    background: "",
    alignment: "",
    proficiencyNotes: { armor: "", weapons: "", tools: "", languages: "" },
    spells: [],
    features: [],
    items: [],
    notes: "",
    slotsUsed: {},
    hitDiceUsed: {},
  };
}

// ---------- intents (CHARX §9) ----------

export const CHARX_INTENTS = {
  create: "char.create",
  approve: "char.approve",
  setLock: "char.setLock",
  edit: "char.edit",
  putRow: "char.putRow",
  deleteRow: "char.deleteRow",
  moveRow: "char.moveRow",
  useResource: "char.useResource",
} as const;

/** `char.create` (FR-CHARX-08). Player: `{name}` only; DM: `ownerPlayerId` required. */
export const CharCreateIntent = z.strictObject({
  name: EntityName,
  ownerPlayerId: Id.optional(),
  draft: z.boolean().optional(),
});
export type CharCreateIntent = z.input<typeof CharCreateIntent>;
export const CharCreateResult = z.object({ characterId: z.string() });
export type CharCreateResult = z.infer<typeof CharCreateResult>;

export const CharApproveIntent = z.strictObject({ characterId: Id });
export type CharApproveIntent = z.input<typeof CharApproveIntent>;

export const CharSetLockIntent = z.strictObject({ characterId: Id, locked: z.boolean() });
export type CharSetLockIntent = z.input<typeof CharSetLockIntent>;

/**
 * `char.edit` `set` (FR-CHARX-15, CHARX §9): a strict partial of the scalar fields; each present
 * key replaces that field, `null` clears an optional one. Kind and role rules are the command's.
 */
export const CharEditSet = z.strictObject({
  name: EntityName.optional(),
  species: z.string().trim().max(40).nullable().optional(),
  background: z.string().trim().max(BACKGROUND_MAX).optional(),
  alignment: z.string().trim().max(BACKGROUND_MAX).optional(),
  classes: z.array(ClassRow).min(1).max(4).nullable().optional(),
  level: int(1, 20).optional(),
  className: z.string().trim().max(40).optional(),
  cr: Cr.optional(),
  ac: int(0, 30).optional(),
  hpMax: int(1, 999).optional(),
  initBonus: int(-10, 20).optional(),
  speed: Speed.nullable().optional(),
  abilities: Abilities.nullable().optional(),
  saveProficiencies: SaveProficiencies.nullable().optional(),
  skills: Skills.nullable().optional(),
  overrides: Overrides.nullable().optional(),
  proficiencyNotes: ProficiencyNotes.optional(),
  spellcasting: Spellcasting.nullable().optional(),
  notes: text(NOTES_MAX).optional(),
  ownerPlayerId: Id.optional(),
  size: Size.optional(),
  portraitAssetId: Id.nullable().optional(),
  /** FR-CHARX-49: whole object; absent `seesInvisible` = the stored value (FR-CHARX-53). */
  senses: Senses.optional(),
});
export type CharEditSet = z.input<typeof CharEditSet>;

/** Compile-time check: `set` keys = the event's `SHEET_EDIT_FIELDS`. */
type SetKeys = keyof z.infer<typeof CharEditSet>;
type FieldKeys = (typeof SHEET_EDIT_FIELDS)[number];
const _sameKeys: [SetKeys, FieldKeys] extends [FieldKeys, SetKeys] ? true : never = true;
void _sameKeys;

export const CharEditIntent = z.strictObject({
  creatureId: Id,
  set: CharEditSet.refine((s) => Object.keys(s).length > 0, { message: "Nothing to change" }),
});
export type CharEditIntent = z.input<typeof CharEditIntent>;

/** Keys of `set` that live where: entity columns, `creature-sheet`, else the stat block. */
export const ENTITY_FIELDS = ["name", "ownerPlayerId", "portraitAssetId"] as const;
export const SHEET_FIELDS = ["background", "alignment", "proficiencyNotes", "notes"] as const;
/** DM only (CHARX §9): player → `forbidden`. */
export const DM_ONLY_FIELDS = ["ownerPlayerId", "size", "portraitAssetId"] as const;
/** Character-only keys; a monster `set` with them → `invalid`. */
export const CHARACTER_ONLY_FIELDS = [
  "classes",
  "species",
  "level",
  "className",
  "ownerPlayerId",
] as const;

/**
 * `char.putRow` (FR-CHARX-16), row per list; no `id` → create. A feature's `used` is a counter
 * (`char.useResource`): accepted so a client may send the row it holds, never written here.
 */
export const CharPutRowIntent = z.discriminatedUnion("list", [
  z.strictObject({ creatureId: Id, list: z.literal("attacks"), row: Attack }),
  z.strictObject({
    creatureId: Id,
    list: z.literal("spells"),
    row: z.strictObject({ id: Id.optional(), ...spellFields }).superRefine(spellRules),
  }),
  z.strictObject({
    creatureId: Id,
    list: z.literal("features"),
    row: z.strictObject({
      id: Id.optional(),
      ...featureFields,
      used: int(0, FEATURE_USED_MAX).optional(),
    }),
  }),
  z.strictObject({
    creatureId: Id,
    list: z.literal("items"),
    row: z.strictObject({ id: Id.optional(), ...itemFields }),
  }),
]);
export type CharPutRowIntent = z.input<typeof CharPutRowIntent>;
export const CharPutRowResult = z.object({ rowId: z.string() });
export type CharPutRowResult = z.infer<typeof CharPutRowResult>;

export const CharDeleteRowIntent = z.strictObject({
  creatureId: Id,
  list: SheetRowList,
  rowId: Id,
});
export type CharDeleteRowIntent = z.input<typeof CharDeleteRowIntent>;

export const CharMoveRowIntent = z.strictObject({
  creatureId: Id,
  list: SheetRowList,
  rowId: Id,
  /** Clamped to the list (FR-CHARX-16). */
  toIndex: z.number().int().min(0).max(1000),
});
export type CharMoveRowIntent = z.input<typeof CharMoveRowIntent>;

/** `char.useResource` (FR-CHARX-17): exactly one of `delta` (−9…9, ≠ 0) and `reset: true`. */
export const CharUseResourceIntent = z
  .strictObject({
    characterId: Id,
    resource: SheetResource,
    delta: int(-9, 9)
      .refine((d) => d !== 0, "Amount must not be 0")
      .optional(),
    reset: z.literal(true).optional(),
  })
  .refine((v) => (v.delta === undefined) !== (v.reset === undefined), {
    message: "Send either delta or reset",
  });
export type CharUseResourceIntent = z.input<typeof CharUseResourceIntent>;
export const CharUseResourceResult = z.object({ before: z.int(), after: z.int() });
export type CharUseResourceResult = z.infer<typeof CharUseResourceResult>;
