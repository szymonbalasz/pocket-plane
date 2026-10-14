// `sheetAttack` (FR-CHARX-24, OQ-CHARX-12): the attack combat's `cbt.attack` rolls for a sheet
// row, built from committed data (stat block + `creature-sheet` spells) inside the caller's
// transaction. Combat owns who may attack; this only resolves the row.
import {
  resolveSheetAttack,
  type SheetAttack,
  type SheetAttackRef,
} from "@shared/character-sheet/logic";
import type { StatBlock } from "@shared/entities/schemas";
import { eq } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import { conflict, notFound } from "../../commands/errors";
import { entity } from "../../db/schema";
import { getSheet } from "./sheet-rows";

/**
 * `sheetAttack(env, creatureId, ref) → {name, toHit, damage, damageType}`. No ref = the first
 * attack. Unknown row → `not_found`; no attack, a spell without an attack roll or damage →
 * `conflict`. Imported definitions have no sheet (no spells).
 */
export function sheetAttack(
  env: Pick<CommandEnv, "tx">,
  creatureId: string,
  ref: SheetAttackRef,
): SheetAttack {
  const row = env.tx
    .select({ statBlock: entity.statBlock, campaignId: entity.campaignId })
    .from(entity)
    .where(eq(entity.id, creatureId))
    .get();
  if (!row) throw notFound("Creature not found");
  const sheet = row.campaignId === null ? null : getSheet(env.tx, creatureId);
  const res = resolveSheetAttack(row.statBlock as StatBlock, sheet, ref);
  if (!res.ok) throw res.code === "not_found" ? notFound(res.message) : conflict(res.message);
  return res.attack;
}
