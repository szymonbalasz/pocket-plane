// Turns and rounds (FR-CBT-14, FR-CBT-31): `expected*` guards against double clicks / two tabs.
// Next resets the new turn combatant's `movedFt`; Prev keeps it (FR-CBT-40). Dead PCs skip
// (FR-CBTX-25); `turnChanged` rule hooks run after the event (FR-CBTX-01, ADR-0035).
import { DEATH_SAVES_MAX } from "@shared/combat-extras/schemas";
import { stepTurn } from "@shared/combat-tracker/rules";
import {
  CBT_INTENTS,
  type CombatantRecord,
  TurnInput,
  type TurnResult,
} from "@shared/combat-tracker/schemas";
import { TurnChanged } from "@shared/events/combat-tracker";
import { and, eq, gte, inArray } from "drizzle-orm";
import { type CommandEnv, defineCommand } from "../../commands/commands";
import { conflict } from "../../commands/errors";
import { combatant, encounter, entity } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { playerTurnOf } from "./ranks";
import {
  campaignOf,
  combatantChange,
  combatantsOf,
  encounterChange,
  getEncounter,
  readCombatant,
  readEncounter,
} from "./rows";
import { CombatRuleHooks } from "./rule-hooks";

/** FR-CBTX-25: PC combatants whose character is dead (3 failures); they skip like removed ones. */
export function deadPcs(env: Pick<CommandEnv, "tx">, rows: readonly CombatantRecord[]) {
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

export function turnCommand(direction: "next" | "prev", hooks: CombatRuleHooks) {
  return defineCommand({
    name: direction === "next" ? CBT_INTENTS.nextTurn : CBT_INTENTS.prevTurn,
    input: TurnInput,
    execute({ encounterId, expectedRound, expectedTurnId }, env): TurnResult {
      const cid = campaignOf(env.actor);
      const before = getEncounter(env.tx, cid, encounterId);
      if (before.status !== "started") throw conflict("Encounter is not running");
      if (before.round !== expectedRound || before.turnCombatantId !== expectedTurnId) {
        throw conflict("The turn has changed — try again");
      }
      const rows = combatantsOf(env.tx, encounterId);
      const dead = deadPcs(env, rows);
      const step = stepTurn(
        rows.map((r) => (dead.has(r.id) ? { ...r, removed: true } : r)),
        before.round,
        before.turnCombatantId,
        direction,
      );
      if (!step.ok) throw conflict(step.message);
      const playerTurn = playerTurnOf({ ...before, turnCombatantId: step.turnCombatantId }, rows);
      env.tx
        .update(encounter)
        .set({
          round: step.round,
          turnCombatantId: step.turnCombatantId,
          playerTurnCombatantId: playerTurn,
          updatedAt: env.ctx.clock.iso(),
        })
        .where(eq(encounter.id, encounterId))
        .run();
      const after = readEncounter(env.tx, encounterId);
      const changes: RecordChange[] = [encounterChange(before, after)];
      const turn = rows.find((r) => r.id === step.turnCombatantId);
      if (direction === "next" && turn && turn.movedFt !== 0) {
        env.tx.update(combatant).set({ movedFt: 0 }).where(eq(combatant.id, turn.id)).run();
        changes.push(combatantChange(turn, readCombatant(env.tx, turn.id)));
      }
      env.emit({
        type: TurnChanged.type,
        campaignId: cid,
        payload: { round: step.round, turnCombatantId: step.turnCombatantId, direction },
        changes,
      });
      // FR-CBTX-01: rule hooks after the event (their cards follow it); rows join its changes.
      const notRestored: string[] = [];
      changes.push(
        ...hooks.run("turnChanged", env, after, {
          direction,
          from: { round: before.round, turnCombatantId: before.turnCombatantId },
          to: { round: step.round, turnCombatantId: step.turnCombatantId },
          notRestored,
        }),
      );
      return { notRestored };
    },
  });
}

/** Name / type handles (fixture steps, tests); the server registers the hook-bound commands. */
export const nextTurn = turnCommand("next", new CombatRuleHooks([]));
export const prevTurn = turnCommand("prev", new CombatRuleHooks([]));
