// Turns and rounds (FR-CBT-14, FR-CBT-31): `expected*` guards against double clicks / two tabs.
import { stepTurn } from "@shared/combat-tracker/rules";
import { CBT_INTENTS, TurnInput } from "@shared/combat-tracker/schemas";
import { TurnChanged } from "@shared/events/combat-tracker";
import { eq } from "drizzle-orm";
import { defineCommand } from "../../commands/commands";
import { conflict } from "../../commands/errors";
import { encounter } from "../../db/schema";
import { playerTurnOf } from "./ranks";
import { campaignOf, combatantsOf, encounterChange, getEncounter, readEncounter } from "./rows";

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
      env.emit({
        type: TurnChanged.type,
        campaignId: cid,
        payload: { round: step.round, turnCombatantId: step.turnCombatantId, direction },
        changes: [encounterChange(before, after)],
      });
    },
  });
}

export const nextTurn = turnCommand("next");
export const prevTurn = turnCommand("prev");
