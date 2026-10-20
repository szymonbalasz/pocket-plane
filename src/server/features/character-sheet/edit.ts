// `char.edit` (per-field merge, FR-CHARX-15) and the row intents `char.putRow` / `deleteRow` /
// `moveRow` (FR-CHARX-16). Stat-block fields go through entities' `updateIn` (names, clamp,
// definition-changed hooks: token / combatant copies, CHARX's owner copy + counter clamp); sheet
// fields and rows through `writeSheet`. One transaction, one `CharacterSheetEdited`.
import { featureUsedCap } from "@shared/character-sheet/counters";
import {
  CHARACTER_ONLY_FIELDS,
  CHARX_INTENTS,
  CharDeleteRowIntent,
  CharEditIntent,
  type CharEditSet,
  CharMoveRowIntent,
  CharPutRowIntent,
  type CharPutRowResult,
  type CreatureSheetRecord,
  DM_ONLY_FIELDS,
  ENTITY_FIELDS,
  type FeatureRow,
  type ItemRow,
  ROW_LIMITS,
  SHEET_FIELDS,
  type SpellRow,
} from "@shared/character-sheet/sheet";
import {
  type Attack,
  CARD_ATTACKS_MAX,
  type EntityRecord,
  isPet,
  kindRegistry,
  type Senses,
  type StatBlock,
  withAttackIds,
} from "@shared/entities/schemas";
import {
  CharacterSheetEdited,
  type SheetEditField,
  type SheetRowList,
} from "@shared/events/character-sheet";
import type { CommandEnv } from "../../commands/commands";
import { defineCommand } from "../../commands/commands";
import { conflict, forbidden, invalid, notFound } from "../../commands/errors";
import type { RecordChange } from "../../events/types";
import { followHpMax, updateIn } from "../entities/commands";
import type { DefinitionHooks } from "../entities/definition-hooks";
import { editableCreature, PET_OWNER_FIELDS, petOwnerEdit } from "./access";
import {
  getSheet,
  mergeChanges,
  newSheet,
  sameValue,
  sheetInvalid,
  writeSheet,
} from "./sheet-rows";

const ROW_DELETED = "Row was deleted";

type EntityPatch = {
  name?: string;
  ownerPlayerId?: string;
  portraitAssetId?: string | null;
  statBlock: Record<string, unknown>;
  hpCurrent?: number;
};

/**
 * The stat block and entity columns through `updateIn` (hooks included). Validates first so the
 * 12 KB cap reads "Sheet is full" (FR-CHARX-03) with paths under `set` / `row`.
 */
function writeEntity(
  env: CommandEnv,
  hooks: DefinitionHooks,
  c: EntityRecord,
  patch: EntityPatch,
  issuePrefix: string,
): RecordChange[] {
  const p = kindRegistry[c.kind].statBlock.safeParse(patch.statBlock);
  if (!p.success) sheetInvalid(p.error, [issuePrefix]);
  const { changes } = updateIn(
    env,
    c.id,
    {
      name: patch.name ?? c.name,
      portraitAssetId:
        patch.portraitAssetId === undefined ? c.portraitAssetId : patch.portraitAssetId,
      tokenShape: c.tokenShape,
      statBlock: patch.statBlock,
      ...(c.kind === "character" ? { ownerPlayerId: patch.ownerPlayerId ?? c.ownerPlayerId } : {}),
      // FR-ENT-33 (sprint 6): the whole replace keeps a pet a pet.
      ...(c.kind === "monster" ? { companionOf: c.companionOf, turnMode: c.turnMode } : {}),
      ...(patch.hpCurrent !== undefined ? { hpCurrent: patch.hpCurrent } : {}),
    },
    hooks,
  );
  return changes;
}

const nextId = (env: CommandEnv) => () => env.ctx.ids.next();

/** The sheet row (created by the first CHARX write, FR-CHARX-02) and its change. */
function ensureSheet(
  env: CommandEnv,
  c: EntityRecord,
  before: CreatureSheetRecord | null,
): { sheet: CreatureSheetRecord; change: RecordChange | null } {
  if (before) return { sheet: before, change: null };
  const sheet = newSheet(env, c);
  return { sheet, change: writeSheet(env, null, sheet) };
}

