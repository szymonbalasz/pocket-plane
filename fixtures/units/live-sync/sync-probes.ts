import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { probeSet } from "@server/features/live-sync/probe";

/** Probes `public`, `secret` (hidden, SECRET-PROBE), `mine` (owner player-1). Test mode only. */
export default defineFixture({
  key: "sync-probes",
  kind: "setup",
  requires: ["campaign", "player-1"],
  ownerSpec: "live-sync",
  steps: [
    step(probeSet, { text: "public", hidden: false }),
    step(probeSet, { text: "SECRET-PROBE", hidden: true }),
    step(probeSet, (r) => ({
      text: "mine",
      hidden: false,
      ownerPlayerId: r.id("player-1", "player"),
    })),
  ],
});
