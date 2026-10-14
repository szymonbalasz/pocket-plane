import { defineFixture } from "@server/features/fixtures-adapters/fixture-types";
import { editStep, entityOf, putRowStep } from "./steps";

/**
 * Mira's full sheet (CHARX §13): Fighter 1 d10, Human, Athletics + Perception, override
 * `passive.perception` 14 "Alert (test)"; 2nd attack Light crossbow; features Second Wind
 * (1 use, short) + Fighting Style; items Shortsword, Light crossbow, Bolts ×20; "MIRA-NOTE-7".
 */
export default defineFixture({
  key: "char-mira-full",
  kind: "setup",
  requires: ["char-mira"],
  ownerSpec: "character-sheet-full",
  steps: [
    editStep((r) => ({
      creatureId: entityOf(r, "char-mira"),
      set: {
        classes: [{ name: "Fighter", level: 1, hitDie: "d10" }],
        species: "Human",
        skills: { athletics: "proficient", perception: "proficient" },
        overrides: { "passive.perception": { value: 14, note: "Alert (test)" } },
        notes: "MIRA-NOTE-7",
      },
    })),
    putRowStep((r) => ({
      creatureId: entityOf(r, "char-mira"),
      list: "attacks",
      row: { name: "Light crossbow", toHit: 4, damage: "1d8+2", damageType: "piercing" },
    })),
    putRowStep((r) => ({
      creatureId: entityOf(r, "char-mira"),
      list: "features",
      row: {
        name: "Second Wind",
        source: "Fighter 1",
        text: "Bonus action: regain 1d10 + your fighter level in HP.",
        usesMax: 1,
        reset: "short",
      },
    })),
    putRowStep((r) => ({
      creatureId: entityOf(r, "char-mira"),
      list: "features",
      row: { name: "Fighting Style", source: "Fighter 1", text: "Defence: +1 AC in armour." },
    })),
    ...[
      { name: "Shortsword", qty: 1, equipped: true },
      { name: "Light crossbow", qty: 1, equipped: true },
      { name: "Bolts", qty: 20, equipped: false },
    ].map((row) =>
      putRowStep((r) => ({ creatureId: entityOf(r, "char-mira"), list: "items", row })),
    ),
  ],
});
