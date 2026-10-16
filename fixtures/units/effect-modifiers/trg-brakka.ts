// biome-ignore-all lint/suspicious/noThenProperty: `then` is the rule's effect field (MOD §8.4); rules are data, never awaited.
import { putPresetWithUses } from "@server/features/effect-modifiers/commands";
import { putTrigger } from "@server/features/effect-modifiers/trigger-commands";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { builtinPreset } from "@shared/effect-modifiers/presets";
import { EFFECT_PRESET_TYPE } from "@shared/effect-modifiers/schemas";
import type { PutTriggerInput } from "@shared/effect-modifiers/trigger-intents";
import { ENTITY_TYPE } from "@shared/entities/schemas";

const rage = builtinPreset("rage");
if (!rage) throw new Error("trg-brakka: built-in rage missing");

/**
 * MOD §13 `trg-brakka`: Brakka's character preset "Rage" from `rage` (`originKey: rage`), off,
 * with `usesFeatureId` → her "Rage" feature row (tier 3: "Rage 3 / 3"; linked by name through
 * the internal `mod.putPresetWithUses`, a step can't read a row id); and "Divine Fury" as trigger
 * **data** (#209; no built-in, no subclass name): hit; requires that preset; via weapon, own turn;
 * once per turn; `1d6 + floor(level(barbarian) / 2)` radiant; public.
 */
export default defineFixture({
  key: "trg-brakka",
  kind: "setup",
  requires: ["char-brakka"],
  ownerSpec: "effect-modifiers",
  steps: [
    step(putPresetWithUses, (r) => ({
      preset: {
        characterId: r.id("char-brakka", ENTITY_TYPE),
        name: rage.name,
        modifiers: rage.modifiers,
        durationRounds: rage.durationRounds,
        concentration: rage.concentration,
        note: rage.note,
        originKey: "rage" as const,
      },
      usesFeature: "Rage",
    })),
    step(
      putTrigger,
      (r): PutTriggerInput => ({
        trigger: {
          characterId: r.id("char-brakka", ENTITY_TYPE),
          name: "Divine Fury",
          public: true,
          rule: {
            on: "hit",
            requires: { preset: r.id("trg-brakka", EFFECT_PRESET_TYPE) },
            when: [{ if: "via", via: "weapon" }, { if: "ownTurn" }],
            every: "turn",
            then: { do: "damage", formula: "1d6 + floor(level(barbarian) / 2)", type: "radiant" },
          },
        },
      }),
    ),
  ],
});
