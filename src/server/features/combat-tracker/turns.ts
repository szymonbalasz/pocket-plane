// Turns and rounds (FR-CBT-14, FR-CBT-31): `expected*` guards against double clicks / two tabs.
// Next resets the new turn combatant's `movedFt`; Prev keeps it (FR-CBT-40). Start round 1 resets
// everyone's: round-0 positioning never counts (FR-CBT-39, BL-03). Dead PCs skip
// (FR-CBTX-25); `turnChanged` rule hooks run after the event (FR-CBTX-01, ADR-0035).
import { inTurnCompanionsOf, stepTurn } from "@shared/combat-tracker/rules";
import { CBT_INTENTS, TurnInput, type TurnResult } from "@shared/combat-tracker/schemas";
import { TurnChanged } from "@shared/events/combat-tracker";
import { eq } from "drizzle-orm";
import { defineCommand } from "../../commands/commands";
import { conflict } from "../../commands/errors";
import { combatant, encounter } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { clearTrails } from "../scenes-map/trail";
import { combatantDiff, deadPcs, playerTurnOf, rerank } from "./ranks";
import { campaignOf, combatantsOf, encounterChange, getEncounter, readEncounter } from "./rows";
import { CombatRuleHooks } from "./rule-hooks";

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
      const rows0 = combatantsOf(env.tx, encounterId);
      // FR-CBT-108 (sprint 6): fresh ranks first, so an owner who died since the last rerank no
      // longer holds its in-turn companions (they take their own turn in its slot).
      rerank(env.tx, encounterId);
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
      // FR-CBT-108: a companion that kept its rank only as the turn combatant (its owner was
      // restored) goes back inside the owner's turn now that the turn moved on.
      rerank(env.tx, encounterId);
      const after = readEncounter(env.tx, encounterId);
      const changes: RecordChange[] = [encounterChange(before, after)];
      // FR-CBT-40: the new turn combatant and (FR-CBT-108) its in-turn companions; on Start
      // round 1 everyone (BL-03).
      const ranked = combatantsOf(env.tx, encounterId);
      const turnIds = new Set([
        step.turnCombatantId,
        ...inTurnCompanionsOf(ranked, step.turnCombatantId).map((c) => c.id),
      ]);
      const reset =
        direction !== "next"
          ? []
          : before.round === 0
            ? ranked
            : ranked.filter((r) => turnIds.has(r.id));
      for (const r of reset) {
        if (r.movedFt === 0) continue;
        env.tx.update(combatant).set({ movedFt: 0 }).where(eq(combatant.id, r.id)).run();
      }
      changes.push(...combatantDiff(env.tx, rows0));
      // FR-CBT-97 (sprint 5): every turn change (Next, Prev, Start round 1) clears the trails.
      if (after.sceneId) changes.push(...clearTrails(env, after.sceneId));
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
