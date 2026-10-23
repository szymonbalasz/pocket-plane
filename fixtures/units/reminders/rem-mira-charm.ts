import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { saveReminder } from "@server/features/reminders/commands";
import { ENTITY_TYPE } from "@shared/entities/schemas";

/** Leak marker (FR-REM-16): only Mira's owner (player-1) and the DM may receive it. */
export const REM_MIRA_CHARM = "REM-MIRA-CHARM";

/** FR-REM-27 `rem-mira-charm`: the DM's reminder on Mira with one roll "Charm" 1d4 (saving throw). */
export default defineFixture({
  key: "rem-mira-charm",
  kind: "setup",
  requires: ["char-mira"],
  ownerSpec: "reminders",
  steps: [
    step(saveReminder, (r) => ({
      target: { kind: "character" as const, characterId: r.id("char-mira", ENTITY_TYPE) },
      text: `${REM_MIRA_CHARM} Lucky charm: once a day add 1d4 to a save`,
      rolls: [{ label: "Charm", expression: "1d4", category: "saving-throw" as const }],
    })),
  ],
});
