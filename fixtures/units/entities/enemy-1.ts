import { defineFixture } from "@server/features/fixtures-adapters/fixture-types";
import { goblin } from "../../srd/monster/goblin";
import { fixtureSource } from "../../srd/source";

/** SRD goblin, imported (global, read-only) (ENT §13). */
export default defineFixture({
  key: "enemy-1",
  kind: "reference",
  requires: [],
  ownerSpec: "entities",
  batch: {
    source: fixtureSource,
    records: [{ kind: "monster", sourceKey: "goblin", data: goblin }],
  },
});
