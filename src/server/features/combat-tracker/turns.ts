// Turns and rounds (FR-CBT-14, FR-CBT-31): `expected*` guards against double clicks / two tabs.
// Next resets the new turn combatant's `movedFt`; Prev keeps it (FR-CBT-40).
import { stepTurn } from "@shared/combat-tracker/rules";
import { CBT_INTENTS, TurnInput } from "@shared/combat-tracker/schemas";
import { TurnChanged } from "@shared/events/combat-tracker";
import { eq } from "drizzle-orm";
import { defineCommand } from "../../commands/commands";
import { conflict } from "../../commands/errors";
import { combatant, encounter } from "../../db/schema";
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

function turnCommand(direction: "next" | "prev") {
  return defineCommand({
    name: direction === "next" ? CBT_INTENTS.nextTurn : CBT_INTENTS.prevTurn,
    input: TurnInput,
    execute({ encounterId, expectedRound, expectedTurnId }, env): void {
      const cid = campaignOf(env.actor);
      const before = getEncounter(env.tx, cid, encounterId);
      if (before.status !== "started") throw conflict("Encounter is not running");
      if (before.round !== expectedRound || before.turnCombatantId !== expectedTurnId) {
        throw conflict("The turn has changed — try again");
      }
      const rows = combatantsOf(env.tx, encounterId);
      const step = stepTurn(rows, before.round, before.turnCombatantId, direction);
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
    },
  });
}

export const nextTurn = turnCommand("next");
export const prevTurn = turnCommand("prev");
