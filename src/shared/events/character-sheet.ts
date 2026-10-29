// Domain events of character-sheet (CHAR §9, protocol §22) and character-sheet-full (CHARX §9,
// protocol §31). All logged; none undoable (FR-CHARX-19). Shared definitions (fix/combat-core,
// fix/charx-core); character-sheet emits them.
import { DeathCounters } from "@shared/combat-extras/schemas";
import { Ability, HitDie, SkillName } from "@shared/entities/schemas";
import { z } from "zod";
import { RollMode } from "./dice-roll-log";
import { defineEvent } from "./types";

const Id = z.string().min(1).max(64);

/**
 * `char.adjustHp`: changes = `entity` upsert. Not a combat log entry (#139 P5). Through
 * combat-extras' `hpRules` it also reports temp HP, death counters (null = unchanged) and the
 * concentration cards it created (FR-CBTX-02, -21); optional, absent before CBTX.
 */
export const CharacterHpAdjusted = defineEvent({
  type: "CharacterHpAdjusted",
  payload: z
    .object({
      entityId: z.string(),
      delta: z.number().int(),
      hpBefore: z.number().int(),
      hpAfter: z.number().int(),
      tempBefore: z.number().int().optional(),
      tempAfter: z.number().int().optional(),
      deathBefore: DeathCounters.nullable().optional(),
      deathAfter: DeathCounters.nullable().optional(),
      noteIds: z.array(Id).optional(),
    })
    .strict(),
  logged: true,
  undoable: false,
});

/** `char.roll` kinds: CHAR's four + CHARX's (FR-CHARX-20) + to-hit only (FR-CHARX-42, N7). */
export const CHARACTER_ROLL_KINDS = [
  "initiative",
  "attack",
  "check",
  "save",
  "skill",
  "damage",
  "spellAttack",
  "spellDamage",
  "toHit",
  "spellToHit",
] as const;

/** `char.roll`: changes = `game-log-entry` upsert (#67: not undoable). */
export const CharacterRolled = defineEvent({
  type: "CharacterRolled",
  payload: z
    .object({
      characterId: z.string(),
      kind: z.enum(CHARACTER_ROLL_KINDS),
      /** Check / save only (FR-CHAR-21). */
      ability: Ability.optional(),
      /** Kind `skill` only (FR-CHARX-20). */
      skill: SkillName.optional(),
      /** Attack row of `attack` / `damage` / `toHit` (FR-CHARX-20, -42); absent = the first. */
      attackId: Id.optional(),
      /** Spell row of `spellAttack` / `spellDamage` / `spellToHit` (FR-CHARX-20, -42). */
      spellId: Id.optional(),
      mode: RollMode,
      manual: z.boolean(),
      attackName: z.string().optional(),
      damageType: z.string().optional(),
      rollIds: z.array(z.string()).min(1),
      entryId: z.string(),
    })
    .strict()
    .refine(
      (p) =>
        (p.ability === undefined || p.kind === "check" || p.kind === "save") &&
        (p.skill !== undefined) === (p.kind === "skill") &&
        (p.attackId === undefined ||
          p.kind === "attack" ||
          p.kind === "damage" ||
          p.kind === "toHit") &&
        (p.spellId !== undefined) ===
          (p.kind === "spellAttack" || p.kind === "spellDamage" || p.kind === "spellToHit"),
      { message: "Roll reference does not match the kind" },
    ),
  logged: true,
  undoable: false,
});

// ---------- character-sheet-full (CHARX §9) ----------

export const SHEET_STATUSES = ["draft", "ready"] as const;
export const SheetStatus = z.enum(SHEET_STATUSES);
export type SheetStatus = z.infer<typeof SheetStatus>;

