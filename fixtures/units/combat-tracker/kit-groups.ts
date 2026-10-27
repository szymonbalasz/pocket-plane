import { summonCommand } from "@server/features/combat-tracker/summon";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { ENCOUNTER_TYPE, type SummonInput, type TurnMode } from "@shared/combat-tracker/schemas";
import { ENTITY_TYPE, IMPORTED_ENTITY_TYPE } from "@shared/entities/schemas";

/** `cbt.summon` the SRD Fire Elemental (`cp-srd` index 1) ×1 for `owner`. */
const summonFe = (owner: string, turnMode: TurnMode) =>
  step(
    summonCommand,
    (r): SummonInput => ({
      encounterId: r.id("encounter-1", ENCOUNTER_TYPE),
      definitionId: r.id("cp-srd", IMPORTED_ENTITY_TYPE, 1),
      count: 1,
      ownerCharacterId: r.id(owner, ENTITY_TYPE),
      turnMode,
    }),
  );

/**
 * Kit parity K12 `kit-groups` (round-2 gap 6, the companion groups as flat child rows): in the
 * running round-3 fight, `cbt.summon` a Fire Elemental for Mira in her turn (a line in her row)
 * and one for Thorn after him (a child row flush under his). Existing record types only.
 */
export default defineFixture({
  key: "kit-groups",
  kind: "setup",
  requires: ["combat-1", "cp-srd"],
  ownerSpec: "combat-tracker",
  steps: [summonFe("char-mira", "in-owner-turn"), summonFe("char-thorn", "after-owner")],
});
