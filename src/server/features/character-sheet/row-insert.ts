// CHARX internal row insert (CMP FR-CMP-27 / -28, CHARX §8.2): appends new rows to one sheet list
// inside the caller's transaction, with `char.putRow`'s authorisation (DM any campaign creature;
// the owner unless locked, FR-CHARX-12), ids from `ctx`, row limits and the sheet's own
// validation. One write, one `CharacterSheetEdited` (`putRow`, the first new row's id).
import {
  FeatureRow,
  ItemRow,
  ROW_LIMITS,
  SpellRow,
  type SpellRowInput,
} from "@shared/character-sheet/sheet";
import { CharacterSheetEdited } from "@shared/events/character-sheet";
import type { z } from "zod";
import type { CommandEnv } from "../../commands/commands";
import { conflict } from "../../commands/errors";
import { editableCreature } from "./access";
import { mergeChanges, newSheet, sheetInvalid, writeSheet } from "./sheet-rows";

type NoId<T> = Omit<T, "id">;
export type NewSheetRows =
  | { list: "spells"; rows: NoId<SpellRowInput>[] }
  | { list: "features"; rows: NoId<z.input<typeof FeatureRow>>[] }
  | { list: "items"; rows: NoId<z.input<typeof ItemRow>>[] };

const ROW_SCHEMA = { spells: SpellRow, features: FeatureRow, items: ItemRow } as const;

/**
 * Appends `rows` (≥ 1) to `creatureId`'s `list`. Throws as `char.putRow` would: `not_found` /
 * `forbidden` (incl. "Locked by the DM"), `conflict` on a full list, `invalid` for a bad row or a
 * full sheet. Returns the new row ids.
 */
export function insertSheetRows(
  env: CommandEnv,
  creatureId: string,
  add: NewSheetRows,
): { rowIds: string[] } {
  const { creature, sheet: before } = editableCreature(env, creatureId);
  const sheet = before ?? newSheet(env, creature);
  const { list } = add;
  const existing = sheet[list] as { id: string }[];
  if (existing.length + add.rows.length > ROW_LIMITS[list]) {
    throw conflict(`This list is full (${ROW_LIMITS[list]} rows)`);
  }
  const rowIds: string[] = [];
  const rows = add.rows.map((r, i) => {
    const id = env.ctx.ids.next();
    rowIds.push(id);
    const p = ROW_SCHEMA[list].safeParse({ ...r, id });
    if (!p.success) sheetInvalid(p.error, ["rows", i]);
    return p.data as { id: string };
  });
  const change = writeSheet(env, before, { ...sheet, [list]: [...existing, ...rows] });
  env.emit({
    type: CharacterSheetEdited.type,
    campaignId: creature.campaignId,
    payload: { creatureId: creature.id, op: "putRow", list, rowId: rowIds[0] as string },
    changes: mergeChanges([change]),
  });
  return { rowIds };
}
