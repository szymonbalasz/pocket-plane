// In-transaction hooks (no listener writes state): token-changed (FR-CBT-09, ADR-0028) and
// definition-changed (FR-CBT-06, FR-ENT-19). Both return the rows they changed for the caller's
// event and never emit.
import type { EntityRecord } from "@shared/entities/schemas";
import type { TokenRecord } from "@shared/scenes-map/schemas";
import { and, eq } from "drizzle-orm";
import { conflict } from "../../commands/errors";
import { combatant } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import type { HookEnv } from "../entities/definition-hooks";
import type { TokenHookEnv } from "../scenes-map/token-hooks";
import { combatantDiff, encounterDiff, rerank, syncPlayerTurn } from "./ranks";
import { combatantsOf, readEncounter, toCombatantRecord } from "./rows";

export const TOKEN_IN_ENCOUNTER = "Token is in a running encounter";

/**
 * Token bound to an active combatant: rename / image / hide / reveal → its copies; if `hidden`
 * changed, ranks and the player turn copy too. Delete → `conflict`. Tokens bound only to
 * inactive combatants: nothing (the FK sets `tokenId` null on delete).
 */
export function combatantTokenHook(
  env: TokenHookEnv,
  before: TokenRecord,
  after: TokenRecord | null,
): RecordChange[] {
  const bound = env.tx
    .select()
    .from(combatant)
    .where(
      and(
        eq(combatant.tokenId, before.id),
        eq(combatant.campaignId, before.campaignId),
        eq(combatant.active, true),
      ),
    )
    .all()
    .map(toCombatantRecord);
  if (bound.length === 0) return [];
  if (after === null) throw conflict(TOKEN_IN_ENCOUNTER);
  const out: RecordChange[] = [];
  for (const c of bound) {
    if (
      c.name === after.name &&
      c.imageAssetId === after.imageAssetId &&
      c.hidden === after.hidden
    ) {
      continue;
    }
    const rows = combatantsOf(env.tx, c.encounterId);
    const encBefore = readEncounter(env.tx, c.encounterId);
    env.tx
      .update(combatant)
      .set({ name: after.name, imageAssetId: after.imageAssetId, hidden: after.hidden })
      .where(eq(combatant.id, c.id))
      .run();
    if (c.hidden !== after.hidden) rerank(env.tx, c.encounterId);
    const encAfter = syncPlayerTurn(env, c.encounterId);
    out.push(...combatantDiff(env.tx, rows), ...encounterDiff(encBefore, encAfter));
  }
  return out;
}

/**
 * FR-CBT-06: active monster combatants of the definition take the new `hpMax`; `hpCurrent` =
 * new max if it equalled the old, else clamped. Active combatants of the definition still
 * showing the old portrait take the new one (gate I23).
 */
export function combatantDefinitionHook(
  env: HookEnv,
  before: EntityRecord,
  after: EntityRecord,
): RecordChange[] {
  const rows = env.tx
    .select()
    .from(combatant)
    .where(and(eq(combatant.entityId, after.id), eq(combatant.active, true)))
    .all()
    .map(toCombatantRecord);
  if (rows.length === 0) return [];
  const portraitChanged = before.portraitAssetId !== after.portraitAssetId;
  const newMax = after.kind === "monster" ? after.statBlock.hpMax : null;
  for (const c of rows) {
    const set: Partial<typeof combatant.$inferInsert> = {};
    if (portraitChanged && c.imageAssetId === before.portraitAssetId) {
      set.imageAssetId = after.portraitAssetId;
    }
    if (c.kind === "monster" && newMax !== null && c.hpMax !== null && c.hpMax !== newMax) {
      set.hpMax = newMax;
      set.hpCurrent = c.hpCurrent === c.hpMax ? newMax : Math.min(c.hpCurrent ?? 0, newMax);
    }
    if (Object.keys(set).length > 0) {
      env.tx.update(combatant).set(set).where(eq(combatant.id, c.id)).run();
    }
  }
  return combatantDiff(env.tx, rows);
}
