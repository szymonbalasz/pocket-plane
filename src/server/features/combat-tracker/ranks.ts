// Server-written ranks and the player turn copy (FR-CBT-13, FR-CBT-31), plus the "every record
// whose value changed" diff each command lists in its event (FR-CBT-27).

import { DEATH_SAVES_MAX } from "@shared/combat-extras/schemas";
import { inTurnCompanionsOf, ownerRowOf, ranks } from "@shared/combat-tracker/rules";
import type { CombatantRecord, EncounterRecord } from "@shared/combat-tracker/schemas";
import { effectiveStats } from "@shared/entities/schemas";
import { and, eq, gte, inArray } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import type { Tx } from "../../db/client";
import { combatant, encounter, entity } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { combatantChange, combatantsOf, encounterChange, readEncounter, statBlocks } from "./rows";

type Env = Pick<CommandEnv, "tx" | "ctx">;
type Read = Pick<Tx, "select">;

/** FR-CBTX-25: PC combatants whose character is dead (3 failures); they skip like removed ones. */
export function deadPcs(env: { tx: Read }, rows: readonly CombatantRecord[]) {
  const pcIds = rows.filter((r) => r.kind === "pc").map((r) => r.entityId);
  if (pcIds.length === 0) return new Set<string>();
  const dead = new Set(
    env.tx
      .select({ id: entity.id })
      .from(entity)
      .where(and(inArray(entity.id, pcIds), gte(entity.deathFailures, DEATH_SAVES_MAX)))
      .all()
      .map((e) => e.id),
  );
  return new Set(rows.filter((r) => r.kind === "pc" && dead.has(r.entityId)).map((r) => r.id));
}

/**
 * Rewrites `position` / `playerPosition` of every row whose value changed (FR-CBT-13). Sprint 6
 * (FR-CBT-107 / -108 / -116): first copies each owner combatant's `hidden` onto its companions'
 * `ownerHidden`; ranks per turn mode with the owners' eligibility (removed, dead) and the turn
 * combatant (it keeps its rank until the turn moves on). Callers list `combatantDiff`.
 */
export function rerank(tx: Tx, encounterId: string): void {
  let rows = combatantsOf(tx, encounterId);
  for (const r of rows) {
    if (!r.ownerCharacterId) continue;
    const ownerHidden = ownerRowOf(rows, r)?.hidden ?? false;
    if (ownerHidden === r.ownerHidden) continue;
    tx.update(combatant).set({ ownerHidden }).where(eq(combatant.id, r.id)).run();
  }
  rows = combatantsOf(tx, encounterId);
  const blocks = statBlocks(
    tx,
    rows.map((r) => r.entityId),
  );
  const ineligible = new Set([
    ...rows.filter((r) => r.removed || !r.active).map((r) => r.id),
    ...deadPcs({ tx }, rows),
  ]);
  const next = ranks(
    rows.map((r) => {
      const b = blocks.get(r.entityId);
      return { ...r, initBonus: b ? effectiveStats(b).initBonus : 0 };
    }),
    { ineligible, turnCombatantId: readEncounter(tx, encounterId).turnCombatantId },
  );
  for (const r of rows) {
    const n = next.get(r.id);
    if (!n || (n.position === r.position && n.playerPosition === r.playerPosition)) continue;
    tx.update(combatant)
      // FR-CBT-107: no rank is stored as 0 (`toCombatantRecord` reads it as null).
      .set({ position: n.position ?? 0, playerPosition: n.playerPosition })
      .where(eq(combatant.id, r.id))
      .run();
  }
}

/**
 * FR-CBT-108 (sprint 6): whose turn starts with `turnCombatantId`: it and its `in-owner-turn`
 * companions (no rank of their own). Effects anchored to any of them end now (FR-CBTX-05) and
 * their `turnStart` triggers fire now (combat-extras' and effect-modifiers' rule hooks).
 */
export function turnStartersOf(
  tx: Read,
  encounterId: string,
  turnCombatantId: string | null,
): string[] {
  if (turnCombatantId === null) return [];
  const rows = combatantsOf(tx, encounterId);
  return [turnCombatantId, ...inTurnCompanionsOf(rows, turnCombatantId).map((c) => c.id)];
}

/**
 * The turn combatant if not hidden or removed, else null (FR-CBT-31); sprint 6 (FR-CBT-116): nor
 * a companion of a hidden owner.
 */
export function playerTurnOf(enc: EncounterRecord, rows: readonly CombatantRecord[]) {
  const t = rows.find((r) => r.id === enc.turnCombatantId);
  return t && !t.hidden && !t.ownerHidden && !t.removed && t.active ? t.id : null;
}

/** Writes `playerTurnCombatantId` if it changed; returns the encounter after. */
export function syncPlayerTurn(env: Env, encounterId: string): EncounterRecord {
  const enc = readEncounter(env.tx, encounterId);
  const want = playerTurnOf(enc, combatantsOf(env.tx, encounterId));
  if (want === enc.playerTurnCombatantId) return enc;
  env.tx
    .update(encounter)
    .set({ playerTurnCombatantId: want, updatedAt: env.ctx.clock.iso() })
    .where(eq(encounter.id, encounterId))
    .run();
  return readEncounter(env.tx, encounterId);
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Changes for every row of `before` that differs now (updates only). */
export function combatantDiff(tx: Tx, before: readonly CombatantRecord[]): RecordChange[] {
  const encounterIds = [...new Set(before.map((r) => r.encounterId))];
  const out: RecordChange[] = [];
  for (const eid of encounterIds) {
    const prev = new Map(before.filter((r) => r.encounterId === eid).map((r) => [r.id, r]));
    for (const now of combatantsOf(tx, eid)) {
      const b = prev.get(now.id);
      if (!b || same(b, now)) continue;
      out.push(combatantChange(b, now));
    }
  }
  return out;
}

/** Encounter change if the row differs. */
export function encounterDiff(before: EncounterRecord, after: EncounterRecord): RecordChange[] {
  return same(before, after) ? [] : [encounterChange(before, after)];
}
