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

- MVP: run one fight against **one kind of enemy** ([ADR-0014](../architecture/adr/0014-mvp-scope.md)).
- Initiative, turns/rounds, attack and damage rolls, HP tracking.
- Encounter builder, CR math, conditions, concentration → [combat-extras](post-mvp/combat-extras.md).

## 2. Scope

- Start combat: add PCs and N instances of one monster kind.
- Initiative: roll (click-to-roll) or enter; sorted order; ties.
- Rounds and turns: next/previous turn, current-turn highlight.
- Attack: single weapon attack per combatant (from [character-sheet](character-sheet.md) / monster basics).
- Damage and healing: apply to HP; down at 0.
- **Damage cards**: a player's attack + damage roll appears as a pending card for the DM; DM picks target and applies as normal / resistant / immune / vulnerable. DM can also create cards. Rolls may be automated or manual ([dice-roll-log](dice-roll-log.md)).
- Remove/defeat combatant; end combat.
- Player initiative view.
- Combatants linked to tokens on the active scene ([scenes-map](scenes-map.md)).

## 3. Goals

> TODO (spec phase).

## 4. Non-goals

- Encounter builder, CR/XP math, conditions, concentration, per-combatant hidden visibility (→ [combat-extras](post-mvp/combat-extras.md)).
- Player-ready / load indicator (→ [scene-tools](post-mvp/scene-tools.md)); MVP assumes immediate load.
- Rules automation (auto-hit vs AC, auto-apply damage).

## 5. User stories

> TODO (spec phase): DM and player stories.

## 6. Functional requirements

> TODO (spec phase): FR-CBT-NN.

## 7. UI/UX notes

> TODO (spec phase): DM combat panel; player initiative strip. Per [visual-direction](../design/visual-direction.md).

## 8. Data model

> TODO (spec phase): combat (round, current turn), combatant (entity ref, token ref, initiative, HP).

## 9. API & events

> TODO (spec phase). Visibility rule per event (monster HP to players).

## 10. Permissions

> TODO (spec phase): who may roll initiative / apply damage for a PC.

## 11. Edge cases & failure modes

> TODO (spec phase): crash mid-turn (must resume), combatant removed mid-round, token deleted, DM disconnect.

## 12. Performance & bandwidth

> TODO (spec phase).

## 13. Test plan

> TODO (spec phase): fixtures `player-1`, `enemy-1`, `battlemap` scene; crash-resume integration test; seeded dice. Isolated per [ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md).

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [entities](entities.md) | Monster basics, character ref | open |
| [character-sheet](character-sheet.md) | PC AC/HP/init/attack | open |
| [dice-roll-log](dice-roll-log.md) | Initiative, attack, damage rolls | open |
| [live-sync](live-sync.md) | Events, visibility | open |
| [scenes-map](scenes-map.md) | Token ↔ combatant binding | open |

## 15. Open questions

**Bold** option = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-CBT-02 | What do players see of monster HP? | **Health band (healthy/bloodied/down)** / nothing / exact | yes | live-sync |
| OQ-CBT-03 | PC HP source of truth | See [OQ-CHAR-02](character-sheet.md#15-open-questions) | yes | character-sheet |
| OQ-CBT-04 | Who applies damage? | **DM applies to anyone; player may apply to own PC** / DM only | no | character-sheet |
| OQ-CBT-05 | Monster initiative: individual or one roll for the group? | **One roll for the group (one kind only)** / individual | no | — |
| OQ-CBT-07 | Who picks the damage card target? | **Player picks (click token); DM confirms on apply** / DM only | yes | scenes-map |
| OQ-CBT-08 | Does the app compare attack roll vs AC? | **Shows hit/miss hint; DM decides** / no comparison / auto-resolve | no | — |
| OQ-CBT-09 | Do unapplied cards persist across crash/turn end? | **Yes, persisted until applied or dismissed** / expire at turn end | yes | live-sync |
| OQ-CBT-06 | Does combat start auto-create/bind tokens? | **No; bind existing tokens on the scene** / auto-place | no | scenes-map |

## 16. Out of scope

- See §4 Non-goals.
