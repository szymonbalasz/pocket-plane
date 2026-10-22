import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import type { FogEditInput } from "@shared/fog-of-war/schemas";
import { fog } from "../fog-of-war/commands";

/**
 * CBTX §13.1 `cb-fog-goblin` (sprint 8, CB0; joins session-sim-12): fog-of-war's `fog` helper (as
 * `fog-ambush-partial`) covers Goblin's cell (10, 6) on Goblin Ambush: a combatant the DM sees and
 * players don't (fog-hidden, FR-CBT-31 null on its turn), inside `cb-ties`' 12-tie.
 */
export default defineFixture({
  key: "cb-fog-goblin",
  kind: "setup",
  requires: ["cb-ties", "fog-ambush"],
  ownerSpec: "combat-extras",
  steps: [
    step(
      fog.edit,
      (r): FogEditInput => ({
        sceneId: r.id("battlemap", "scene"),
        op: "fog",
        shape: { kind: "rect", c0: 10, r0: 6, c1: 10, r1: 6 },
      }),
    ),
  ],
});
