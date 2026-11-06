// FR-CBT-179 / -180 (#457): the DM takes a combatant's last counted move back. Combat's token
// hook keeps the steps (`moveSteps`, hooks.ts); this command moves the token back through the
// map's own move path (guards, derive, hooks, one unlogged `TokenMoved`), passing `undoStep`, so
// the hook pops the step and its feet and the trail drops the step's cell.
import { CBT_INTENTS, UndoMoveInput } from "@shared/combat-tracker/schemas";
import { defineCommand } from "../../commands/commands";
import { conflict } from "../../commands/errors";
import { applyMove } from "../scenes-map/commands";
import { readToken } from "../scenes-map/rows";
import { tokenHooks } from "../scenes-map/token-hooks";
import { activeCombatant } from "./guards";

export const NOTHING_TO_UNDO = "No move to undo";
export const MOVE_CHANGED = "Something else moved — check Undo move";
export const MOVED_SINCE = "The token has moved since";

/**
 * FR-CBT-180: DM only; an active, not removed combatant of the started encounter (else
 * `not_found`). No step → `conflict` "No move to undo"; the last step ≠ `expectedStepId` →
 * `conflict`; its token no longer bound, gone, or not where the step left it → `conflict` "The
 * token has moved since" (nothing changes). Else the token goes back to the step's start cell.
 */
export const undoMoveCommand = defineCommand({
  name: CBT_INTENTS.undoMove,
  input: UndoMoveInput,
  execute({ combatantId, expectedStepId }, env): void {
    const { c } = activeCombatant(env, combatantId);
    const last = c.moveSteps?.at(-1);
    if (!last) throw conflict(NOTHING_TO_UNDO);
    if (last.id !== expectedStepId) throw conflict(MOVE_CHANGED);
    if (c.tokenId !== last.tokenId) throw conflict(MOVED_SINCE);
    const t = readToken(env.tx, last.tokenId);
    if (t.sceneId !== last.sceneId || t.col !== last.to.col || t.row !== last.to.row) {
      throw conflict(MOVED_SINCE);
    }
    applyMove({ tokenId: t.id, col: last.from.col, row: last.from.row }, env, tokenHooks, {
      undoStep: last.id,
    });
  },
});
