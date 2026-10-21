import { defineFixture } from "@server/features/fixtures-adapters/fixture-types";
import { goblin } from "../../srd/monster/goblin";
import { fixtureSource } from "../../srd/source";

/**
 * CMP §13 `cmp-goblin-untyped` (sprint 7, FU4, FR-CMP-58): a second fixture Goblin whose creature
 * core has no type (as a sprint-3 definition, FR-ENT-26), imported (global, read-only). Its
 * entryless Compendium row reads "CR 1/4 · Small" beside `enemy-1`'s typed "CR 1/4 · Small
 * humanoid"; `enemy-1` and `cmp-srd-mini-s3` stay as they are (rulings-b #19). Joins
 * session-sim-11.
 */
export default defineFixture({
  key: "cmp-goblin-untyped",
  kind: "reference",
  requires: [],
  ownerSpec: "compendium",
  batch: {
    source: fixtureSource,
    records: [
      {
        kind: "monster",
        sourceKey: "goblin-untyped",
        data: { ...goblin, name: "Goblin (untyped)" },
      },
    ],
  },
});
