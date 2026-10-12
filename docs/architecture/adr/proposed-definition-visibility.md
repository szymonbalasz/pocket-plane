# NNNN — Creature definitions are DM-only for players; instances carry player-visible data

- Status: proposed
- Date: 2026-10-12
- Affects: entities, scenes-map, combat-tracker, character-sheet, post-mvp/compendium
- Raised by: [OQ-ENT-05](../../specs/entities.md#15-open-questions)

## Context

- [ADR-0018](0018-global-imported-content.md) leaves per-field player visibility of definitions to [entities](../../specs/entities.md).
- Visibility fns read only the record and the connection ([ADR-0021](0021-sync-protocol-conventions.md), OQ-SYNC-08). A definition can't become visible "because a visible token points at it".
- Custom definitions are DM prep. Any player-visible field (even the name) of an unplaced "Elite Goblin Warrior" leaks what is coming.
- Players still need names, images and sizes of the tokens and combatants they can see.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Monster definitions hidden from players; characters: own full, others redacted; instances carry display name, image, size** | No prep leak; filters stay pure; instance reveal = definition-free | Instances denormalise a few display fields; size needs refreshing on edit |
| B. Monster definitions redacted to name/size | Instances stay thin | Leaks every prepared custom and its existence |
| C. Visibility fn may read related records (visible if a visible instance references it) | No denormalising | Reveal/hide must list dependent records; breaks OQ-SYNC-08 |

## Decision

> Undecided. Suggested: **A**.

## Consequences

- scenes-map and combat-tracker put every player-visible field on the instance record; player clients never read a monster definition.
- Monster stat block view for players (tier B) would need its own reveal record later.
- Character sheets of other players stay private (matches [OQ-CHAR-04](../../specs/character-sheet.md#15-open-questions) pick).
