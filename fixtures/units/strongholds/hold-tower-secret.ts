import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { addItem } from "@server/features/party-board/commands";
import { lootMove } from "@server/features/party-loot/commands";
import {
  createStronghold,
  saveFacility,
  updateStronghold,
} from "@server/features/strongholds/commands";
import { STRONGHOLD_TYPE } from "@shared/strongholds/schemas";

/** Leak markers (FR-HOLD-10): a DM-only stronghold, its notes and its Stores item. */
export const TOWER = {
  name: "HOLD-SECRET-TOWER",
  notes: "HOLD-SECRET-NOTES",
  item: "HOLD-SECRET-ITEM",
} as const;

const hold = "hold-tower-secret";
const stores = (id: string) => ({ kind: "stores" as const, strongholdId: id });

/**
 * FR-HOLD-35 `hold-tower-secret`: a DM-only stronghold (the default) with notes, one facility and
 * Stores HOLD-SECRET-ITEM ×1 and 10 gp (Outside the party → Stores: players see no row).
 */
export default defineFixture({
  key: hold,
  kind: "setup",
  requires: ["campaign"],
  ownerSpec: "strongholds",
  steps: [
    step(createStronghold, { name: TOWER.name }),
    step(updateStronghold, (r) => ({
      strongholdId: r.id(hold, STRONGHOLD_TYPE),
      notes: TOWER.notes,
    })),
    step(saveFacility, (r) => ({
      strongholdId: r.id(hold, STRONGHOLD_TYPE),
      facility: { name: "Watch Loft", state: "built" as const },
    })),
    step(addItem, (r) => ({
      name: TOWER.item,
      qty: 1,
      notes: "",
      holder: stores(r.id(hold, STRONGHOLD_TYPE)),
    })),
    step(lootMove, (r) => ({
      from: { kind: "world" as const },
      to: stores(r.id(hold, STRONGHOLD_TYPE)),
      gp: 10,
    })),
  ],
});
