import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";

/**
 * Kit parity §13 `kit-parity` (K6 parity walkthrough, FR-KIT-94; K7 walkthrough + e2e
 * `kit-statblock`): one world that shows every kit section at once. `theme-gilt` (round 3, Wolf's
 * turn, 6 combatants incl. the Goblin and the Elite Goblin, `rolls-1`'s log lines incl. the DM's
 * hidden roll) + each track's units, existing units only (no new record type). Append-only: a
 * track adds its line(s) under its own comment; keep both sides on a merge.
 */
export default defineBundle({
  name: "kit-parity",
  includes: ["theme-gilt"],
  fixtures: [
    // K1 (Game log rows): Mira's crit attack, damage and heal as player-1.
    "kit-log-rolls",
    // K2 (Initiative rows): Mira hit to 6 / 12, the Elite's pending damage card (a DM notice),
    // Mira concentrating + the Goblin prone, temp HP.
    "combat-hit",
    "combat-pending",
    "cbtx-effects",
    "cbtx-temp",
    // K4 (compendium table, Party status cards): the SRD mini set (Goblin, Wolf, …), Mira's pet
    // Owlbear.
    "cmp-srd-mini",
    "cp-srd",
    "pet-owlbear",
    // K7 (stat block window): the Goblin combatant (theme-gilt) opens bound from Initiative ⋯ or
    // its token; the compendium's Goblin (cmp-srd-mini) opens with "Open at the table". No unit.
    // K3 (notices, damage card): Mira's crossbow card applied on Goblin 2 (the player card
    // view); Player 2's draft "Bram" (the DM's request card) and Mira's pending crossbow card.
    "kit-notices-applied",
    "kit-notices",
    // K9 (polish: Initiative bars / pending lines, toasts, Notifications window): the DM's open
    // Perception request (DC hidden), so player-1 loads with the roll-request toast (Roll + Decline)
    // and the Notifications windows hold a pending prompt beside the history.
    "dicex-request-open",
  ],
});
