import { setConcentration } from "@server/features/combat-extras/effect-commands";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { ENTITY_TYPE } from "@shared/entities/schemas";

/**
 * Sprint 9 FX3 `fx-mira-bless` (BL-90, FR-CBTX-75; walkthrough FX3 step 5): Mira concentrates on
 * "Bless" with no duration (as player-1), beside `cp-combat`'s Thorn on "Conjure Elemental" with
 * his linked Fire Elemental 3. End then ends Thorn's (its summon named it) and keeps Mira's.
 */
export default defineFixture({
  key: "fx-mira-bless",
  kind: "setup",
  requires: ["cp-combat"],
  ownerSpec: "combat-extras",
  steps: [
    step(
      setConcentration,
      (r) => ({ target: { characterId: r.id("char-mira", ENTITY_TYPE) }, label: "Bless" }),
      { as: "player-1" },
    ),
  ],
});
