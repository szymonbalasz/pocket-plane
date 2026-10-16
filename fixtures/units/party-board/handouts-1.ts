import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { createHandout, shareHandout } from "@server/features/party-board/commands";
import { HANDOUT_TYPE, type SharedWith } from "@shared/party-board/schemas";

import { HANDOUT_IMG } from "./handout-images";

const ALL: SharedWith = { mode: "all", playerIds: [] };
const NONE: SharedWith = { mode: "none", playerIds: [] };

/** Strings and indexes the PARTY leak tests and walkthrough look for (PARTY §13). */
export const HANDOUTS_1 = {
  /** Handout index in this fixture (creation order). */
  h: { mayor: 0, thievesMap: 1, secretOrders: 2, oldBounty: 3, shipManifest: 4 },
  p1Only: "PARTY-P1-ONLY",
  secret: "PARTY-SECRET-3",
  unshared: "PARTY-UNSHARED-4",
  prep: "PARTY-PREP-5",
} as const;

type R = { id(k: string, t: string, i?: number): string };
const h = (r: R, i: number) => ({ handoutId: r.id("handouts-1", HANDOUT_TYPE, i) });

/**
 * PARTY §13 `handouts-1` (patch: handouts only): h1 "Mayor's Letter" (3 lines) → all; h2
 * "PARTY-P1-ONLY Thieves' Map" (thieves-map + text) → [player-1]; h3 "Secret Orders" →
 * unshared; h4 "Old Bounty" → all, then unshared; h5 "Ship Manifest" → unshared. Side
 * effects: 3 `handout-shared` notifications (FR-PARTY-06): h1 all, h2 player-1, h4 all (its row
 * and id stay after the unshare, OQ-PARTY-15).
 */
export default defineFixture({
  key: "handouts-1",
  kind: "setup",
  requires: ["handout-images", "player-2", "images"],
  ownerSpec: "party-board",
  steps: [
    step(createHandout, {
      title: "Mayor's Letter",
      body: "To the heroes of Greywater,\nthe mill road is no longer safe.\nCome to the hall at dusk. — Mayor Odile",
      imageAssetIds: [],
    }),
    step(createHandout, (r) => ({
      title: `${HANDOUTS_1.p1Only} Thieves' Map`,
      body: `${HANDOUTS_1.p1Only}: the guild's route runs under the old granary.`,
      imageAssetIds: [r.id("handout-images", "asset", HANDOUT_IMG.thievesMap)],
    })),
    step(createHandout, { title: "Secret Orders", body: HANDOUTS_1.secret, imageAssetIds: [] }),
    step(createHandout, { title: "Old Bounty", body: HANDOUTS_1.unshared, imageAssetIds: [] }),
    step(createHandout, { title: "Ship Manifest", body: HANDOUTS_1.prep, imageAssetIds: [] }),
    step(shareHandout, (r) => ({ ...h(r, 0), sharedWith: ALL })),
    step(shareHandout, (r) => ({
      ...h(r, 1),
      sharedWith: { mode: "players", playerIds: [r.id("player-1", "player")] } as SharedWith,
    })),
    step(shareHandout, (r) => ({ ...h(r, 3), sharedWith: ALL })),
    step(shareHandout, (r) => ({ ...h(r, 3), sharedWith: NONE })),
  ],
});
