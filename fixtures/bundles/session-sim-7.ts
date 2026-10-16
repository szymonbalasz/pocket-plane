import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint-3 gate (sprint-3 step 8): `session-sim` + every sprint-3 unit, stacked as patches (seams
 * S10). Order matters: `cmp-srd-mini` imports before `trg-monsters` pulls in `combat-1` (an
 * import refuses while an encounter runs, FR-CMP-07); combat last (round 1, Wolf's turn; Brakka
 * at initiative 17). Not here: `scenes-extras` (a second Thorn token on Goblin Ambush) and the
 * sprint-2 MOD units (`mod-bless`, `mod-bane`, `mod-rage`, `mod-tier2`).
 */
export default defineBundle({
  name: "session-sim-7",
  includes: ["session-sim"],
  fixtures: [
    // V: fog + walls + senses + darkness / Explored memory (FOG §13 `vision`)
    "fog-ambush",
    "scn-walls",
    "vision-senses",
    "vision-crypt",
    // D: dice looks + the clickable notation row (DICEX §13)
    "dicex-looks",
    "dicex-notation-text",
    // P: handouts + party inventory (PARTY §13)
    "handout-images",
    "handouts-1",
    "party-items-1",
    "party-second",
    // C: recorded SRD mini + homebrew (CMP §13)
    "cmp-srd-mini",
    "cmp-homebrew",
    "cmp-homebrew-second",
    // Combat before Brakka exists: Start would add her, then `trg-combat` conflicts
    "combat-1",
    // R: Brakka's Rage + Divine Fury, Thorn's Sneak Attack, monster triggers, combat (MOD §13)
    "char-brakka",
    "trg-brakka",
    "trg-thorn",
    "trg-monsters",
    "trg-combat",
  ],
});
