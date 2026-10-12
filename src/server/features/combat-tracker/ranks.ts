// Server-written ranks and the player turn copy (FR-CBT-13, FR-CBT-31), plus the "every record
// whose value changed" diff each command lists in its event (FR-CBT-27).

import { ranks } from "@shared/combat-tracker/rules";
import type { CombatantRecord, EncounterRecord } from "@shared/combat-tracker/schemas";
import { effectiveStats } from "@shared/entities/schemas";
import { eq } from "drizzle-orm";
import type { CommandEnv } from "../../commands/commands";
import type { Tx } from "../../db/client";
import { combatant, encounter } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { combatantChange, combatantsOf, encounterChange, readEncounter, statBlocks } from "./rows";

type Env = Pick<CommandEnv, "tx" | "ctx">;

/** Rewrites `position` / `playerPosition` of every row whose value changed. */
export function rerank(tx: Tx, encounterId: string): void {
  const rows = combatantsOf(tx, encounterId);
  const blocks = statBlocks(
    tx,
    rows.map((r) => r.entityId),
  );
  const next = ranks(
    rows.map((r) => {
      const b = blocks.get(r.entityId);
      return { ...r, initBonus: b ? effectiveStats(b).initBonus : 0 };
    }),
  );
  for (const r of rows) {
    const n = next.get(r.id);
    if (!n || (n.position === r.position && n.playerPosition === r.playerPosition)) continue;
    tx.update(combatant)
      .set({ position: n.position, playerPosition: n.playerPosition })
      .where(eq(combatant.id, r.id))
      .run();
  }
}

/** The turn combatant if not hidden or removed, else null (FR-CBT-31). */
export function playerTurnOf(enc: EncounterRecord, rows: readonly CombatantRecord[]) {
  const t = rows.find((r) => r.id === enc.turnCombatantId);
  return t && !t.hidden && !t.removed && t.active ? t.id : null;
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
