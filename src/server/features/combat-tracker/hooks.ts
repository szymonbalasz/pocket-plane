// In-transaction hooks (no listener writes state): token-changed (FR-CBT-09, ADR-0028; moves
// FR-CBT-39, ADR-0031) and definition-changed (FR-CBT-06, FR-ENT-19). Both return the rows they
// changed for the caller's event and never emit.

import { MOVED_FT_MAX } from "@shared/combat-tracker/schemas";
import type { EntityRecord } from "@shared/entities/schemas";
import { distanceFt } from "@shared/scene-tools/geometry";
import type { TokenRecord } from "@shared/scenes-map/schemas";
import { and, eq } from "drizzle-orm";
import { conflict } from "../../commands/errors";
import { combatant } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import type { HookEnv } from "../entities/definition-hooks";
import { diagonalRuleOf } from "../scene-tools/rows";
import type { TokenHookEnv } from "../scenes-map/token-hooks";
import { tokenHiddenForPlayers } from "../scenes-map/visibility-hooks";
import { combatantDiff, encounterDiff, rerank, syncPlayerTurn } from "./ranks";
import {
  combatantChange,
  combatantsOf,
  readCombatant,
  readEncounter,
  toCombatantRecord,
} from "./rows";

export const TOKEN_IN_ENCOUNTER = "Token is in a running encounter";

/**
 * Token bound to an active combatant: a move → `movedFt` (FR-CBT-39); rename / image / hide /
 * reveal → its copies; if `hidden` changed, ranks and the player turn copy too. The hidden copy is
 * `tokenHiddenForPlayers` (hidden or fog-hidden, FR-FOG-14): fog commands, moves into / out of fog
 * and the size refresh flip it (FR-FOG-13). Delete →
 * `conflict`, unless every bound active combatant is removed (FR-CBT-68): their `tokenId` → null.
 * Tokens bound only to inactive combatants: nothing (the FK sets `tokenId` null on delete). May
 * run as a player (their own token's move): it never rejects a move (ADR-0031).
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
  if (after === null) {
    if (bound.some((c) => !c.removed)) throw conflict(TOKEN_IN_ENCOUNTER);
    // FR-CBT-68: a mistaken add is cleaned up with Remove + delete.
    for (const c of bound) {
      env.tx.update(combatant).set({ tokenId: null }).where(eq(combatant.id, c.id)).run();
    }
    return combatantDiff(env.tx, bound);
  }
  const out: RecordChange[] = [];
  // FR-SCN-30: the campaign's diagonal rule (`map-settings`, no row = 5/10/5). A move refused by a
  // move guard (FR-SCN-11) never reaches the hooks, so it adds nothing.
  const ft = distanceFt(before, after, diagonalRuleOf(env.tx, before.campaignId));
  const hidden = tokenHiddenForPlayers(after);
  for (const c of bound) {
    // FR-CBT-39: before the copy check (which skips on a move); removed combatants gain nothing.
    if (ft > 0 && !c.removed) {
      env.tx
        .update(combatant)
        .set({ movedFt: Math.min(MOVED_FT_MAX, c.movedFt + ft) })
        .where(eq(combatant.id, c.id))
        .run();
      const now = readCombatant(env.tx, c.id);
      if (now.movedFt !== c.movedFt) out.push(combatantChange(c, now));
    }
    if (c.name === after.name && c.imageAssetId === after.imageAssetId && c.hidden === hidden) {
      continue;
    }
    const rows = combatantsOf(env.tx, c.encounterId);
    const encBefore = readEncounter(env.tx, c.encounterId);
    env.tx
      .update(combatant)
      .set({ name: after.name, imageAssetId: after.imageAssetId, hidden })
      .where(eq(combatant.id, c.id))
      .run();
    if (c.hidden !== hidden) rerank(env.tx, c.encounterId);
    const encAfter = syncPlayerTurn(env, c.encounterId);
    out.push(...combatantDiff(env.tx, rows), ...encounterDiff(encBefore, encAfter));
  }
  return out;
}

/**
 * FR-CBT-06 / -67: active monster combatants of the definition whose `hpMax` equals the old
 * definition's (average HP) take the new `hpMax`; rolled ones keep theirs. `hpCurrent` = new max
 * if it equalled the old, else clamped. Active combatants of the definition still
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
  const oldMax = before.kind === "monster" ? before.statBlock.hpMax : null;
  const newMax = after.kind === "monster" ? after.statBlock.hpMax : null;
  for (const c of rows) {
    const set: Partial<typeof combatant.$inferInsert> = {};
    if (portraitChanged && c.imageAssetId === before.portraitAssetId) {
      set.imageAssetId = after.portraitAssetId;
    }
    if (c.kind === "monster" && newMax !== null && c.hpMax === oldMax && oldMax !== newMax) {
      set.hpMax = newMax;
      set.hpCurrent = c.hpCurrent === c.hpMax ? newMax : Math.min(c.hpCurrent ?? 0, newMax);
    }
    if (Object.keys(set).length > 0) {
      env.tx.update(combatant).set(set).where(eq(combatant.id, c.id)).run();
    }
  }
  return combatantDiff(env.tx, rows);
}
