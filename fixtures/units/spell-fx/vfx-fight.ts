import { createEncounter } from "@server/features/combat-tracker/encounters";
import { rollInitiative } from "@server/features/combat-tracker/initiative";
import { startCommand } from "@server/features/combat-tracker/lifecycle";
import { nextTurn } from "@server/features/combat-tracker/turns";
import { defineFixture, type Refs, step } from "@server/features/fixtures-adapters/fixture-types";
import { activateScene } from "@server/features/scenes-map/commands";
import { CBTX_INTENTS } from "@shared/combat-extras/intents";
import { COMBATANT_TYPE, ENCOUNTER_TYPE } from "@shared/combat-tracker/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";

/** Combatants of `vfx-fight` in `seq` order: party by name at Start, then the added goblin. */
export const VFX_FIGHT = { mira: 0, thorn: 1, sneak: 2 } as const;

const enc = (r: Refs) => r.id("vfx-fight", ENCOUNTER_TYPE);
export const vfxCombatant = (r: Refs, k: keyof typeof VFX_FIGHT) =>
  r.id("vfx-fight", COMBATANT_TYPE, VFX_FIGHT[k]);

/** Manual d20 (total − init bonus) so the order is exact. */
const roll = (k: keyof typeof VFX_FIGHT, d20: number) =>
  step(rollInitiative, (r) => ({ combatantIds: [vfxCombatant(r, k)], manual: { diceTotal: d20 } }));

/**
 * VFX §13 `vfx-fight`: Goblin Ambush goes live; "Spell FX" starts there with the party (Mira binds
 * her token at (2, 7), Thorn his at (2, 9)) and `mt-crowd`'s Goblin Sneak (4, 9) joins by token.
 * Initiative Mira 15, Goblin Sneak 12, Thorn 10; Next → round 1, Mira's turn.
 */
export default defineFixture({
  key: "vfx-fight",
  kind: "setup",
  requires: ["battlemap", "mt-crowd", "char-mira", "char-thorn"],
  ownerSpec: "spell-fx",
  steps: [
    step(activateScene, (r) => ({ sceneId: r.id("battlemap", "scene") })),
    step(createEncounter, (r) => ({
      name: "Spell FX",
      partyCharacterIds: [r.id("char-mira", ENTITY_TYPE), r.id("char-thorn", ENTITY_TYPE)],
      entries: [],
    })),
    step(startCommand, (r) => ({ encounterId: enc(r), sceneId: r.id("battlemap", "scene") })),
    {
      command: CBTX_INTENTS.addCombatants,
      input: (r: Refs) => ({
        encounterId: enc(r),
        items: [{ tokenId: r.id("mt-crowd", "token", 0) }],
      }),
    },
    roll("mira", 13),
    roll("sneak", 11),
    roll("thorn", 7),
    step(nextTurn, (r) => ({ encounterId: enc(r), expectedRound: 0, expectedTurnId: null })),
  ],
});
