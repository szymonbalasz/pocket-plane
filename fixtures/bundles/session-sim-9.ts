import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint-5 gate (sprint-5 step 8) and the DM's "everything on main" bundle: `session-sim-8` + the
 * sprint-5 units, stacked as patches like sim-8 did. Starts as sim-8; each sprint-5 slice that adds
 * a unit the gate needs appends it to its track's group below in the same branch (keep both lines
 * on a merge). Not here: `win-layout` (pre-creates sim-8's live "Crypt" and turns Rage on, review-a
 * #25).
 */
export default defineBundle({
  name: "session-sim-9",
  includes: ["session-sim-8"],
  fixtures: [
    // W: windows + layout
    // D: dice polish
    // D10: no new unit (the tray preview walks on sim-7's `dicex-looks`)
    // D11: no new unit (the popup line walks on any roll; DICEX §13 uses `dice-polish`)
    // R: late damage, trails, ally side
    // R1: a ruled card in its damage step (Mira → Goblin 2, waiting for damage)
    "late-hit-ruled",
    // R4: planned "Escort to the Ford", Goblin ×2 + 1 friendly (the Friendly switch, A3)
    "enc-friendly",
    // R2: no new unit (L12–L14 walk on rules-effects' Brakka, Thorn and Fire Ward)
    // R3: this turn's moves (Mira ×2, Thorn ×1, Goblin ×1), stored on the tokens as trails
    "trail-moves",
    // P: Loot tab, handouts, uploads + paste, Add to party
    // P0: h6 "Ransom Note" with an attachment (unshared); h2 presented to player-1 (S5-1)
    "handout-attachment",
    "handout-present-1",
    // P4: no new unit (Add to party walks on sim-7's `party-items-1` + `cmp-srd-mini`)
    // C: compendium images
    // C5 core: "Moonlit Lantern" (shared, 2 attachment images), "CMP-IMG-SECRET" (DM only, 1)
    "cmp-images",
    // K: player colours, kept-template menu
    // K0: Player 2 picks blue (Player 1 jade, DM amber by default)
    "pc-colours",
  ],
});
