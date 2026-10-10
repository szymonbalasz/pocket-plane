---
title: Combat tracker
prefix: CBT
status: unclaimed
owner: —
wave: 3
---

# Combat tracker

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md).

## 1. Summary

- Replaces Shieldmaiden.
- Encounter builder with CR math; running combat with initiative, HP, conditions, concentration.
- Per-combatant visibility; player initiative view.

## 2. Scope

- Encounter builder: add monsters (compendium/entities) and PCs; CR/difficulty math.
- Start combat from an encounter.
- Initiative: roll/enter, order, rounds, turns.
- HP (damage/heal/temp), conditions, concentration.
- Per-combatant visibility (hidden from players until revealed).
- Player initiative view.
- Link combatants to tokens on the active scene ([scenes-map](scenes-map.md)).

## 3. Goals

> TODO (spec phase).

## 4. Non-goals

> TODO (spec phase).

## 5. User stories

> TODO (spec phase): DM and player stories.

## 6. Functional requirements

> TODO (spec phase): FR-CBT-NN.

## 7. UI/UX notes

> TODO (spec phase): encounter builder, DM combat panel, player initiative strip. DM vs player view. Per [visual-direction](../design/visual-direction.md) (portrait strip is a long-term motif).

## 8. Data model

> TODO (spec phase): encounter, combat, combatant (HP, conditions JSON leaf, concentration, initiative, visibility). Derived: XP budget, difficulty.

## 9. API & events

> TODO (spec phase). Visibility rule per event (monster HP, hidden combatants).

## 10. Permissions

> TODO (spec phase).

## 11. Edge cases & failure modes

> TODO (spec phase): crash mid-turn, combatant removed mid-round, initiative ties, token deleted while combatant exists, DM disconnect during combat.

## 12. Performance & bandwidth

> TODO (spec phase).

## 13. Test plan

> TODO (spec phase): fixture encounter (party of 4 vs goblins), CR math unit tests, crash-resume integration test. Isolated per [ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md).

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [entities](entities.md) | Monsters/NPCs/characters as combatant sources | open |
| [compendium](compendium.md) | SRD monsters, conditions | open |
| [character-sheet](character-sheet.md) | PC HP/AC/initiative bonus | open |
| [dice-roll-log](dice-roll-log.md) | Initiative and damage rolls | open |
| [live-sync](live-sync.md) | Visibility filter | open |
| [scenes-map](scenes-map.md) | Token ↔ combatant binding | open |

## 15. Open questions

**Bold** option = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-CBT-01 | CR/difficulty math | **2014 DMG XP thresholds + multiplier** / simplified CR sum | yes | — |
| OQ-CBT-02 | What do players see of monster HP? | **Health band (healthy/bloodied/down)** / nothing / exact | yes | live-sync |
| OQ-CBT-03 | HP source of truth for PCs | See [OQ-CHAR-02](character-sheet.md#15-open-questions) | yes | character-sheet |
| OQ-CBT-04 | Monster initiative: individual or grouped by type? | **DM chooses per encounter** / always individual | no | — |
| OQ-CBT-05 | Can players apply damage/conditions to themselves? | **Own PC only** / DM only | no | character-sheet |
| OQ-CBT-06 | Concentration prompt on damage: auto-roll or reminder? | **Reminder with DC shown, click-to-roll** / auto-roll | no | dice-roll-log |
| OQ-CBT-07 | Multiple simultaneous combats? | **One active combat per campaign** / many | no | scenes-map |

## 16. Out of scope

- Automated rules resolution (attack vs AC auto-hit, auto-damage).
- Lighting/vision-based visibility ([ADR-0007](../architecture/adr/0007-product-scope.md)).
