---
title: Character sheet (basics)
prefix: CHAR
status: unclaimed
owner: —
wave: 2
---

# Character sheet (basics)

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md).

## 1. Summary

- MVP sheet: just enough for a fight ([ADR-0014](../architecture/adr/0014-mvp-scope.md)).
- Player views their own character; click-to-roll initiative and weapon attack/damage via [dice-roll-log](dice-roll-log.md).
- Full 5e sheet is the target → [character-sheet-full](post-mvp/character-sheet-full.md). Data model must not block it.

## 2. Scope

- Name, portrait, **level** (needed for encounter difficulty).
- Armour Class.
- HP: current / max. (Temp HP, death saves → [combat-extras](post-mvp/combat-extras.md), tier A.)
- Initiative bonus.
- One weapon attack: name, to-hit bonus, damage dice (e.g. shortsword, 1d6). May be hardcoded per fixture.
- Click-to-roll: initiative, attack, damage. Advantage/disadvantage per [dice-roll-log](dice-roll-log.md).
- Ability scores *(proposed: stored for display only, if cheap)*.

## 3. Goals

> TODO (spec phase).

## 4. Non-goals

- Spells, saves, skills, features, inventory, currency, proficiencies, hit dice, notes; roll from any number (→ [character-sheet-full](post-mvp/character-sheet-full.md), tiers in [feature tiers](../feature-tiers.md#3-character-sheet-and-dice)).
- Levelling, guided creation (→ [levelling](post-mvp/levelling.md)).

## 5. User stories

> TODO (spec phase): DM and player stories.

## 6. Functional requirements

> TODO (spec phase): FR-CHAR-NN.

## 7. UI/UX notes

> TODO (spec phase): compact sheet panel; roll buttons. DM view (any character) vs player view (own). Per [visual-direction](../design/visual-direction.md).

## 8. Data model

> TODO (spec phase): basics fields; depends on [ADR-0009](../architecture/adr/0009-entity-content-model.md) and the basics slice of [ADR-0012](../architecture/adr/0012-character-derived-values.md).

## 9. API & events

> TODO (spec phase). Visibility rule per event.

## 10. Permissions

> TODO (spec phase): player edits own character only? (server ownership check, [ADR-0004](../architecture/adr/0004-tenancy-auth-permissions.md)).

## 11. Edge cases & failure modes

> TODO (spec phase): HP changed by combat while sheet open, disconnect mid-roll.

## 12. Performance & bandwidth

> TODO (spec phase).

## 13. Test plan

> TODO (spec phase): fixture `player-1` (e.g. L1 fighter, shortsword 1d6). Isolated per [ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md).

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [ADR-0012](../architecture/adr/0012-character-derived-values.md) | Basics: derived vs stored | proposed |
| [entities](entities.md) | Character as entity kind | open |
| [dice-roll-log](dice-roll-log.md) | Roll API | open |
| [combat-tracker](combat-tracker.md) | HP sync with combatant | open |

## 15. Open questions

**Bold** option = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-CHAR-01 | Basics: stored or derived? | **Stored in MVP (AC, init bonus, to-hit typed in); derivation post-MVP** / derive from ability scores now. See [ADR-0012](../architecture/adr/0012-character-derived-values.md) | yes | combat-tracker |
| OQ-CHAR-02 | Source of truth for PC HP: character or combatant? | **Character; combatant references it** / combatant copies | yes | combat-tracker |
| OQ-CHAR-03 | Can players edit their own sheet in MVP? | **HP only; rest via fixtures/DM** / all basics / none | no | — |
| OQ-CHAR-04 | Can players see each other's sheets? | **No in MVP; HP visible via initiative view** / read-only | no | live-sync, combat-tracker |

## 16. Out of scope

- See §4 Non-goals.
