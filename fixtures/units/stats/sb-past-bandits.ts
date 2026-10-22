import { createEncounter } from "@server/features/combat-tracker/encounters";
import { applyHp } from "@server/features/combat-tracker/hp";
import { endCommand, startCommand } from "@server/features/combat-tracker/lifecycle";
import { createEntity } from "@server/features/entities/commands";
import {
  defineFixture,
  type Refs,
  type SetupStep,
  step,
} from "@server/features/fixtures-adapters/fixture-types";
import { CBTX_INTENTS } from "@shared/combat-extras/intents";
import { COMBATANT_TYPE, ENCOUNTER_TYPE } from "@shared/combat-tracker/schemas";
import type { CreateEntityBody } from "@shared/entities/schemas";
import { MAP_INTENTS, TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { goblin } from "../../srd/monster/goblin";

const KEY = "sb-past-bandits";
const { hpFormula: _hpFormula, ...goblinBlock } = goblin.statBlock;

/** Combatants in `seq` order after Start (party by name, then 3 Bandits), then the added Captain. */
export const BANDIT_CAMP = {
  mira: 0,
  thorn: 1,
  bandit: 2,
  bandit2: 3,
  bandit3: 4,
  captain: 5,
} as const;

const enc = (r: Refs) => r.id(KEY, ENCOUNTER_TYPE);
const who = (r: Refs, k: keyof typeof BANDIT_CAMP) => r.id(KEY, COMBATANT_TYPE, BANDIT_CAMP[k]);
const hp = (
  target: keyof typeof BANDIT_CAMP,
  kind: "damage" | "heal",
  amount: number,
  from?: keyof typeof BANDIT_CAMP,
) =>
  step(applyHp, (r) => ({
    combatantId: who(r, target),
    kind,
    amount,
    public: true,
    ...(from ? { sourceId: who(r, from) } : {}),
  }));
const captain: SetupStep = {
  command: CBTX_INTENTS.addCombatants,
  input: (r: Refs) => ({
    encounterId: enc(r),
    items: [{ definitionId: r.id(KEY, "entity", 1), quantity: 1 }],
    createTokens: true,
    hidden: true,
    at: { col: 2, row: 2 },
  }),
};

/**
 * STATS §13.1, the session-sim-12 variant of `sb-fight-facts` (gate ruling): an **ended** "Bandit
 * Camp", Mira and Thorn vs 3 Bandits (11 HP) and a hidden Bandit Captain (15 HP, hidden token on
 * Town), so the sim's running Ambush / Escort fights are untouched. Loads before session-sim-10's
 * Ambush starts (bundle `stats-b-past`, included first by session-sim-12: one started fight at a
 * time), on the same fixed clock (the past session). In log order:
 * - Mira → Bandit 25: kill, callout (`fell: "kill"`, overkill 14).
 * - Thorn → the hidden Captain 20: kill on a DM-only line (players: no line, no `fell`).
 * - Bandit 2 → Thorn 200: down (`fell: "down"`, callout); the DM heals him 10 (back to 10 / 10).
 * Then End (a `stats-fight-summary`, audience all) and the Captain's token is deleted. No companion
 * (the pets join in sim-10).
 * Expected, DM | players: kills Mira 1 | 1, Thorn 1 | 0; downs Thorn 1 | 1; Still standing (DM)
 * Bandit 2, Bandit 3.
 */
export default defineFixture({
  key: KEY,
  kind: "setup",
  requires: ["char-mira", "char-thorn", "town"],
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
    step(createEncounter, (r) => ({
      name: "Bandit Camp",
      partyCharacterIds: [r.id("char-mira", "entity"), r.id("char-thorn", "entity")],
      entries: [{ definitionId: r.id(KEY, "entity", 0), quantity: 3 }],
      createTokens: false,
      addHidden: false,
    })),
    step(startCommand, (r) => ({ encounterId: enc(r), sceneId: r.id("town", "scene") })),
    captain,
    hp("bandit", "damage", 25, "mira"),
    hp("captain", "damage", 20, "thorn"),
    hp("thorn", "damage", 200, "bandit2"),
    hp("thorn", "heal", 10),
    step(endCommand, (r) => ({ encounterId: enc(r) })),
    // The Captain's hidden token leaves Town (the sim's scenes stay as session-sim-11 left them).
    {
      command: MAP_INTENTS.deleteToken,
      input: (r: Refs) => ({ tokenId: r.id(KEY, TOKEN_TYPE) }),
    } satisfies SetupStep,
  ],
});
