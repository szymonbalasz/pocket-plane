import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Sprint-6 gate and the DM's "everything on main" bundle (seams S12): `session-sim-9` + the
 * sprint-6 units, stacked as patches like sim-9 did. Created by IM-1 (first in the schema lane);
 * each sprint-6 slice that adds a unit the gate needs appends it to its track's group below in the
 * same branch (keep both lines on a merge). Every unit loads on top of sim-9's running encounter.
 */
export default defineBundle({
  name: "session-sim-10",
  includes: ["session-sim-9"],
  fixtures: [
    // IM: image search + tags
    // IM-1: 24 tagged library images + 2 attachments (Ruined Keep holds the DM tag `zz-lair-secret`)
    "image-tags",
    // WF: window + layout fix pack
    // WF2: no new unit (the toast home walks on sim-9's ruled card summary, Scenes and the Fog tool)
    // WF3: no new unit (Fit, pcs pan and the reveal refit walk on sim-9's Goblin Ambush: door
    // (8, 5), party vision, the hidden Elite and Wolf)
    // PF: Preferences, free colour, Subtract
    // PF0: Player 2 lavender `#b388ff` (one DM `camp.setColor`; Blue and Sky blocked for Player 1)
    "pc-colour-free",
    // CP: companions + summons
    // CP0: the SRD Owlbear and Fire Elemental (imported, DM-only; CP1 / CP3 add the pets and the fight)
    "cp-srd",
    // CP1: Mira's Owlbear (45 / 59) and Brakka's Drake Companion, tokens beside their owners
    "pet-owlbear",
    "pet-drake",
    // CP3: both pets join sim-9's running ambush (combat-extras' Add with their tokens);
    // Fire Elementals for Mira (after her), Brakka (in her turn), Thorn (own 9, linked concentration)
    "cp-combat",
  ],
});
