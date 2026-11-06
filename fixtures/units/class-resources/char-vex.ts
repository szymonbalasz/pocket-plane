// biome-ignore-all lint/suspicious/noThenProperty: `then` is the rule's effect field (MOD §8.4); rules are data, never awaited.
import { charCreate } from "@server/features/character-sheet/lifecycle";
import { putTrigger } from "@server/features/effect-modifiers/trigger-commands";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import type { CharCreateIntent } from "@shared/character-sheet/sheet";
import type { PutTriggerInput } from "@shared/effect-modifiers/trigger-intents";
import { editStep, entityOf, putRowStep } from "../character-sheet-full/steps";

const vex = (r: Parameters<typeof entityOf>[0]) => entityOf(r, "char-vex");

/**
 * class-resources §13 `char-vex`: "Vex", owner `player-1`, Sorcerer 5 / Warlock 2, CHA 18;
 * slots 1st ×4, 2nd ×3, 3rd ×2 and 2 pact slots of 1st level (FR-CRES-01); attacks "Pact blade"
 * (pact weapon, FR-CRES-14) and "Dagger"; feature "Font of Magic" (5 uses, long); trigger "Smite"
 * (hit with a pact weapon, the DM checks, once per turn, 2d8 force; FR-CRES-15).
 */
export default defineFixture({
  key: "char-vex",
  kind: "setup",
  requires: ["player-1"],
  ownerSpec: "class-resources",
  steps: [
    step(
      charCreate,
      (r): CharCreateIntent => ({ name: "Vex", ownerPlayerId: r.id("player-1", "player") }),
    ),
    editStep((r) => ({
      creatureId: vex(r),
      set: {
        classes: [
          { name: "Sorcerer", level: 5, hitDie: "d6" },
          { name: "Warlock", level: 2, hitDie: "d8" },
        ],
        ac: 13,
        hpMax: 45,
        initBonus: 2,
        speed: 30,
        abilities: { str: 8, dex: 14, con: 14, int: 10, wis: 10, cha: 18 },
        saveProficiencies: ["con", "cha"],
        spellcasting: {
          ability: "cha",
          slots: { "1": 4, "2": 3, "3": 2 },
          pact: { level: 1, slots: 2 },
        },
      },
    })),
    putRowStep((r) => ({
      creatureId: vex(r),
      list: "attacks",
      row: {
        name: "Pact blade",
        toHit: 7,
        damage: "1d8+4",
        damageType: "slashing",
        pactWeapon: true,
      },
    })),
    putRowStep((r) => ({
      creatureId: vex(r),
      list: "attacks",
      row: { name: "Dagger", toHit: 5, damage: "1d4+2", damageType: "piercing" },
    })),
    putRowStep((r) => ({
      creatureId: vex(r),
      list: "features",
      row: { name: "Font of Magic", source: "Sorcerer 2", usesMax: 5, reset: "long" },
    })),
    step(
      putTrigger,
      (r): PutTriggerInput => ({
        trigger: {
          characterId: vex(r),
          name: "Smite",
          public: true,
          rule: {
            on: "hit",
            when: [{ if: "pactWeapon" }, { if: "ask", note: "Spend a pact slot?" }],
            every: "turn",
            then: { do: "damage", formula: "2d8", type: "force" },
          },
        },
      }),
    ),
  ],
});
