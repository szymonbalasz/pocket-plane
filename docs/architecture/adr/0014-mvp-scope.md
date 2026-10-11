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
| Tokens; DM moves any, player moves own. Plus tier-S map features in [feature tiers](../../feature-tiers.md) (snap, sizes, labels, ping, laser, lock map, ownership) | Compendium + import → [compendium](../../specs/post-mvp/compendium.md) |
| Character sheet **basics**: AC, HP, initiative, one weapon attack (e.g. shortsword 1d6, may be hardcoded) | Spells, saves, skills, features, inventory… → [character-sheet-full](../../specs/post-mvp/character-sheet-full.md) |
| Combat vs **one kind of enemy**, single weapon attack each | Encounter builder/CR math, conditions, concentration → [combat-extras](../../specs/post-mvp/combat-extras.md) |
| Initiative, HP, damage, rolls, roll log | |
| **Damage cards**: Shieldmaiden-style attack (Shift adv / Ctrl dis) → DM applies to a target as normal / half / none / double, with manual override | Hit/miss hint (tier B) |
| One-click monster initiative; monster HP as health band to players | Conditions, concentration, durations, temp HP, death saves, hidden combatants (tier A) |
| **Stats data capture**: all rolls, damage dealt/taken/healed, weapon, overkill | Stats UI, summaries → [stats](../../specs/post-mvp/stats.md) |
| **Every roll: automated or manual entry** (physical dice), for DM and players | |
| **One play page**: canvas as base, floating windows over it. Player lands on the active scene; window layout persisted per player | Props (status rings, AoE markers) → [scene-tools](../../specs/post-mvp/scene-tools.md); notes from tokens, player notes → [world-builder](../../specs/post-mvp/world-builder.md) |
| Assume immediate asset load | Player-ready indicator / load handling → [scene-tools](../../specs/post-mvp/scene-tools.md) |
| Party loot log: rewards given to the party are visible to all | Full party board → [party-board](../../specs/post-mvp/party-board.md) |
| Fixtures: one player, one enemy, two scenes; teardown/rebuild | |

- Full 5e sheet remains the **target**. MVP data model must not block it.
- Entities in MVP: only what tokens and combat need (character, monster). No world-builder UI.
- **Design for later, build now:** canvas must accept new layers (props) and tokens must be able to open windows (notes). No props or notes UI in MVP.

## Consequences

- MVP specs shrink; deferred scope moves to `specs/post-mvp/`.
- [ADR-0010](0010-compendium-design.md), [0011](0011-cross-references.md), [0013](0013-session-journal-scope.md) no longer block MVP.
- [ADR-0009](0009-entity-content-model.md) still blocks MVP (characters and monsters are entities).
- [ADR-0012](0012-character-derived-values.md) blocks MVP only for the few basics fields.
