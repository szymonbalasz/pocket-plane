import { setConcentration } from "@server/features/combat-extras/effect-commands";
import { setInitiative } from "@server/features/combat-tracker/initiative";
import { summonCommand } from "@server/features/combat-tracker/summon";
import { defineFixture, type Refs, step } from "@server/features/fixtures-adapters/fixture-types";
import { type AddCombatantsInput, CBTX_INTENTS } from "@shared/combat-extras/intents";
import {
  COMBATANT_TYPE,
  ENCOUNTER_TYPE,
  type SummonInput,
  type TurnMode,
} from "@shared/combat-tracker/schemas";
import { ENTITY_TYPE, IMPORTED_ENTITY_TYPE } from "@shared/entities/schemas";
import { TOKEN_TYPE } from "@shared/scenes-map/schemas";

/** Combatants this unit creates, in order (Add's two pets, then one summon per call). */
export const CP_COMBAT = { owlbear: 0, drake: 1, fe: 2, fe2: 3, fe3: 4 } as const;

const enc = (r: Refs) => r.id("encounter-1", ENCOUNTER_TYPE);

/** `cbt.summon` the SRD Fire Elemental (`cp-srd` index 1) ×1 for `owner`. */
const summonFe = (owner: string, turnMode: TurnMode, linkConcentration = false) =>
  step(
    summonCommand,
    (r): SummonInput => ({
      encounterId: enc(r),
      definitionId: r.id("cp-srd", IMPORTED_ENTITY_TYPE, 1),
      count: 1,
      ownerCharacterId: r.id(owner, ENTITY_TYPE),
      turnMode,
      ...(linkConcentration ? { linkConcentration: true } : {}),
    }),
  );

/**
 * CBT §13.3 `cp-combat` (sprint 6, CP3): joins the running ambush (`combat-1` + `trg-combat`;
 * session-sim-9 has it too, seams S12: joined, never started). Both pets join through
 * combat-extras' Add with their tokens (OQ-CBT-84 a); Thorn concentrates on "Conjure Elemental"
 * (as player-2); `cbt.summon` Fire Elemental for Mira (after her), for Brakka (in her turn) and
 * for Thorn (own initiative, linked to the concentration), then FE 3's initiative 9. Order: Wolf
 * 18, Brakka 17 (lines: Drake Companion, Fire Elemental 2), Mira 15, Owlbear, Fire Elemental,
 * Goblin 12, Goblin 2 12, Thorn 10, Fire Elemental 3 9, Elite 8; still the Wolf's turn.
 */
export default defineFixture({
  key: "cp-combat",
  kind: "setup",
  requires: ["combat-1", "trg-combat", "cp-srd", "pet-owlbear", "pet-drake"],
  ownerSpec: "combat-tracker",
  steps: [
    // Built per server (it takes the combat rule hooks): named, input still type-checked.
    {
      command: CBTX_INTENTS.addCombatants,
      input: (r: Refs): AddCombatantsInput => ({
        encounterId: enc(r),
        items: [
          { tokenId: r.id("pet-owlbear", TOKEN_TYPE) },
          { tokenId: r.id("pet-drake", TOKEN_TYPE) },
        ],
      }),
    },
    step(
      setConcentration,
      (r) => ({
        target: { characterId: r.id("char-thorn", ENTITY_TYPE) },
        label: "Conjure Elemental",
      }),
      { as: "player-2" },
    ),
    summonFe("char-mira", "after-owner"),
    summonFe("char-brakka", "in-owner-turn"),
    summonFe("char-thorn", "own", true),
    step(setInitiative, (r) => ({
      combatantId: r.id("cp-combat", COMBATANT_TYPE, CP_COMBAT.fe3),
      value: 9,
    })),
  ],
});
