// `every: {feature}` charges (FR-MOD-38, -41, -42): one use of a character's sheet feature row,
// spent by an apply and refunded by its undo, through CHARX's counter helpers and `writeSheet`
// (the same path as `char.useResource`). Interim until CHARX's `spendFeatureUse` /
// `refundFeatureUse` (R3) land on `main`; then these delegate to them.
import { counterOf, withUsed } from "@shared/character-sheet/counters";
import { eq } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import { entity } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { sheetOrNew, writeSheet } from "../character-sheet/sheet-rows";
import { toEntityRecord } from "../entities/rows";

/** Moves the row's `used` by `delta` (clamped 0…uses); the `creature-sheet` change, if any. */
function moveUse(
  env: CommandEnv,
  characterId: string,
  featureId: string,
  delta: 1 | -1,
): RecordChange | null {
  const row = env.tx.select().from(entity).where(eq(entity.id, characterId)).get();
  if (!row) return null;
  const creature = toEntityRecord(row);
  if (creature.kind !== "character") return null;
  const { before, sheet } = sheetOrNew(env, creature);
  const resource = { feature: featureId };
  const counter = counterOf(sheet, creature.statBlock, resource);
  if (!counter || counter.max === 0) return null;
  const used = Math.max(0, Math.min(counter.max, counter.used + delta));
  if (used === counter.used) return null;
  return writeSheet(env, before, { ...sheet, ...withUsed(sheet, resource, used) });
}

/** Spends one use (the caller checked one is left). */
export const spendFeatureUse = (env: CommandEnv, characterId: string, featureId: string) =>
  moveUse(env, characterId, featureId, 1);

/** Gives one use back (undo, FR-MOD-41). */
export const refundFeatureUse = (env: CommandEnv, characterId: string, featureId: string) =>
  moveUse(env, characterId, featureId, -1);
