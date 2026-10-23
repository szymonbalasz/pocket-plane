import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { lootMove } from "@server/features/party-loot/commands";
import { STRONGHOLD_TYPE } from "@shared/strongholds/schemas";

/**
 * FR-HOLD-35 `hold-tower-move`: 5 gp Tower Stores → Party pot (players read "Outside the party →
 * Party pot", FR-LOOT-32). Changes the pot, so not in session-sim-13 (FR-HOLD-36).
 */
export default defineFixture({
  key: "hold-tower-move",
  kind: "setup",
  requires: ["hold-tower-secret"],
  ownerSpec: "strongholds",
  steps: [
    step(lootMove, (r) => ({
      from: { kind: "stores" as const, strongholdId: r.id("hold-tower-secret", STRONGHOLD_TYPE) },
      to: { kind: "party" as const },
      gp: 5,
    })),
  ],
});
