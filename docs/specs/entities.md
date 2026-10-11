---
title: Entities (core)
prefix: ENT
status: unclaimed
owner: —
wave: 2
---

# Entities (core)

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md).

## 1. Summary

- The minimal entity layer MVP needs: **characters** and **monsters** that tokens and combatants point at.
- No world-builder UI in MVP ([ADR-0014](../architecture/adr/0014-mvp-scope.md)). NPCs, locations, factions, quests, search and cross-refs → [world-builder](post-mvp/world-builder.md).
- The model chosen here must accommodate those later kinds ([ADR-0009](../architecture/adr/0009-entity-content-model.md)).

## 2. Scope

- Entity kinds in MVP: `character`, `monster`.
- Name, portrait (via [assets-pipeline](assets-pipeline.md)), kind-specific basics (see [character-sheet](character-sheet.md); monster stat basics: AC, HP, initiative bonus, one attack, **CR and XP** for the encounter builder).
- Created primarily by fixtures ([fixtures-adapters](fixtures-adapters.md)).
- DM can view and edit; minimal create/edit UI *(proposed)*.
- Character owned by a player ([campaign-management](campaign-management.md)).

## 3. Goals

> TODO (spec phase).

## 4. Non-goals

- World-builder kinds, search, cross-references, location ↔ scenes (→ [world-builder](post-mvp/world-builder.md)).
- Compendium clone/import (→ [compendium](post-mvp/compendium.md)).

## 5. User stories

> TODO (spec phase): DM and player stories.

## 6. Functional requirements

> TODO (spec phase): FR-ENT-NN.

## 7. UI/UX notes

> TODO (spec phase): minimal entity list + edit form for DM; player sees own character via [character-sheet](character-sheet.md). Per [visual-direction](../design/visual-direction.md).

## 8. Data model

> TODO (spec phase): blocked on [ADR-0009](../architecture/adr/0009-entity-content-model.md). Monster stat basics shape shared with [combat-tracker](combat-tracker.md).

## 9. API & events

> TODO (spec phase). Visibility rule per event.

## 10. Permissions

> TODO (spec phase).

## 11. Edge cases & failure modes

> TODO (spec phase): delete entity bound to a token/combatant, edit during combat.

## 12. Performance & bandwidth

> TODO (spec phase).

## 13. Test plan

> TODO (spec phase): fixtures `player-1` (character) and `enemy-1` (monster) from [fixtures-adapters](fixtures-adapters.md). Isolated per [ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md).

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [ADR-0009](../architecture/adr/0009-entity-content-model.md) | Content model | proposed |
| [campaign-management](campaign-management.md) | Campaign scope, player ownership | open |
| [live-sync](live-sync.md) | Event/visibility conventions | open |
| [assets-pipeline](assets-pipeline.md) | Portraits | open |
| [fixtures-adapters](fixtures-adapters.md) | How entities are seeded | open |

## 15. Open questions

**Bold** option = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-ENT-01 | Content model | See [ADR-0009](../architecture/adr/0009-entity-content-model.md) | yes | character-sheet, combat-tracker, fixtures-adapters |
| OQ-ENT-02 | Monster: one entity per kind ("Goblin") spawning many combatants, or one entity per individual? | **One entity per kind; combatants/tokens are instances** / one per individual | yes | combat-tracker, scenes-map |
| OQ-ENT-03 | Any create/edit UI in MVP, or fixtures only? | **Minimal DM edit form; create via fixtures** / fixtures only / full CRUD | no | fixtures-adapters |
| OQ-ENT-04 | Do characters and monsters share the "basics" shape (AC, HP, init, attack)? | **Yes, one shared combat-basics block** / separate | yes | character-sheet, combat-tracker |

## 16. Out of scope

- See §4 Non-goals.