function emitEdited(
  env: CommandEnv,
  c: EntityRecord,
  payload:
    | { op: "set"; fields: SheetEditField[] }
    | {
        op: "putRow" | "deleteRow" | "moveRow";
        list: SheetRowList;
        rowId: string;
      },
  changes: (RecordChange | null)[],
) {
  env.emit({
    type: CharacterSheetEdited.type,
    campaignId: c.campaignId,
    payload: { creatureId: c.id, ...payload },
    changes: mergeChanges(changes),
  });
}

const isEntityField = (k: string) => (ENTITY_FIELDS as readonly string[]).includes(k);
const isSheetField = (k: string) => (SHEET_FIELDS as readonly string[]).includes(k);

/** FR-CHARX-15: role and kind rules on the keys of `set`. */
function checkKeys(env: CommandEnv, c: EntityRecord, keys: SheetEditField[]) {
  // FR-ENT-38 (#288): a pet's owner edits AC, HP max and speed only.
  if (petOwnerEdit(env, c)) {
    const other = keys.filter((k) => !(PET_OWNER_FIELDS as readonly string[]).includes(k));
    if (other.length) throw forbidden(`Only the DM can change ${other.join(", ")}`);
  }
  if (env.actor.role === "player") {
    const dmOnly = keys.filter((k) => (DM_ONLY_FIELDS as readonly string[]).includes(k));
    if (dmOnly.length) throw forbidden(`Only the DM can change ${dmOnly.join(", ")}`);
  }
  const wrongKind =
    c.kind === "monster"
      ? keys.filter((k) => (CHARACTER_ONLY_FIELDS as readonly string[]).includes(k))
      : keys.filter((k) => k === "cr");
  if (wrongKind.length) {
    throw invalid(
      c.kind === "monster" ? "Not a field of NPC definitions" : "Characters have no CR",
      wrongKind.map((k) => ({ path: ["set", k], message: "Not allowed for this creature" })),
    );
  }
}

export const SEES_INVISIBLE_DM_ONLY = "Only the DM can change Sees invisible";

/**
 * FR-CHARX-49 / -53: absent `seesInvisible` keeps the stored value; a player who changes it →
 * `forbidden`. Stored only when true (absent = false).
 */
function mergeSenses(env: CommandEnv, c: EntityRecord, next: Senses): Senses {
  const stored = c.statBlock.senses?.seesInvisible ?? false;
  const seesInvisible = next.seesInvisible ?? stored;
  if (env.actor.role === "player" && seesInvisible !== stored) {
    throw forbidden(SEES_INVISIBLE_DM_ONLY);
  }
  const { seesInvisible: _given, ...rest } = next;
  return seesInvisible ? { ...rest, seesInvisible } : rest;
}

