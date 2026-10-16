import { activateCampaign } from "@server/features/campaign-management/commands";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { addItem, createHandout, shareHandout } from "@server/features/party-board/commands";
import { HANDOUT_TYPE, type SharedWith } from "@shared/party-board/schemas";

const ALL: SharedWith = { mode: "all", playerIds: [] };

/** Markers the scope leak scans look for (PARTY §13). */
export const SECOND_HANDOUT_TITLE = "SECOND-CAMPAIGN-HANDOUT";
export const SECOND_ITEM_NAME = "SECOND-CAMPAIGN-ITEM";

/**
 * PARTY §13 `party-second`: in the Second Campaign a handout shared with all and one party item;
 * then the Fixture Campaign is active again.
 */
export default defineFixture({
  key: "party-second",
  kind: "setup",
  requires: ["campaign-second"],
  ownerSpec: "party-board",
  steps: [
    step(activateCampaign, (r) => ({ id: r.id("campaign-second", "campaign") })),
    step(createHandout, {
      title: SECOND_HANDOUT_TITLE,
      body: `${SECOND_HANDOUT_TITLE} body`,
      imageAssetIds: [],
    }),
    step(shareHandout, (r) => ({
      handoutId: r.id("party-second", HANDOUT_TYPE),
      sharedWith: ALL,
    })),
    step(addItem, { name: SECOND_ITEM_NAME, qty: 1, notes: "" }),
    step(activateCampaign, (r) => ({ id: r.id("campaign", "campaign") })),
  ],
});
