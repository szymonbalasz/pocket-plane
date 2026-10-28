import { defineFixture, step } from "@server/features/fixtures-adapters/fixture-types";
import { setEffectFx } from "@server/features/spell-fx/commands";
import { EFFECT_TYPE } from "@shared/combat-extras/schemas";

/**
 * VFX §13 visual baselines (`visual-kit`): the two auras on existing effects, so nothing else in
 * the world changes: Mira's concentration "Bless" (`cbtx-effects`' first effect) draws Spirit
 * Guardians (radiant, 15 ft), Thorn's "Marked" (its last) Shadow of Moil (10 ft). The DM sets
 * them (FR-VFX-09); no spell row, no `spellId`.
 */
export default defineFixture({
  key: "vfx-visual-auras",
  kind: "setup",
  requires: ["cbtx-effects"],
  ownerSpec: "spell-fx",
  steps: [
    step(setEffectFx, (r) => ({
      effectId: r.id("cbtx-effects", EFFECT_TYPE, 0),
      fx: { preset: "spirit-guardians", params: { variant: "radiant", radiusFt: 15 } },
    })),
    step(setEffectFx, (r) => ({
      effectId: r.ids("cbtx-effects", EFFECT_TYPE).at(-1) as string,
      fx: { preset: "shadow-of-moil", params: { radiusFt: 10 } },
    })),
  ],
});
