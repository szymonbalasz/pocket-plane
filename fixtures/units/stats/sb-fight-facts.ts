import { applyHp, undoCommand } from "@server/features/combat-tracker/hp";
import { createEntity } from "@server/features/entities/commands";
import {
  defineFixture,
  type Refs,
  type SetupStep,
  step,
} from "@server/features/fixtures-adapters/fixture-types";
import { CBTX_INTENTS } from "@shared/combat-extras/intents";
import { COMBATANT_TYPE, ENCOUNTER_TYPE, HP_CHANGE_TYPE } from "@shared/combat-tracker/schemas";
import type { CreateEntityBody } from "@shared/entities/schemas";
import { goblin } from "../../srd/monster/goblin";
import { COMBAT_1 } from "../combat-tracker/combat-1";
import { CP_COMBAT } from "../combat-tracker/cp-combat";

const KEY = "sb-fight-facts";
const { hpFormula: _hpFormula, ...goblinBlock } = goblin.statBlock;

/**
 * The combatants this unit adds, in order: 4 token-less Bandits (visible; Add names them
 * "Bandit", "Bandit 2", "Bandit 3", "Bandit 4"), then the hidden "Bandit Captain" with a hidden
 * token.
 */
export const SB_FIGHT = { bandit: 0, bandit2: 1, bandit3: 2, bandit4: 3, captain: 4 } as const;
type Who = keyof typeof SB_FIGHT | "mira" | "thorn" | "owlbear";

const who = (r: Refs, k: Who): string => {
  if (k === "owlbear") return r.id("cp-combat", COMBATANT_TYPE, CP_COMBAT.owlbear);
  if (k === "mira" || k === "thorn") return r.id("combat-1", COMBATANT_TYPE, COMBAT_1[k]);
  return r.id(KEY, COMBATANT_TYPE, SB_FIGHT[k]);
};
const hp = (target: Who, kind: "damage" | "heal", amount: number, from?: Who) =>
  step(applyHp, (r) => ({
    combatantId: who(r, target),
    kind,
    amount,
    public: true,
    ...(from ? { sourceId: who(r, from) } : {}),
  }));
const enc = (r: Refs) => r.id("encounter-1", ENCOUNTER_TYPE);
const add = (definition: number, quantity: number, hidden: boolean): SetupStep => ({
  command: CBTX_INTENTS.addCombatants,
  input: (r: Refs) => ({
    encounterId: enc(r),
    items: [{ definitionId: r.id(KEY, "entity", definition), quantity }],
    ...(hidden ? { createTokens: true, hidden: true, at: { col: 18, row: 2 } } : {}),
  }),
});
/** This unit's hp-change records before the undone one. */
const UNDONE_ROW = 5;

/**
 * STATS §13.1 `sb-fight-facts` (joins session-sim-12, seams S15; session-sim-11-safe: no gems,
 * no `st-ambush-facts`, Goblin / Goblin 2 untouched), on the running Goblin Ambush. Adds 4
 * token-less Bandits (11 HP) and a hidden Bandit Captain (15 HP, hidden token at (18, 2)), then,
 * in log order (lines public unless a side is hidden):
 * - Mira → Bandit 25: kill, callout (overkill 14). `fell: "kill"`.
 * - Thorn → the hidden Captain 20: kill on a DM-only line (players: no line, no `fell`).
 * - The Owlbear (Mira's pet) → Bandit 3 11: kill (a companion's; "Mira + Owlbear").
 * - Bandit 2 → Thorn 200: Thorn down (`fell: "down"`, callout); the DM heals him 10 (no From).
 * - Thorn → Bandit 4 11, undone: Bandit 4 stays at 11 HP, a live target (walkthrough step 2).
 * Expected (this unit's facts only), DM | players: kills Mira 1 + Owlbear 1 | same; Thorn 1 | 0;
 * downs Thorn 1 | 1; Still standing (DM) Bandit 2, Bandit 4. Bundle totals: the header of
 * `stats.fixtures.test.ts`.
 */
export default defineFixture({
  key: KEY,
  kind: "setup",
  requires: ["combat-1", "cp-combat", "char-mira", "char-thorn", "char-brakka"],
  ownerSpec: "stats",
  steps: [
    step(
      createEntity,
      (): CreateEntityBody => ({
        kind: "monster",
        name: "Bandit",
        statBlock: { ...goblinBlock, ac: 12, hpMax: 11 },
      }),
    ),
    step(
      createEntity,
      (): CreateEntityBody => ({
        kind: "monster",
        name: "Bandit Captain",
        statBlock: { ...goblinBlock, ac: 15, hpMax: 15 },
      }),
    ),
    add(0, 4, false),
    add(1, 1, true),
    hp("bandit", "damage", 25, "mira"),
    hp("captain", "damage", 20, "thorn"),
    hp("bandit3", "damage", 11, "owlbear"),
    hp("thorn", "damage", 200, "bandit2"),
    hp("thorn", "heal", 10),
    hp("bandit4", "damage", 11, "thorn"),
    step(undoCommand, (r) => ({ expectedHpChangeId: r.id(KEY, HP_CHANGE_TYPE, UNDONE_ROW) })),
  ],
});
