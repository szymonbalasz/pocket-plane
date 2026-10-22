import { setTempHp } from "@server/features/combat-extras/play-state";
import { createEntity } from "@server/features/entities/commands";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { TEMP_HP_MAX } from "@shared/combat-extras/schemas";
import { type CreateEntityBody, ENTITY_TYPE } from "@shared/entities/schemas";

/** The 40-character name (FR-PARTY-58: names wrap, never cut). */
export const LONG_PC_NAME = "Vex Thistledown-Ashgrove of Brindlemarsh";

const PCS = [
  { name: "Pip", owner: "player-1" },
  { name: "Rowan", owner: "player-2" },
  { name: LONG_PC_NAME, owner: "player-2" },
] as const;

/**
 * CBTX §13.1 `cb-party-six` (sprint 8, CB3): three more PCs with worst-width figures (HP 999 / 999,
 * temp HP 999, AC 30, one 40-character name): a 6-PC party for `party.summary`'s useful-size
 * criterion (FR-SHELL-141, review-b #21). No tokens. Joins `wf-frame-e2e` only (not
 * `combat-polish` or `session-sim-12`).
 */
export default defineFixture({
  key: "cb-party-six",
  kind: "setup",
  requires: ["cb-party"],
  ownerSpec: "combat-extras",
  steps: [
    ...PCS.map((pc) =>
      step(
        createEntity,
        (r): CreateEntityBody => ({
          kind: "character",
          name: pc.name,
          ownerPlayerId: r.id(pc.owner, "player"),
          statBlock: {
            size: "medium",
            ac: 30,
            hpMax: 999,
            initBonus: 0,
            attacks: [],
            level: 20,
            className: "Fighter",
          },
        }),
      ),
    ),
    ...PCS.map((_, i) =>
      step(setTempHp, (r) => ({
        target: { characterId: r.id("cb-party-six", ENTITY_TYPE, i) },
        value: TEMP_HP_MAX,
      })),
    ),
  ],
});
