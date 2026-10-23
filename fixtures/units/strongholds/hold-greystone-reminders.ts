import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { saveReminderByName } from "@server/features/strongholds/fixture-commands";
import { STRONGHOLD_TYPE } from "@shared/strongholds/schemas";
import { GREYSTONE } from "./hold-greystone";

export const STEAM_ROOMS_TEXT = "Steam Rooms: advantage on the first CON save after a long rest";
/** Leak marker (FR-REM-16): linked to the DM-only vault, so hidden with it. */
export const REM_SECRET_VAULT = "REM-SECRET-VAULT";

/**
 * FR-HOLD-35 `hold-greystone-reminders`: a party reminder linked to Steam Rooms and one linked to
 * the DM-only vault (hidden with it, FR-REM-06).
 */
export default defineFixture({
  key: "hold-greystone-reminders",
  kind: "setup",
  requires: ["hold-greystone"],
  ownerSpec: "strongholds",
  steps: [
    step(saveReminderByName, (r) => ({
      facility: "Steam Rooms",
      reminder: {
        target: { kind: "party" as const },
        text: STEAM_ROOMS_TEXT,
        source: `${GREYSTONE.name}: Steam Rooms`,
        strongholdId: r.id("hold-greystone", STRONGHOLD_TYPE),
      },
    })),
    step(saveReminderByName, (r) => ({
      facility: GREYSTONE.vault,
      reminder: {
        target: { kind: "party" as const },
        text: `${REM_SECRET_VAULT} The ledger names a traitor`,
        source: `${GREYSTONE.name}: vault`,
        strongholdId: r.id("hold-greystone", STRONGHOLD_TYPE),
      },
    })),
  ],
});
