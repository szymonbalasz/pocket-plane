import { setCategoryPublic } from "@server/features/dice-roll-log/settings";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";

/** Public log settings: attack, damage, initiative, healing public (DICE §13). */
export default defineFixture({
  key: "dice-settings",
  kind: "setup",
  requires: ["campaign"],
  ownerSpec: "dice-roll-log",
  steps: (["attack", "damage", "initiative", "healing"] as const).map((category) =>
    step(setCategoryPublic, { category, public: true }),
  ),
});