export function charEditCommand(hooks: DefinitionHooks) {
  return defineCommand({
    name: CHARX_INTENTS.edit,
    input: CharEditIntent,
    roles: ["dm", "player"],
    execute(input, env): Record<string, never> {
      const { creature: c, sheet: sheetBefore } = editableCreature(env, input.creatureId);
      const set = { ...input.set } as Required<{ [K in keyof CharEditSet]: unknown }>;
      const keys = Object.keys(set) as SheetEditField[];
      checkKeys(env, c, keys);
      if (input.set.senses) set.senses = mergeSenses(env, c, input.set.senses);

      // Merge into the committed stat block: present keys replace, null clears (FR-CHARX-15).
      const block: Record<string, unknown> = { ...c.statBlock };
      for (const k of keys) {
        if (isEntityField(k) || isSheetField(k)) continue;
        if (set[k] === null) delete block[k];
        else block[k] = set[k];
      }
      if ((keys.includes("level") || keys.includes("className")) && block.classes !== undefined) {
        throw invalid("Level and class come from the class rows", [
          { path: ["set", keys.includes("level") ? "level" : "className"], message: "Set classes" },
        ]);
      }
      const entityBefore: Record<string, unknown> = {
        name: c.name,
        ownerPlayerId: c.ownerPlayerId,
        portraitAssetId: c.portraitAssetId,
      };
      const sheetValues = (sheetBefore ?? newSheet(env, c)) as unknown as Record<string, unknown>;
      const changed = keys.filter((k) => {
        if (isEntityField(k)) return !sameValue(entityBefore[k], set[k]);
        if (isSheetField(k)) return !sameValue(sheetValues[k], set[k]);
        return !sameValue((c.statBlock as Record<string, unknown>)[k], block[k]);
      });
      // Nothing changed → success, no event (FR-CHARX-15). Legacy attacks still without ids
      // get them on this write (FR-CHARX-16): the client sends a same-value `set` for that.
      const legacyAttacks = c.statBlock.attacks.some((a) => a.id === undefined);
      if (changed.length === 0 && !legacyAttacks) return {};
      if (changed.length === 0) changed.push(...keys.filter((k) => !isSheetField(k)));
      if (changed.length === 0) return {};

      // Entity first (owner, names, assets validated; hooks copy the owner into an existing sheet
      // row and clamp its counters), then the sheet fields on the row as the hooks left it.
      let entityChanges: RecordChange[] = [];
      let creature = c;
      if (changed.some((k) => !isSheetField(k))) {
        let hpCurrent: number | undefined;
        // FR-CHARX-15 HP rule: a draft follows HP max; full HP follows; else FR-ENT-11 clamps.
        if (c.kind === "character" && typeof set.hpMax === "number") {
          hpCurrent = followHpMax({ hpCurrent: c.hpCurrent, hpMax: c.statBlock.hpMax }, set.hpMax, {
            draft: sheetBefore?.status === "draft",
          });
        }
        // FR-ENT-38: a pet's kept HP follows the same rule (never a draft).
        if (isPet(c) && c.hpCurrent !== null && typeof set.hpMax === "number") {
          hpCurrent = followHpMax({ hpCurrent: c.hpCurrent, hpMax: c.statBlock.hpMax }, set.hpMax, {
            draft: false,
          });
        }
        entityChanges = writeEntity(
          env,
          hooks,
          c,
          {
            ...(typeof set.name === "string" ? { name: set.name } : {}),
            ...(typeof set.ownerPlayerId === "string" ? { ownerPlayerId: set.ownerPlayerId } : {}),
            ...(keys.includes("portraitAssetId")
              ? { portraitAssetId: set.portraitAssetId as string | null }
              : {}),
            statBlock: withAttackIds(block as { attacks: Attack[] }, nextId(env)),
            ...(hpCurrent !== undefined ? { hpCurrent } : {}),
          },
          "set",
        );
        creature = entityChanges[0]?.after as EntityRecord;
      }
      const current = getSheet(env.tx, c.id);
      const sheetNext: CreatureSheetRecord = { ...(current ?? newSheet(env, creature)) };
      for (const k of keys) if (isSheetField(k)) Object.assign(sheetNext, { [k]: set[k] });
      const sheetChange = writeSheet(env, current, sheetNext);
      emitEdited(env, c, { op: "set", fields: keys }, [...entityChanges, sheetChange]);
      return {};
    },
  });
}

type AnyRow = { id?: string };

/**
 * FR-ENT-38 (#288): a pet's owner writes attack rows only (`forbidden` otherwise), at most the
 * card's 8 so every row is on it; returns that cap, or null for anyone else.
 */
function petRowsOnly(env: CommandEnv, c: EntityRecord, list: SheetRowList): number | null {
  if (!petOwnerEdit(env, c)) return null;
  if (list !== "attacks") throw forbidden("Only the DM can change a pet's sheet");
  return CARD_ATTACKS_MAX;
}

/** Index of `id` in `rows`, else `not_found` "Row was deleted". */
function indexOf(rows: readonly { id?: string }[], id: string): number {
  const i = rows.findIndex((r) => r.id === id);
  if (i < 0) throw notFound(ROW_DELETED);
  return i;
}

function moved<T>(rows: readonly T[], from: number, to: number): T[] {
  const out = [...rows];
  const [row] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(to, out.length)), 0, row as T);
  return out;
}

type SheetList = Exclude<SheetRowList, "attacks">;

