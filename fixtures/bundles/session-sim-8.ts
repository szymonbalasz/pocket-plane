import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint-4 gate (sprint-4 step 8): `session-sim-7` + the sprint-4 units the gate run needs, stacked
 * as patches (seams S10). Every unit is a patch on sim-7's records, so the order only follows
 * `requires`; combat stays as sim-7 left it (round 1, Wolf's turn), the R units patch it in place.
 * Party vision off at load (no `fog_settings` row; the gate switches it live). The C units use the
 * SRD mini (it holds Potion of Healing; `cmp-srd-full` adds ≈ 1,150 rows and ≈ 1.2 s for nothing
 * the gate walks). Not here: `mt-crowd` (needs `scenes-extras`: a second Thorn token on Goblin
 * Ambush's (2, 9), a folder and the Cellar; the gate drags existing tokens), `art-update-tokens`
 * (needs the sprint-3 `cmp-srd-mini-s3` import, a second version of the same source),
 * `vision-legacy` (zeroes Mira's and Thorn's senses; for the `fog` bundle), `vision-invisible`
 * (an invisible Goblin 2 mid-combat), `rolls-1` (dice looks and the popup need no history).
 * Landing slices append their units to their track's group below.
 */
export default defineBundle({
  name: "session-sim-8",
  includes: ["session-sim-7"],
  fixtures: [
    // V: Brakka gets senses (ends "No vision set for: Brakka"); brush, pan, party vision are live
    "vision-brakka",
    // M: freeform Thunderwave (8 golden squares) + Web on Goblin Ambush; drag path walked live
    "mt-templates",
    // C: "potion heal" ranking (homebrew DM-only Potion of Healing + shared Healing Draught) and
    // monster token art on Goblin Ambush rows 1–3 (both on the SRD mini)
    "cmp-search-homebrew",
    "ent-art-tokens",
    // R: Flame Tongue +1 (two damage types), Fire Ward on Goblin (pulls `mod-presets`), Rage
    // 0 / 3 left (the next toggle overspends), Mira's Searing Strike `feature` trigger
    "weapon-flame-tongue",
    "mod-fire-ward",
    "uses-rage-spent",
    "trg-mira-uses",
  ],
});
