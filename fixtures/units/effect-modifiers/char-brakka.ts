import { charCreate } from "@server/features/character-sheet/lifecycle";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { placeToken } from "@server/features/scenes-map/commands";
import type { CharCreateIntent } from "@shared/character-sheet/sheet";
import { editStep, entityOf, putRowStep } from "../character-sheet-full/steps";

const brakka = (r: Parameters<typeof entityOf>[0]) => entityOf(r, "char-brakka");

/**
 * MOD §13 `char-brakka` (R-owned): "Brakka", owner `player-1`: Barbarian 5 (d12; no subclass,
 * #209 / R11), STR 18, AC 14, HP 55, init +1; attack Greataxe +7 / 1d12+4 slashing; features
 * "Rage" (3 uses, long) and "Divine Fury"; token on the battlemap (owner's character token).
 */
export default defineFixture({
  key: "char-brakka",
  kind: "setup",
  requires: ["player-1", "battlemap"],
  ownerSpec: "effect-modifiers",
  steps: [
    step(
      charCreate,
      (r): CharCreateIntent => ({ name: "Brakka", ownerPlayerId: r.id("player-1", "player") }),
    ),
    editStep((r) => ({
      creatureId: brakka(r),
      set: {
        classes: [{ name: "Barbarian", level: 5, hitDie: "d12" }],
        ac: 14,
        hpMax: 55,
        initBonus: 1,
        speed: 30,
        abilities: { str: 18, dex: 12, con: 16, int: 8, wis: 12, cha: 10 },
        saveProficiencies: ["str", "con"],
      },
    })),
    putRowStep((r) => ({
      creatureId: brakka(r),
      list: "attacks",
      row: { name: "Greataxe", toHit: 7, damage: "1d12+4", damageType: "slashing" },
    })),
    putRowStep((r) => ({
      creatureId: brakka(r),
      list: "features",
      row: { name: "Rage", source: "Barbarian 1", usesMax: 3, reset: "long" },
    })),
    putRowStep((r) => ({
      creatureId: brakka(r),
      list: "features",
      row: { name: "Divine Fury", source: "Barbarian 3" },
    })),
    step(placeToken, (r) => ({
      sceneId: r.id("battlemap", "scene"),
      definitionId: brakka(r),
      col: 3,
      row: 8,
    })),
  ],
});
