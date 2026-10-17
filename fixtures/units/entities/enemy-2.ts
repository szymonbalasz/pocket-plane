import { defineFixture } from "@server/features/fixtures-adapters/fixture-types";
import { wolf } from "../../srd/monster/wolf";
import { fixtureSource } from "../../srd/source";

/** ENT §13 (S4): the creature type (FR-ENT-26). */
const data = { ...wolf, statBlock: { ...wolf.statBlock, type: "beast" as const } };

/** SRD wolf, imported (global, read-only) (ENT §13). */
export default defineFixture({
  key: "enemy-2",
  kind: "reference",
  requires: [],
  ownerSpec: "entities",
  batch: { source: fixtureSource, records: [{ kind: "monster", sourceKey: "wolf", data }] },
});
