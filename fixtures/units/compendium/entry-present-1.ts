import { presentEntryByName } from "@server/features/compendium/present";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { CMP_IMAGES } from "./cmp-images";

/**
 * CMP §13 `entry-present-1` (#458): shows `cmp-images`' shared "Moonlit Lantern" (2 images) on
 * every player's screen (`cmp.presentEntryByName`, the fixtures-only form of `cmp.presentEntry`:
 * entries aren't records, so refs can't name them). One `entry-present` row per player; the popup
 * waits for each player's next connect.
 */
export default defineFixture({
  key: "entry-present-1",
  kind: "setup",
  requires: [CMP_IMAGES.key],
  ownerSpec: "compendium",
  steps: [step(presentEntryByName, { kind: "item" as const, name: CMP_IMAGES.lantern })],
});
