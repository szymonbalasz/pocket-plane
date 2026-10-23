import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { saveReminder } from "@server/features/reminders/commands";
import { ENTITY_TYPE } from "@shared/entities/schemas";

/** Leak marker (FR-REM-16): only Thorn's owner (player-2) and the DM may receive it. */
export const REM_THORN_OWN = "REM-THORN-OWN";

/** FR-REM-27 `rem-thorn-own`: player-2's own reminder on Thorn (they created it; they may edit it). */
export default defineFixture({
  key: "rem-thorn-own",
  kind: "setup",
  requires: ["player-2", "char-thorn"],
  ownerSpec: "reminders",
  steps: [
    step(
      saveReminder,
      (r) => ({
        target: { kind: "character" as const, characterId: r.id("char-thorn", ENTITY_TYPE) },
        text: `${REM_THORN_OWN} Owe Brenna 20 gp`,
      }),
      { as: "player-2" },
    ),
  ],
});
