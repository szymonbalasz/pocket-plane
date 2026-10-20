import { defineFixture } from "@server/features/fixtures-adapters/fixture-types";
import { fireElemental } from "../../srd/monster/fire-elemental";
import { owlbear } from "../../srd/monster/owlbear";
import { fixtureSource } from "../../srd/source";

/**
 * CBT §13.3 `cp-srd` (sprint 6, track CP): the SRD Owlbear (the pet's base) and Fire Elemental
 * (the summon), imported (global, read-only). Index 0 Owlbear, 1 Fire Elemental.
 */
export default defineFixture({
  key: "cp-srd",
  kind: "reference",
  requires: [],
  ownerSpec: "combat-tracker",
  batch: {
    source: fixtureSource,
    records: [
      { kind: "monster", sourceKey: "owlbear", data: owlbear },
      { kind: "monster", sourceKey: "fire-elemental", data: fireElemental },
    ],
  },
});
