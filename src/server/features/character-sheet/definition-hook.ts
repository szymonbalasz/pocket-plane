// CHARX's definition-changed hook (FR-CHARX-13, FR-CHARX-17, FR-ENT-19): runs inside every
// entity update (`PUT /api/entities`, `char.edit`, row intents). Keeps the `creature-sheet`
// owner copy equal to the entity's and clamps slot / hit-dice counters to lowered maxima. A
// creature without a sheet row is left alone (missing row = defaults).
import { clampCounters } from "@shared/character-sheet/counters";
import type { EntityRecord } from "@shared/entities/schemas";
import type { RecordChange } from "../../events/types";
import type { HookEnv } from "../entities/definition-hooks";
import { getSheet, writeSheet } from "./sheet-rows";

export function creatureSheetDefinitionHook(
  env: HookEnv,
  _before: EntityRecord,
  after: EntityRecord,
): RecordChange[] {
  const sheet = getSheet(env.tx, after.id);
  if (!sheet) return [];
  const change = writeSheet(env, sheet, {
    ...sheet,
    ownerPlayerId: after.kind === "character" ? after.ownerPlayerId : null,
    ...clampCounters(sheet, after.statBlock),
  });
  return change ? [change] : [];
}