/** `char.edit` `set` keys (CHARX §9); the event lists keys, never values. */
export const SHEET_EDIT_FIELDS = [
  "name",
  "species",
  "background",
  "alignment",
  "classes",
  "level",
  "className",
  "cr",
  "ac",
  "hpMax",
  "initBonus",
  "speed",
  "abilities",
  "saveProficiencies",
  "skills",
  "overrides",
  "proficiencyNotes",
  "spellcasting",
  "notes",
  "ownerPlayerId",
  "size",
  "portraitAssetId",
  "senses",
  "tokenShape",
] as const;
export const SheetEditField = z.enum(SHEET_EDIT_FIELDS);
export type SheetEditField = z.infer<typeof SheetEditField>;

/** Row lists of `char.putRow` / `deleteRow` / `moveRow` (FR-CHARX-16). */
export const SHEET_ROW_LISTS = ["attacks", "spells", "features", "items"] as const;
export const SheetRowList = z.enum(SHEET_ROW_LISTS);
export type SheetRowList = z.infer<typeof SheetRowList>;

/** `char.useResource` counter (FR-CHARX-17): a slot level, a hit die size or a feature row. */
export const SheetResource = z.union([
  z.strictObject({ slot: z.number().int().min(1).max(9) }),
  z.strictObject({ hitDie: HitDie }),
  z.strictObject({ feature: Id }),
]);
export type SheetResource = z.infer<typeof SheetResource>;

/** A rest (`char.rest`, FR-CHARX-121) and the rest a feature row's uses come back on. */
export const REST_KINDS = ["short", "long"] as const;
export const RestKind = z.enum(REST_KINDS);
export type RestKind = z.infer<typeof RestKind>;

/** `char.create` (FR-CHARX-08): changes = `entity` + `creature-sheet` upserts. */
export const CharacterCreated = defineEvent({
  type: "CharacterCreated",
  payload: z.strictObject({ characterId: Id, ownerPlayerId: Id, status: SheetStatus }),
  logged: true,
  undoable: false,
});

/** `char.approve` draft → ready (FR-CHARX-10): changes = `creature-sheet` upsert. */
export const CharacterApproved = defineEvent({
  type: "CharacterApproved",
  payload: z.strictObject({ characterId: Id }),
  logged: true,
  undoable: false,
});

/** `char.setLock` (FR-CHARX-12): changes = `creature-sheet` upsert. */
export const CharacterLockSet = defineEvent({
  type: "CharacterLockSet",
  payload: z.strictObject({ characterId: Id, locked: z.boolean() }),
  logged: true,
  undoable: false,
});

/**
 * `char.edit` (`op: set`, `fields` = the keys sent) and the row intents (`list` + `rowId`)
 * (FR-CHARX-15/16). Keys and ids, never values. Changes = `entity` and / or `creature-sheet` +
 * hook-changed instances.
 */
export const CharacterSheetEdited = defineEvent({
  type: "CharacterSheetEdited",
  payload: z
    .strictObject({
      creatureId: Id,
      op: z.enum(["set", "putRow", "deleteRow", "moveRow"]),
      fields: z.array(SheetEditField).min(1).max(SHEET_EDIT_FIELDS.length).optional(),
      list: SheetRowList.optional(),
      rowId: Id.optional(),
    })
    .refine(
      (p) =>
        p.op === "set"
          ? p.fields !== undefined && p.list === undefined && p.rowId === undefined
          : p.fields === undefined && p.list !== undefined && p.rowId !== undefined,
      { message: "set lists fields; row ops list list + rowId" },
    ),
  logged: true,
  undoable: false,
});

/** `char.useResource` (FR-CHARX-17): changes = `creature-sheet` upsert. */
export const CharacterResourceUsed = defineEvent({
  type: "CharacterResourceUsed",
  payload: z.strictObject({
    characterId: Id,
    resource: SheetResource,
    before: z.number().int().min(0),
    after: z.number().int().min(0),
  }),
  logged: true,
  undoable: false,
});

/**
 * `char.rest` (FR-CHARX-121), one per character something changed for: changes = its
 * `creature-sheet` and / or `entity` upserts + its `char.rest` `game-log-entry` (`entryId`).
 */
export const CharacterRested = defineEvent({
  type: "CharacterRested",
  payload: z.strictObject({ characterId: Id, kind: RestKind, entryId: Id }),
  logged: true,
  undoable: false,
});
