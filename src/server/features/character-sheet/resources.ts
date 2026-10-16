// `char.useResource` (FR-CHARX-17): slot / hit die / feature-use counters as deltas, so DM and
// owner clicks both apply. Characters only; the owner also on a locked sheet. Also the feature-use
// seam other features spend through in their own transaction (MOD FR-MOD-12, -38, -41;
// OQ-MOD-32): `spendFeatureUse`, `refundFeatureUse`.
import { counterOf, nextUsed, withUsed } from "@shared/character-sheet/counters";
import {
  CHARX_INTENTS,
  CharUseResourceIntent,
  type CharUseResourceResult,
  type CreatureSheetRecord,
} from "@shared/character-sheet/sheet";
import { CharacterResourceUsed } from "@shared/events/character-sheet";
import { defineCommand } from "../../commands/commands";
import { notFound } from "../../commands/errors";
import type { RecordChange } from "../../events/types";
import { counterCharacter } from "./access";
import { getSheet, mergeChanges, type SheetEnv, sheetOrNew, writeSheet } from "./sheet-rows";

export const charUseResource = defineCommand({
  name: CHARX_INTENTS.useResource,
  input: CharUseResourceIntent,
  roles: ["dm", "player"],
  execute(input, env): CharUseResourceResult {
    const c = counterCharacter(env, input.characterId);
    const { before: row, sheet } = sheetOrNew(env, c);
    const counter = counterOf(sheet, c.statBlock, input.resource);
    if (!counter) throw notFound("Feature was deleted");
    const before = counter.used;
    const after = nextUsed(before, counter.max, input);
    // Unchanged (clamp, reset at 0) → success, no event.
    if (after === before) return { before, after };
    const change = writeSheet(env, row, { ...sheet, ...withUsed(sheet, input.resource, after) });
    env.emit({
      type: CharacterResourceUsed.type,
      campaignId: c.campaignId,
      payload: { characterId: c.id, resource: input.resource, before, after },
      changes: mergeChanges([change]),
    });
    return { before, after };
  },
});

/** A feature row's counter after a spend (FR-CHARX-17 bounds); `name` for the caller's messages. */
export type FeatureUseSpend =
  | { ok: true; name: string; before: number; after: number; change: RecordChange }
  /** `missing`: no sheet, no such row or no `usesMax` (a broken link); `none-left`: used = max. */
  | { ok: false; reason: "missing" }
  | { ok: false; reason: "none-left"; name: string; max: number };

function featureRow(env: SheetEnv, characterId: string, rowId: string) {
  const sheet = getSheet(env.tx, characterId);
  const f = sheet?.features.find((r) => r.id === rowId);
  return sheet && f && (f.usesMax ?? 0) > 0 ? { sheet, f, max: f.usesMax ?? 0 } : null;
}

function writeUsed(env: SheetEnv, sheet: CreatureSheetRecord, rowId: string, used: number) {
  return writeSheet(env, sheet, { ...sheet, ...withUsed(sheet, { feature: rowId }, used) });
}

/**
 * Spends one use of `characterId`'s feature row `rowId` in the caller's transaction (MOD
 * FR-MOD-12, -38). Opens no transaction and emits no event: the caller's event lists `change`;
 * authorisation is the caller's. Nothing is written unless `ok`.
 */
export function spendFeatureUse(
  env: SheetEnv,
  characterId: string,
  rowId: string,
): FeatureUseSpend {
  const row = featureRow(env, characterId, rowId);
  if (!row) return { ok: false, reason: "missing" };
  const { sheet, f, max } = row;
  if (f.used >= max) return { ok: false, reason: "none-left", name: f.name, max };
  const change = writeUsed(env, sheet, rowId, f.used + 1) as RecordChange;
  return { ok: true, name: f.name, before: f.used, after: f.used + 1, change };
}

/**
 * Gives one use back (MOD FR-MOD-41, undo): `used − 1`, clamped at 0. A missing row, no
 * `usesMax` or nothing used → no write, `null`. Same contract as {@link spendFeatureUse}.
 */
export function refundFeatureUse(
  env: SheetEnv,
  characterId: string,
  rowId: string,
): RecordChange | null {
  const row = featureRow(env, characterId, rowId);
  if (!row || row.f.used === 0) return null;
  return writeUsed(env, row.sheet, rowId, row.f.used - 1);
}
