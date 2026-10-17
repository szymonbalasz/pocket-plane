import { defineFixture } from "@server/features/fixtures-adapters/fixture-types";
import { editStep, entityOf } from "../character-sheet-full/steps";

/**
 * FOG §13 (sprint 4) `vision-brakka`: a patch on `char-brakka`, vision 30 ft, darkvision 60 ft (a
 * torch, like Mira). For the orchestrator's session-sim-8 (review A14), not session-sim-7: there
 * Brakka keeps no senses and sees Normal 999 ft.
 */
export default defineFixture({
  key: "vision-brakka",
  kind: "setup",
  requires: ["char-brakka"],
  ownerSpec: "fog-of-war",
  steps: [
    editStep((r) => ({
      creatureId: entityOf(r, "char-brakka"),
      set: { senses: { visionFt: 30, darkvisionFt: 60, seesMagicalDarkness: false } },
    })),
  ],
});
