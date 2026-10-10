---
title: Character sheet
prefix: CHAR
status: unclaimed
owner: —
wave: 3
---

# Character sheet

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md).

## 1. Summary

- Full 5e (2014) character sheet from day one ([ADR-0007](../architecture/adr/0007-product-scope.md)).
- Player-editable for their own character; DM can edit any.
- Click-to-roll via [dice-roll-log](dice-roll-log.md).

## 2. Scope

- Abilities, skills, saving throws.
- AC, HP (current/max/temp), speed, hit dice.
- Spells and spell slots.
- Features and traits.
- Attacks.
- Inventory and currency.
- Proficiencies (armour, weapons, tools, languages).
- Notes.
- Click-to-roll for checks, saves, attacks, damage, spells.

## 3. Goals

> TODO (spec phase).

## 4. Non-goals

> TODO (spec phase).

## 5. User stories

> TODO (spec phase): DM and player stories.

## 6. Functional requirements

> TODO (spec phase): FR-CHAR-NN.

## 7. UI/UX notes

> TODO (spec phase): sheet layout (tabs vs single page), edit vs play mode, roll affordances. DM vs player view (DM viewing a player's sheet). Per [visual-direction](../design/visual-direction.md).

## 8. Data model

> TODO (spec phase): blocked on [ADR-0012](../architecture/adr/0012-character-derived-values.md) and [ADR-0009](../architecture/adr/0009-entity-content-model.md).

## 9. API & events

> TODO (spec phase). Visibility rule per event (can other players see my sheet?).

## 10. Permissions

> TODO (spec phase): player edits own character only (server ownership check, [ADR-0004](../architecture/adr/0004-tenancy-auth-permissions.md)).

## 11. Edge cases & failure modes

> TODO (spec phase): player and DM edit same field, HP changed by combat tracker while sheet open, disconnect mid-edit.

## 12. Performance & bandwidth

> TODO (spec phase).

## 13. Test plan

> TODO (spec phase): fixture characters (e.g. L1 fighter, L5 wizard with slots, multiclass?). Derivation unit tests. Isolated per [ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md).

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [ADR-0012](../architecture/adr/0012-character-derived-values.md) | Derived vs stored | proposed |
| [entities](entities.md) | Character as entity kind | open |
| [compendium](compendium.md) | Spells/items to add to sheet | open |
| [dice-roll-log](dice-roll-log.md) | Roll API | open |
| [combat-tracker](combat-tracker.md) | HP/condition sync with combatant | open |

## 15. Open questions

**Bold** option = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-CHAR-01 | Derived vs stored; homebrew overrides | See [ADR-0012](../architecture/adr/0012-character-derived-values.md) | yes | combat-tracker, dice-roll-log |
| OQ-CHAR-02 | Single source of truth for HP/conditions: character or combatant? | **Character for PCs; combatant references it** / combatant copies | yes | combat-tracker |
| OQ-CHAR-03 | Can players see each other's sheets? | **Summary only (name, portrait, HP band)** / full read-only / none | no | live-sync |
| OQ-CHAR-04 | Multiclassing in MVP? | **Data model supports it; UI basic** / single class only | no | post-mvp/levelling |
| OQ-CHAR-05 | Character creation flow in MVP | **Manual entry** / guided builder (→ [levelling](post-mvp/levelling.md)) | no | post-mvp/levelling |

## 16. Out of scope

- Levelling workflows, guided creation → [levelling](post-mvp/levelling.md).
- Non-5e systems.
