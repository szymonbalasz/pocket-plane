import { seededContext } from "@server/commands/context";
import { attackCommand } from "@server/features/combat-tracker/attack";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { entityOf, putRowStep } from "../character-sheet-full/steps";
import { vfxCombatant } from "./vfx-fight";

const KEY = "fire-card";

/**
 * The Fire Bolt row's id: the first id this fixture's seeded stream draws (its first step creates
 * the row; fixture steps see records, not sheet rows). `spell-fx.fixtures.test` pins it.
 */
export const fireBoltRowId = () => seededContext({ disposable: true, key: KEY }).ids.next();

/**
 * VFX §13 `fire-card`: Mira gets the cantrip row **Fire Bolt** (attack, 1d10 fire) and attacks
 * with it as `player-1` (manual 15 to hit, 7 fire): a pending damage card for the DM to apply to
 * Goblin Sneak (the player's card: its outcome lines are public).
 */
export default defineFixture({
  key: KEY,
  kind: "setup",
  requires: ["vfx-fight", "sg-row"],
  ownerSpec: "spell-fx",
  steps: [
    putRowStep((r) => ({
      creatureId: entityOf(r, "char-mira"),
      list: "spells",
      row: { name: "Fire Bolt", level: 0, roll: "attack", damage: "1d10", damageType: "fire" },
    })),
    step(
      attackCommand,
      (r) => ({
        attackerId: vfxCombatant(r, "mira"),
        spellId: fireBoltRowId(),
        manual: [{ diceTotal: 15 }, { diceTotal: 7 }],
      }),
      { as: "player-1" },
    ),
  ],
});
