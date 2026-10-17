import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import type { FogSetInvisibleInput } from "@shared/fog-of-war/schemas";
import { TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { editStep, entityOf } from "../character-sheet-full/steps";
import { fog } from "./commands";

/**
 * FOG §13 (sprint 4) `vision-invisible`: a patch, Goblin 2 Invisible (`fog.setInvisible`, #210);
 * Thorn's senses = darkvision 60 ft, sees through magical darkness, Sees invisible (DM). Used by
 * bundle `vision-party`.
 */
export default defineFixture({
  key: "vision-invisible",
  kind: "setup",
  requires: ["vision-senses", "goblin-2"],
  ownerSpec: "fog-of-war",
  steps: [
    step(
      fog.setInvisible,
      (r): FogSetInvisibleInput => ({ tokenId: r.id("goblin-2", TOKEN_TYPE), invisible: true }),
    ),
    editStep((r) => ({
      creatureId: entityOf(r, "char-thorn"),
      set: {
        senses: {
          visionFt: 0,
          darkvisionFt: 60,
          seesMagicalDarkness: true,
          seesInvisible: true,
        },
      },
    })),
  ],
});
