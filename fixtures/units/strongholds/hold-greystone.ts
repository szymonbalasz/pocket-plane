import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import {
  createStronghold,
  saveFacility,
  saveStaff,
  updateStronghold,
} from "@server/features/strongholds/commands";
import { saveFacilityByName, saveStaffByName } from "@server/features/strongholds/fixture-commands";
import { STRONGHOLD_TYPE } from "@shared/strongholds/schemas";

/**
 * HOLD §13 names (tests and walkthrough RS-H hard-code them). Every name is invented (FR-HOLD-40,
 * ADR-0018): no published bastion facility, order or event text.
 */
export const GREYSTONE = {
  name: "Greystone Keep",
  notes: "Rebuilt after the siege.",
  vault: "HOLD-SECRET-VAULT",
  spy: "HOLD-SECRET-SPY",
} as const;

const hold = "hold-greystone";

/**
 * FR-HOLD-35 `hold-greystone`: shown to players; defenders 12; notes; six facilities (Forge Hall,
 * Herb Beds, Map Room, Old Bathhouse, Steam Rooms replacing it, the DM-only vault) and three staff
 * (Brenna in Forge Hall, Tobin in Herb Beds, the DM-only spy). Upkeep 8 gp, wages 8 gp (3 visible).
 */
export default defineFixture({
  key: hold,
  kind: "setup",
  requires: ["campaign"],
  ownerSpec: "strongholds",
  steps: [
    step(createStronghold, { name: GREYSTONE.name }),
    step(updateStronghold, (r) => ({
      strongholdId: r.id(hold, STRONGHOLD_TYPE),
      dmOnly: false,
      defenders: 12,
      notes: GREYSTONE.notes,
    })),
    step(saveFacility, (r) => ({
      strongholdId: r.id(hold, STRONGHOLD_TYPE),
      facility: {
        name: "Forge Hall",
        state: "built" as const,
        upkeep: 5,
        incomeDice: "2d6",
        order: "Craft: arrows",
      },
    })),
    step(saveFacility, (r) => ({
      strongholdId: r.id(hold, STRONGHOLD_TYPE),
      facility: { name: "Herb Beds", state: "building" as const, cost: 500, buildDays: 20 },
    })),
    step(saveFacility, (r) => ({
      strongholdId: r.id(hold, STRONGHOLD_TYPE),
      facility: { name: "Map Room", state: "planned" as const, cost: 1000, buildDays: 30 },
    })),
    step(saveFacility, (r) => ({
      strongholdId: r.id(hold, STRONGHOLD_TYPE),
      facility: { name: "Old Bathhouse", state: "replaced" as const },
    })),
    step(saveFacilityByName, (r) => ({
      strongholdId: r.id(hold, STRONGHOLD_TYPE),
      replaces: "Old Bathhouse",
      facility: { name: "Steam Rooms", state: "built" as const, upkeep: 3 },
    })),
    step(saveFacility, (r) => ({
      strongholdId: r.id(hold, STRONGHOLD_TYPE),
      facility: {
        name: GREYSTONE.vault,
        state: "built" as const,
        effect: "HOLD-SECRET-VAULT keeps the old ledger.",
        dmOnly: true,
      },
    })),
    step(saveStaffByName, (r) => ({
      strongholdId: r.id(hold, STRONGHOLD_TYPE),
      worksIn: "Forge Hall",
      staff: { name: "Brenna", role: "smith", wage: 2 },
    })),
    step(saveStaffByName, (r) => ({
      strongholdId: r.id(hold, STRONGHOLD_TYPE),
      worksIn: "Herb Beds",
      staff: { name: "Tobin", role: "gardener", wage: 1 },
    })),
    step(saveStaff, (r) => ({
      strongholdId: r.id(hold, STRONGHOLD_TYPE),
      staff: { name: GREYSTONE.spy, role: "cook", wage: 5, dmOnly: true },
    })),
  ],
});
