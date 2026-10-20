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
| Town scene with map + tokens; switch to a battlemap scene | Fog (shape + polygon tools), AoE props → [scene-tools](../../specs/scene-tools.md) |
| **Scene prep in the UI**: upload map, grid calibration (size, offset, settings), drag tokens on, rename, pick token art, **hide/reveal button** (Owlbear-style). Pan/zoom, ruler (5e diagonals) | Location ↔ scenes, world builder → [world-builder](../../specs/post-mvp/world-builder.md) |
| Tokens; free Owlbear-style movement; DM moves any, player moves own tokens anytime, in or out of combat. Plus tier-S map features in [feature tiers](../../feature-tiers.md) (snap, sizes, labels, ping, laser, lock map, ownership) | Compendium + import → [compendium](../../specs/post-mvp/compendium.md) |
| Character sheet **basics**: AC, HP, initiative, one weapon attack (e.g. shortsword 1d6, may be hardcoded). **Characters come from fixtures** | Character builder → [levelling](../../specs/post-mvp/levelling.md); character import → once-off scripts | Spells, saves, skills, features, inventory… → [character-sheet-full](../../specs/character-sheet-full.md) |
| **Encounter builder with CR difficulty** (tier S); **multiple enemy kinds** per encounter (tier S); single weapon attack each | Conditions, concentration → [combat-extras](../../specs/combat-extras.md) |
| Initiative, HP, damage, rolls; advantage/disadvantage on any roll (toggle or Shift/Ctrl). **BG2-style game log** with **DM per-category public/hidden tickboxes** | Whispers, roll requests, inline rolls, macros, 3D dice → [dice-extras](../../specs/post-mvp/dice-extras.md) |
| **Damage cards**: Shieldmaiden-style attack (Shift adv / Ctrl dis) → DM applies to a target as normal / half / none / double, with manual override | — (hit/miss vs AC is MVP, #74) |
| One-click monster initiative; monster HP as health band to players; **start / end encounter**; combatants bind to pre-placed (possibly hidden) tokens | Conditions, concentration, durations, temp HP, death saves; custom NPC actions, multi-target (tier A) |
| **Stats data capture**: all rolls, damage dealt/taken/healed, weapon, overkill | Stats UI, summaries → [stats](../../specs/stats.md) |
| **Every roll: automated or manual entry** (physical dice), for DM and players | |
| **One play page** ([play-shell](../../specs/play-shell.md)): canvas as base, floating windows over it. Player lands on the active scene; window layout persisted per player | Props (status rings, AoE markers) → [scene-tools](../../specs/scene-tools.md); notes from tokens, player notes → [world-builder](../../specs/post-mvp/world-builder.md) |
| Assume immediate asset load | Player-ready indicator / load handling → [scene-tools](../../specs/scene-tools.md) |
| Party loot log: rewards given to the party are visible to all | Full party board → [party-board](../../specs/post-mvp/party-board.md) |
| Fixtures: one player, enemies, an encounter, two scenes; teardown/rebuild. **Minimal import pipeline core** (SRD fixture creatures load as read-only imports) | Real source adapters (Open5e first) → [compendium](../../specs/post-mvp/compendium.md) |
| **DM undo of combat log entries** (damage/healing applied, LIFO) via the event log ([ADR-0016](0016-domain-events-pending-actions.md)) | |
| **Scene list** with folders; duplicate scene; DM views/preps a non-active scene ([decisions #122](../../decisions-log.md)) | Pause screen (tier A) |

- Full 5e sheet remains the **target**. MVP data model must not block it.
- Entities in MVP: only what tokens and combat need (character, monster). No world-builder UI.
- **Design for later, build now:** canvas must accept new layers (props) and tokens must be able to open windows (notes). No props or notes UI in MVP.

## Consequences

- MVP specs shrink; deferred scope moves to `specs/post-mvp/`.
- [ADR-0010](0010-compendium-design.md), [0011](0011-cross-references.md), [0013](0013-session-journal-scope.md) no longer block MVP.
- [ADR-0009](0009-entity-content-model.md) still blocks MVP (characters and monsters are entities).
- [ADR-0012](0012-character-derived-values.md) blocks MVP only for the few basics fields.
