import { createEncounter } from "@server/features/combat-tracker/encounters";
import { applyHp } from "@server/features/combat-tracker/hp";
import { endCommand, startCommand } from "@server/features/combat-tracker/lifecycle";
import { rollCommand } from "@server/features/dice-roll-log/commands";
import { createEntity } from "@server/features/entities/commands";
import { defineFixture, type Refs, step } from "@server/features/fixtures-adapters/fixture-types";
import { COMBATANT_TYPE, ENCOUNTER_TYPE } from "@shared/combat-tracker/schemas";
import type { CreateEntityBody } from "@shared/entities/schemas";
import { goblin } from "../../srd/monster/goblin";

const { hpFormula: _hpFormula, ...goblinBlock } = goblin.statBlock;

/** Combatants in `seq` order after Start: party by name, then the Skeletons. */
export const CRYPT = { mira: 0, thorn: 1, skeleton: 2, skeleton2: 3 } as const;

const enc = (r: Refs) => r.id("st-past-crypt", ENCOUNTER_TYPE);
const who = (r: Refs, k: keyof typeof CRYPT) => r.id("st-past-crypt", COMBATANT_TYPE, CRYPT[k]);
const hp = (
  target: keyof typeof CRYPT,
  kind: "damage" | "heal",
  amount: number,
  from?: keyof typeof CRYPT,
) =>
  step(applyHp, (r) => ({
    combatantId: who(r, target),
    kind,
    amount,
    public: true,
    ...(from ? { sourceId: who(r, from) } : {}),
  }));

/**
 * STATS §13 `st-past-crypt` (joins session-sim-11, seams S13): an ended "Old Crypt", Thorn and
 * Mira vs 2 Skeletons (13 HP), every line public, so the DM and players read the same numbers:
 * - Thorn: a public nat 20; 30 on Skeleton (overkill 17 ≥ 13: callout, kill); 13 on Skeleton 2
 *   (kill). Dealt 43, kills 2, Biggest hit 30, Biggest overkill DM 17 / players 30.
 * - Skeleton 2 → Mira 15: Mira downed (taken 15, downs 1); the DM heals her 12 ("Unattributed").
 * Loads **before** the running Goblin Ambush (only one fight can be started): bundle
 * `stats-past`, included first by `stats` and `session-sim-11`. Fixed clock (FR-FIX-08): the
 * same past session as the bundle's other facts.
 */
export default defineFixture({
  key: "st-past-crypt",
  kind: "setup",
  requires: ["char-mira", "char-thorn", "town"],
  ownerSpec: "stats",
  steps: [
    step(
      createEntity,
      (): CreateEntityBody => ({
        kind: "monster",
        name: "Skeleton",
        statBlock: {
          ...goblinBlock,
          ac: 13,
          hpMax: 13,
          attacks: [{ name: "Shortsword", toHit: 4, damage: "1d6+2", damageType: "piercing" }],
          cr: "1/4",
          type: "undead",
        },
      }),
    ),
    step(createEncounter, (r) => ({
      name: "Old Crypt",
      partyCharacterIds: [r.id("char-mira", "entity"), r.id("char-thorn", "entity")],
      entries: [{ definitionId: r.id("st-past-crypt", "entity"), quantity: 2 }],
      createTokens: false,
      addHidden: false,
    })),
    step(startCommand, (r) => ({ encounterId: enc(r), sceneId: r.id("town", "scene") })),
    step(
      rollCommand,
      (r) => ({
        expression: "1d20+5",
        category: "attack" as const,
        actor: { entityId: r.id("char-thorn", "entity") },
        manual: { diceTotal: 20 },
      }),
      { as: "player-2" },
    ),
    hp("skeleton", "damage", 30, "thorn"),
    hp("mira", "damage", 15, "skeleton2"),
    hp("skeleton2", "damage", 13, "thorn"),
    hp("mira", "heal", 12),
    step(endCommand, (r) => ({ encounterId: enc(r) })),
  ],
});