/** A row change on one list: attacks in the stat block, the rest on the sheet. */
function applyRows(
  env: CommandEnv,
  hooks: DefinitionHooks,
  c: EntityRecord,
  sheetBefore: CreatureSheetRecord | null,
  list: SheetRowList,
  fn: (rows: AnyRow[]) => AnyRow[],
): (RecordChange | null)[] {
  const ensured = ensureSheet(env, c, sheetBefore);
  if (list === "attacks") {
    const block = withAttackIds(c.statBlock as StatBlock, nextId(env));
    const attacks = fn(block.attacks) as Attack[];
    if (sameValue(attacks, c.statBlock.attacks)) return [ensured.change];
    return [
      ensured.change,
      ...writeEntity(env, hooks, c, { statBlock: { ...block, attacks } }, "row"),
    ];
  }
  const sheet = ensured.sheet;
  const rows = fn(sheet[list as SheetList]);
  const next = { ...sheet, [list]: rows } as CreatureSheetRecord;
  return [ensured.change, writeSheet(env, sheet, next)];
}

export function charPutRowCommand(hooks: DefinitionHooks) {
  return defineCommand({
    name: CHARX_INTENTS.putRow,
    input: CharPutRowIntent,
    roles: ["dm", "player"],
    execute(input, env): CharPutRowResult {
      const { creature: c, sheet } = editableCreature(env, input.creatureId);
      const list = input.list;
      const petCap = petRowsOnly(env, c, list);
      let rowId = input.row.id;
      const changes = applyRows(env, hooks, c, sheet, list, (rows) => {
        const existing = rowId === undefined ? undefined : rows[indexOf(rows, rowId)];
        const id = rowId ?? env.ctx.ids.next();
        rowId = id;
        let row: AnyRow;
        if (list === "features") {
          // `used` is a counter (FR-CHARX-17): kept, clamped to the new uses + 9 (FR-CHARX-58).
          const { used: _ignored, ...f } = input.row as FeatureRow;
          const prevUsed = (existing as FeatureRow | undefined)?.used ?? 0;
          const feature: FeatureRow = { ...f, id, used: Math.min(prevUsed, featureUsedCap(f)) };
          row = feature;
        } else {
          row = { ...(input.row as SpellRow | ItemRow | Attack), id };
        }
        if (existing) return rows.map((r) => (r.id === id ? row : r));
        if (petCap !== null && rows.length >= petCap) {
          throw conflict(`A pet's card holds ${petCap} attacks`);
        }
        if (rows.length >= ROW_LIMITS[list]) {
          throw conflict(`This list is full (${ROW_LIMITS[list]} rows)`);
        }
        return [...rows, row];
      });
      if (changes.some((ch) => ch !== null)) {
        emitEdited(env, c, { op: "putRow", list, rowId: rowId as string }, changes);
      }
      return { rowId: rowId as string };
    },
  });
}

export function charDeleteRowCommand(hooks: DefinitionHooks) {
  return defineCommand({
    name: CHARX_INTENTS.deleteRow,
    input: CharDeleteRowIntent,
    roles: ["dm", "player"],
    execute(input, env): Record<string, never> {
      const { creature: c, sheet } = editableCreature(env, input.creatureId);
      petRowsOnly(env, c, input.list);
      const changes = applyRows(env, hooks, c, sheet, input.list, (rows) => {
        indexOf(rows, input.rowId);
        return rows.filter((r) => r.id !== input.rowId);
      });
      emitEdited(env, c, { op: "deleteRow", list: input.list, rowId: input.rowId }, changes);
      return {};
    },
  });
}

export function charMoveRowCommand(hooks: DefinitionHooks) {
  return defineCommand({
    name: CHARX_INTENTS.moveRow,
    input: CharMoveRowIntent,
    roles: ["dm", "player"],
    execute(input, env): Record<string, never> {
      const { creature: c, sheet } = editableCreature(env, input.creatureId);
      // FR-ENT-38: a pet's owner adds, edits and deletes attack rows; moving them is the DM's.
      if (petOwnerEdit(env, c)) throw forbidden("Only the DM can reorder a pet's rows");
      const changes = applyRows(env, hooks, c, sheet, input.list, (rows) =>
        moved(rows, indexOf(rows, input.rowId), input.toIndex),
      );
      if (changes.some((ch) => ch !== null)) {
        emitEdited(env, c, { op: "moveRow", list: input.list, rowId: input.rowId }, changes);
      }
      return {};
    },
  });
}
