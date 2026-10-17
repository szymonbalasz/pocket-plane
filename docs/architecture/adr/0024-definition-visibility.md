# 0024 — Creature definitions DM-only for players; instances carry read-only display copies

- Status: accepted (2026-10-12; decisions-log #120). Other-player character whitelist refined by [ADR-0036](0036-full-sheet-derivation.md) (#178)
- Refined by [ADR-0050](0050-token-creature-type.md) (token `creatureType` display copy; sprint 4)
- Date: 2026-10-12
- Refines: [ADR-0009](0009-entity-content-model.md) (instance field list)
- Affects: entities, scenes-map, combat-tracker, character-sheet, post-mvp/compendium; ADR-0009 (refines instance fields); [ADR-0018](0018-global-imported-content.md) (answers its per-field visibility rules)
- Raised by: [OQ-ENT-05](../../specs/entities.md#15-open-questions), [OQ-ENT-09](../../specs/entities.md#15-open-questions)

## Context

- ADR-0018 leaves per-field player visibility of definitions to [entities](../../specs/entities.md).
- Visibility fns read only the record and the connection context ([ADR-0021](0021-sync-protocol-conventions.md) Decision). A definition can't become visible "because a visible token points at it".
- Custom definitions are DM prep. Any player-visible field (even the name) of an unplaced "Elite Goblin Warrior" leaks what is coming.
- Players still need names, images and sizes of the tokens and combatants they can see.
- ADR-0009 says instances hold only display name, play state and modifiers, and edits reach instances through the live link.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Monster definitions hidden from players; characters: own full, others redacted; instances carry read-only display copies** | No prep leak; filters stay pure; instance reveal needs no definition | Instances denormalise a few display fields; every definition edit must refresh them |
| B. Monster definitions redacted to name/size | Instances stay thin | Leaks every prepared custom and its existence |
| C. Visibility fn may read related records (visible if a visible instance references it) | No denormalising | Contradicts accepted ADR-0021 Decision ("Visibility fns read only the record and the connection context"); needs a superseding ADR; reveal/hide must list dependent records |
| D. `playerVisible` flag on the definition, set in-transaction by place/reveal commands; player view redacted to name/size/portrait | No display copies; filter stays pure | Instance commands write definitions and must ref-count across instances; once one instance of a shared definition is revealed, its other hidden instances leak the name |

## Decision

**A** (DM, #120):

- Players never receive monster definitions (custom or imported). Own character: full. Other characters: `{id, kind, name, portraitAssetId, ownerPlayerId}`.
- Tokens carry read-only copies of display name, image and size. No per-token stat or size editing.
- Copies are refreshed in the **same transaction** as the definition edit, never by a listener that mutates state ([ADR-0016](0016-domain-events-pending-actions.md)).

## Consequences

- ADR-0009's instance field list gains **display copies**: token name, image, size (#120); combatant copies (e.g. `hpMax` for a health band) are combat-tracker's call. Only the definition's update path (and the instance's own create) writes them.
- `entities.update` runs definition-changed hooks registered by scenes-map and combat-tracker inside its transaction; every instance row they change is listed in `EntityUpdated.changes` ([FR-ENT-19](../../specs/entities.md#6-functional-requirements)). Crash-safe: all or nothing.
- How a per-instance rename (ADR-0009, Ctrl-D) interacts with a name refresh is scenes-map's rule.
- Player clients never read a monster definition. A player stat block view (tier B) would need its own reveal record later.
- Other players' character sheets stay private (matches [OQ-CHAR-04](../../specs/character-sheet.md#15-open-questions)); other PCs' HP for a party view is a Combat-phase question ([OQ-ENT-15](../../specs/entities.md#15-open-questions)).
