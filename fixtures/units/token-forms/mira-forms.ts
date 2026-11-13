import { ingestStep } from "@server/features/assets-pipeline/fixtures";
import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { putForms, putPresetWithForm } from "@server/features/token-forms/commands";
import { builtinPreset } from "@shared/effect-modifiers/presets";
import { ENTITY_TYPE } from "@shared/entities/schemas";

const rage = builtinPreset("rage");
if (!rage) throw new Error("mira-forms: built-in rage missing");

/** FORM §13: the form names tests hard-code. */
export const MIRA_FORMS = { raging: "Raging", enlarged: "Enlarged", rage: "Rage" } as const;

/**
 * FORM §13 `mira-forms`: two token images (`mira-raging.svg`, asset 0; `mira-enlarged.svg`,
 * asset 1, tagged Tokens), Mira's forms Raging and Enlarged, and her character preset "Rage"
 * (from `rage`, off) linked to Raging.
 */
export default defineFixture({
  key: "mira-forms",
  kind: "setup",
  requires: ["char-mira"],
  ownerSpec: "token-forms",
  assets: ["tokens/mira-raging.svg", "tokens/mira-enlarged.svg"],
  steps: [
    ingestStep("tokens/mira-raging.svg", { name: "Mira raging", tags: ["Tokens"] }),
    ingestStep("tokens/mira-enlarged.svg", { name: "Mira enlarged", tags: ["Tokens"] }),
    step(putForms, (r) => ({
      characterId: r.id("char-mira", ENTITY_TYPE),
      forms: [
        { name: MIRA_FORMS.raging, imageAssetId: r.id("mira-forms", "asset", 0) },
        { name: MIRA_FORMS.enlarged, imageAssetId: r.id("mira-forms", "asset", 1) },
      ],
    })),
    step(putPresetWithForm, (r) => ({
      form: MIRA_FORMS.raging,
      preset: {
        characterId: r.id("char-mira", ENTITY_TYPE),
        name: MIRA_FORMS.rage,
        modifiers: rage.modifiers,
        durationRounds: rage.durationRounds,
        concentration: rage.concentration,
        note: rage.note,
        originKey: "rage" as const,
      },
    })),
  ],
});
