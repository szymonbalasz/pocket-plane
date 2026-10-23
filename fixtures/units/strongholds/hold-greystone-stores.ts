import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { addItem } from "@server/features/party-board/commands";
import { lootMove } from "@server/features/party-loot/commands";
import { STRONGHOLD_TYPE } from "@shared/strongholds/schemas";

/** Leak marker (FR-HOLD-10): a DM-only Stores item in a shown stronghold (OQ-HOLD-12 A). */
export const HOLD_SECRET_GEM = "HOLD-SECRET-GEM";

const stores = (id: string) => ({ kind: "stores" as const, strongholdId: id });

/**
 * FR-HOLD-35 `hold-greystone-stores`: Rope ×2, Arrows ×40, the DM-only HOLD-SECRET-GEM ×1 and
 * 120 gp (Outside the party → Stores). Session-sim-12-safe: pot, wallets and sheets unchanged.
 */
export default defineFixture({
  key: "hold-greystone-stores",
  kind: "setup",
  requires: ["hold-greystone"],
  ownerSpec: "strongholds",
  steps: [
    step(addItem, (r) => ({
      name: "Rope",
      qty: 2,
      notes: "",
      holder: stores(r.id("hold-greystone", STRONGHOLD_TYPE)),
    })),
    step(addItem, (r) => ({
      name: "Arrows",
      qty: 40,
      notes: "",
      holder: stores(r.id("hold-greystone", STRONGHOLD_TYPE)),
    })),
    step(addItem, (r) => ({
      name: HOLD_SECRET_GEM,
      qty: 1,
      notes: "",
      holder: stores(r.id("hold-greystone", STRONGHOLD_TYPE)),
      dmOnly: true,
    })),
    step(lootMove, (r) => ({
      from: { kind: "world" as const },
      to: stores(r.id("hold-greystone", STRONGHOLD_TYPE)),
      gp: 120,
    })),
  ],
});
