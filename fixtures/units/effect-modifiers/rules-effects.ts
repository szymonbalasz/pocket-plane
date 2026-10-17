import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";
import { loadInProcess } from "@server/features/fixtures-adapters/loader";
import { library } from "../../index";

/**
 * MOD §13.1 bundle `rules-effects` = `rule-triggers` + `weapon-flame-tongue` + `mod-fire-ward` +
 * `uses-rage-spent` + `trg-mira-uses`, for tests until S4-4 registers it in
 * `fixtures/bundles/index.ts` (append-only) and moves it there.
 */
export const RULES_EFFECTS = defineBundle({
  name: "rules-effects",
  includes: ["rule-triggers"],
  fixtures: [
    "char-mira-full",
    "weapon-flame-tongue",
    "mod-fire-ward",
    "uses-rage-spent",
    "trg-mira-uses",
  ],
});

/** In-process load of `rules-effects` (`bun test` only, FR-FIX-11). */
export const loadRulesEffects = (opts: { testMode?: boolean; dmSecret?: string } = {}) =>
  loadInProcess(
    { ...library, bundles: [...library.bundles, RULES_EFFECTS] },
    RULES_EFFECTS.name,
    opts,
  );
