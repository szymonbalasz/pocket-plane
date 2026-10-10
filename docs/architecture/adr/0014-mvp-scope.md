# 0014 — MVP is a playable session simulation

- Status: accepted
- Date: 2026-10-10
- Supersedes: parts of [ADR-0007](0007-product-scope.md) (full sheet from day one; compendium import in MVP)
- Affects: all specs, [roadmap](../../roadmap.md)

## Context

- Original MVP list was effectively "v1": full sheet, compendium import, fog, props, world builder.
- Goal is a product in the DM's hands to use and iterate on, as early as possible.

## Decision

**MVP = the DM can simulate a D&D session: some roleplay, some story, some combat.**

| In MVP | Deferred |
|---|---|
| Town scene with map + tokens; switch to a battlemap scene | Fog, AoE props → [scene-tools](../../specs/post-mvp/scene-tools.md) |
| Grid calibration, pan/zoom, ruler (5e diagonals) | Location ↔ scenes, world builder → [world-builder](../../specs/post-mvp/world-builder.md) |
| Tokens; DM moves any, player moves own | Compendium + import → [compendium](../../specs/post-mvp/compendium.md) |
| Character sheet **basics**: AC, HP, initiative, one weapon attack (e.g. shortsword 1d6, may be hardcoded) | Spells, saves, skills, features, inventory… → [character-sheet-full](../../specs/post-mvp/character-sheet-full.md) |
| Combat vs **one kind of enemy**, single weapon attack each | Encounter builder/CR math, conditions, concentration → [combat-extras](../../specs/post-mvp/combat-extras.md) |
| Initiative, HP, damage, rolls, roll log | |
| Player-ready indicator (part of combat) | |
| Party loot log: rewards given to the party are visible to all | Full party board → [party-board](../../specs/post-mvp/party-board.md) |
| Fixtures: one player, one enemy, two scenes; teardown/rebuild | |

- Full 5e sheet remains the **target**. MVP data model must not block it.
- Entities in MVP: only what tokens and combat need (character, monster). No world-builder UI.

## Consequences

- MVP specs shrink; deferred scope moves to `specs/post-mvp/`.
- [ADR-0010](0010-compendium-design.md), [0011](0011-cross-references.md), [0013](0013-session-journal-scope.md) no longer block MVP.
- [ADR-0009](0009-entity-content-model.md) still blocks MVP (characters and monsters are entities).
- [ADR-0012](0012-character-derived-values.md) blocks MVP only for the few basics fields.
