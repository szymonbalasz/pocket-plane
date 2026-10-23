import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { saveReminder } from "@server/features/reminders/commands";
import { ENTITY_TYPE } from "@shared/entities/schemas";

/** Leak marker (FR-REM-16): DM-only; no player may receive it. */
export const REM_SECRET_THORN = "REM-SECRET-THORN";

/** FR-REM-27 `rem-thorn-secret`: the DM's DM-only reminder on Thorn. */
export default defineFixture({
  key: "rem-thorn-secret",
  kind: "setup",
  requires: ["char-thorn"],
  ownerSpec: "reminders",
  steps: [
    step(saveReminder, (r) => ({
      target: { kind: "character" as const, characterId: r.id("char-thorn", ENTITY_TYPE) },
      text: `${REM_SECRET_THORN} The blade is cursed`,
      dmOnly: true,
    })),
  ],
});
