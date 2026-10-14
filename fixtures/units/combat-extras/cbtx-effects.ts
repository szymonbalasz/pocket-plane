import { addEffect, setConcentration } from "@server/features/combat-extras/effect-commands";
import { defineFixture, type Refs, step } from "@server/features/fixtures-adapters/fixture-types";
import { COMBATANT_TYPE } from "@shared/combat-tracker/schemas";
import { ENTITY_TYPE } from "@shared/entities/schemas";
import { COMBAT_1 } from "../combat-tracker/combat-1";

const who = (r: Refs, k: keyof typeof COMBAT_1) => r.id("combat-1", COMBATANT_TYPE, COMBAT_1[k]);

/**
 * CBTX §13 `cbtx-effects`: Mira concentrates on "Bless" 10 rounds; Bless (custom, source Mira,
 * linked, 10 rounds) on Mira and Thorn; Goblin prone; Elite (hidden) poisoned; Goblin 2 "Hex"
 * secret; Thorn "Marked" (no duration, no source).
 */
export default defineFixture({
  key: "cbtx-effects",
  kind: "setup",
  requires: ["combat-1"],
  ownerSpec: "combat-extras",
  steps: [
    step(setConcentration, (r) => ({
      target: { characterId: r.id("char-mira", ENTITY_TYPE) },
      label: "Bless",
      durationRounds: 10,
    })),
    step(addEffect, (r) => ({
      targets: [{ combatantId: who(r, "mira") }, { combatantId: who(r, "thorn") }],
      kind: "custom" as const,
      label: "Bless",
      durationRounds: 10,
      sourceCombatantId: who(r, "mira"),
      linkConcentration: true,
    })),
    step(addEffect, (r) => ({
      targets: [{ combatantId: who(r, "goblin") }],
      kind: "condition" as const,
      condition: "prone" as const,
    })),
    step(addEffect, (r) => ({
      targets: [{ combatantId: who(r, "elite") }],
      kind: "condition" as const,
      condition: "poisoned" as const,
    })),
    step(addEffect, (r) => ({
      targets: [{ combatantId: who(r, "goblin2") }],
      kind: "custom" as const,
      label: "Hex",
      secret: true,
    })),
    step(addEffect, (r) => ({
      targets: [{ characterId: r.id("char-thorn", ENTITY_TYPE) }],
      kind: "custom" as const,
      label: "Marked",
    })),
  ],
});
