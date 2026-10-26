import { nextTurn } from "@server/features/combat-tracker/turns";
import { defineFixture, type Refs, step } from "@server/features/fixtures-adapters/fixture-types";
import { COMBATANT_TYPE, ENCOUNTER_TYPE } from "@shared/combat-tracker/schemas";
import { COMBAT_1 } from "../combat-tracker/combat-1";

/** `combat-1`'s turn order: Wolf 18, Mira 15, Goblin 12, Goblin 2 12, Thorn 10, Elite 8. */
const ORDER = ["wolf", "mira", "goblin", "goblin2", "thorn", "elite"] as const;

const enc = (r: Refs) => r.id("encounter-1", ENCOUNTER_TYPE);
const who = (r: Refs, k: keyof typeof COMBAT_1) => r.id("combat-1", COMBATANT_TYPE, COMBAT_1[k]);

/**
 * Theme-system §13 walkthrough: `combat-1` (round 1, Wolf's turn) stepped on two full rounds with
 * Next, so Initiative shows round 3, Wolf's turn, 6 combatants. Steps turns: not in session-sim-13.
 */
export default defineFixture({
  key: "theme-round-3",
  kind: "setup",
  requires: ["combat-1"],
  ownerSpec: "theme-system",
  steps: [1, 2].flatMap((round) =>
    ORDER.map((k) =>
      step(nextTurn, (r) => ({
        encounterId: enc(r),
        expectedRound: round,
        expectedTurnId: who(r, k),
      })),
    ),
  ),
});
