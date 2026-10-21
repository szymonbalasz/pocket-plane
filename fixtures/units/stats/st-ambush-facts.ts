import { rollConcentration } from "@server/features/combat-extras/concentration";
import { rollDamageCommand } from "@server/features/combat-tracker/damage";
import { fixtureSeededId } from "@server/features/combat-tracker/fixtures";
import { applyCard, applyHp, undoCommand } from "@server/features/combat-tracker/hp";
import { rollCommand } from "@server/features/dice-roll-log/commands";
import { createEntity } from "@server/features/entities/commands";
import {
  defineFixture,
  type Refs,
  type SetupStep,
  step,
} from "@server/features/fixtures-adapters/fixture-types";
import { CBTX_INTENTS } from "@shared/combat-extras/intents";
import { COMBATANT_TYPE, ENCOUNTER_TYPE, HP_CHANGE_TYPE } from "@shared/combat-tracker/schemas";
import { type CreateEntityBody, IMPORTED_ENTITY_TYPE } from "@shared/entities/schemas";
import { goblin } from "../../srd/monster/goblin";
import { COMBAT_1 } from "../combat-tracker/combat-1";
import { miraCrossbowId } from "../combat-tracker/late-hit-ruled";

const KEY = "st-ambush-facts";
const { hpFormula: _hpFormula, ...goblinBlock } = goblin.statBlock;

/**
 * The Goblin Scouts this unit adds, token-less and visible (its own combatant records, in order;
 * a new definition, so no free Goblin token on the map, e.g. the fogged "Goblin Lurker", joins).
 */
export const ADDED = { scout: 0, scout2: 1, scout3: 2, scout4: 3 } as const;
type Who = keyof typeof COMBAT_1 | keyof typeof ADDED | "brakka" | "owlbear";

const who = (r: Refs, k: Who): string => {
  if (k in ADDED) return r.id(KEY, COMBATANT_TYPE, ADDED[k as keyof typeof ADDED]);
  if (k === "brakka") return r.id("trg-combat", COMBATANT_TYPE, 0);
  if (k === "owlbear") return r.id("cp-combat", COMBATANT_TYPE, 0);
  return r.id("combat-1", COMBATANT_TYPE, COMBAT_1[k as keyof typeof COMBAT_1]);
};
const hp = (target: Who, kind: "damage" | "heal", amount: number, from?: Who) =>
  step(applyHp, (r) => ({
    combatantId: who(r, target),
    kind,
    amount,
    public: true,
    ...(from ? { sourceId: who(r, from) } : {}),
  }));
const roll = (character: "char-mira" | "char-thorn", natural: number, as?: string) =>
  step(
    rollCommand,
    (r) => ({
      expression: "1d20+5",
      category: "attack" as const,
      actor: { entityId: r.id(character, "entity") },
      manual: { diceTotal: natural },
      ...(as ? {} : { public: false }),
    }),
    as ? { as } : {},
  );

/** Seeded draws (the fixture test asserts them): Brakka's damage roll, Mira's late damage roll. */
export const BRAKKA_DAMAGE_ROLL = () => fixtureSeededId(KEY, 30);
export const MIRA_LATE_ROLL = () => fixtureSeededId(KEY, 54);
/** This unit's hp-change records before the undone one. */
const UNDONE_ROW = 8;

/**
 * STATS §13 `st-ambush-facts`, on session-sim-10's running Goblin Ambush (round 1). Adds 4 Goblin
 * Scouts (7 HP, token-less, visible), then, in log order:
 * - Thorn (Player 2): a public nat 20; 30 on Goblin Scout at 7 HP (callout, overkill 23; kill).
 * - Mira (Player 1): a public nat 1 (a miss, no apply).
 * - Goblin Scout 3 → Mira 11 (12 → 1); Brakka heals Mira 8 with From (→ 9, 3 below max).
 * - Override: Brakka's damage-only card on Goblin Scout 3, rolled 10 (6 + Rage), the DM types 12.
 * - Goblin Scout 2 → Brakka 55: Brakka down.
 * - The hidden Elite → Thorn 9 (DM-only line; 10 → 1); Thorn passes the concentration save (15).
 * - A hidden DM roll as Thorn: nat 20 (counts for the DM only).
 * - Apply hit, then late damage: `late-hit-ruled`'s card, Mira's late roll, the DM's 11 on the
 *   hidden Goblin 2 (DM-only line; Mira's kill, overkill 4).
 * - The Owlbear (Mira's pet) → Goblin Scout 4: 7, kill ("Mira + Owlbear").
 * - One undone apply: Thorn → Goblin Scout 2, 5, undone (it stays at 7 HP: the walkthrough's
 *   "Goblin 4").
 * - The DM's direct 3 on the hidden Wolf, no From: the DM's "DM (direct)" row (DM-only line).
 * Expected numbers: the header of `stats.fixtures.test.ts` (DM and players).
 */
export default defineFixture({
  key: KEY,
  kind: "setup",
  requires: ["combat-1", "trg-combat", "cp-combat", "late-hit-ruled", "char-mira", "char-thorn"],
  ownerSpec: "stats",
  steps: [
    step(
      createEntity,
      (r): CreateEntityBody => ({
        kind: "monster",
        name: "Goblin Scout",
        derivedFromId: r.id("enemy-1", IMPORTED_ENTITY_TYPE),
        statBlock: { ...goblinBlock },
      }),
    ),
    {
      command: CBTX_INTENTS.addCombatants,
      input: (r: Refs) => ({
        encounterId: r.id("encounter-1", ENCOUNTER_TYPE),
        items: [{ definitionId: r.id(KEY, "entity"), quantity: 4 }],
      }),
    } satisfies SetupStep,
    roll("char-thorn", 20, "player-2"),
    hp("scout", "damage", 30, "thorn"),
    roll("char-mira", 1, "player-1"),
    hp("mira", "damage", 11, "scout3"),
    hp("mira", "heal", 8, "brakka"),
    step(rollDamageCommand, (r) => ({ attackerId: who(r, "brakka"), manual: { diceTotal: 6 } })),
    step(applyCard, (r) => ({
      cardId: r.id(KEY, "notification", 0),
      damageTotal: 12,
      damageRollId: BRAKKA_DAMAGE_ROLL(),
      targets: [{ targetId: who(r, "scout3"), hit: true, multiplier: "normal" as const }],
      public: true,
    })),
    hp("brakka", "damage", 55, "scout2"),
    hp("thorn", "damage", 9, "elite"),
    step(
      rollConcentration,
      (r) => ({ notificationId: r.id(KEY, "notification", 1), manual: { diceTotal: 15 } }),
      { as: "player-2" },
    ),
    roll("char-thorn", 20),
    step(
      rollDamageCommand,
      (r) => ({
        attackerId: who(r, "mira"),
        attackId: miraCrossbowId(),
        manual: { diceTotal: 6 },
      }),
      { as: "player-1" },
    ),
    step(applyCard, (r) => ({
      cardId: r.id("late-hit-ruled", "notification"),
      damageTotal: 11,
      damageRollId: MIRA_LATE_ROLL(),
      targets: [{ targetId: who(r, "goblin2"), hit: true, multiplier: "normal" as const }],
    })),
    hp("scout4", "damage", 7, "owlbear"),
    hp("scout2", "damage", 5, "thorn"),
    step(undoCommand, (r) => ({ expectedHpChangeId: r.id(KEY, HP_CHANGE_TYPE, UNDONE_ROW) })),
    hp("wolf", "damage", 3),
  ],
});
