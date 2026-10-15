import { rollInitiative } from "@server/features/combat-tracker/initiative";
import { startCommand } from "@server/features/combat-tracker/lifecycle";
import { nextTurn } from "@server/features/combat-tracker/turns";
import { defineFixture, type Refs, step } from "@server/features/fixtures-adapters/fixture-types";
import { COMBATANT_TYPE, ENCOUNTER_TYPE } from "@shared/combat-tracker/schemas";

/** Combatants in `seq` order after Start: party by name, then entries × quantity. */
export const COMBAT_1 = { mira: 0, thorn: 1, goblin: 2, goblin2: 3, wolf: 4, elite: 5 } as const;

const enc = (r: Refs) => r.id("encounter-1", ENCOUNTER_TYPE);
const who = (r: Refs, k: keyof typeof COMBAT_1) => r.id("combat-1", COMBATANT_TYPE, COMBAT_1[k]);

/** Manual d20 (total − init bonus) so the order is exact. */
const roll = (k: keyof typeof COMBAT_1, d20: number) =>
  step(rollInitiative, (r) => ({ combatantIds: [who(r, k)], manual: { diceTotal: d20 } }));

/**
 * CBT §13 `combat-1`: Start "Ambush at the Ford" on Goblin Ambush; initiative Wolf 18, Mira 15,
 * Goblin 12, Goblin 2 12, Thorn 10, Elite 8; Next → round 1, Wolf's turn. Sprint 2 (FR-CBT-64):
 * Start already rolls monster initiative (seeded, DM-only entries); the manual rolls below
 * overwrite it in round 0. Every monster binds a placed token, so Start creates none.
 */
export default defineFixture({
  key: "combat-1",
  kind: "setup",
  requires: ["encounter-1", "goblin-2", "thorn-battlemap"],
  ownerSpec: "combat-tracker",
  steps: [
    step(startCommand, (r) => ({ encounterId: enc(r), sceneId: r.id("battlemap", "scene") })),
    roll("wolf", 16),
    roll("mira", 13),
    roll("goblin", 10),
    roll("goblin2", 10),
    roll("thorn", 7),
    roll("elite", 6),
    step(nextTurn, (r) => ({ encounterId: enc(r), expectedRound: 0, expectedTurnId: null })),
  ],
});
