import { charCreate } from "@server/features/character-sheet/lifecycle";
import { attackCommand } from "@server/features/combat-tracker/attack";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { COMBATANT_TYPE } from "@shared/combat-tracker/schemas";
import { COMBAT_1 } from "../combat-tracker/combat-1";
import { miraCrossbowId } from "../combat-tracker/late-hit-ruled";

/**
 * Kit parity §13 K3 `kit-notices` (the kit's DM stack): as `player-2`, a draft character "Bram"
 * → the DM's pending card "Player 2 …" with Approve (FR-KIT-55–57: medallion, bold name, inline
 * action; `player-1`'s sheet stays on Mira); then as `player-1`, Mira's Light crossbow, manual
 * 17 / 6 → a pending damage card (its toast and the popup, FR-KIT-62–65; the player's card view
 * "Waiting for DM").
 */
export default defineFixture({
  key: "kit-notices",
  kind: "setup",
  requires: ["combat-1", "char-mira-full", "player-1", "player-2"],
  ownerSpec: "notifications",
  steps: [
    step(charCreate, () => ({ name: "Bram" }), { as: "player-2" }),
    step(
      attackCommand,
      (r) => ({
        attackerId: r.id("combat-1", COMBATANT_TYPE, COMBAT_1.mira),
        attackId: miraCrossbowId(),
        manual: [{ diceTotal: 17 }, { diceTotal: 6 }],
      }),
      { as: "player-1" },
    ),
  ],
});
