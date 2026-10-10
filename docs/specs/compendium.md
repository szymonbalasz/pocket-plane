---
title: Compendium
prefix: CMP
status: unclaimed
owner: —
wave: 2
---

# Compendium

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md).

## 1. Summary

- Library of 5e rules content: monsters, spells, items, etc.
- MVP: SRD import from Open5e, browse, clone-to-campaign, homebrew.
- Grows over time; 5etools-style JSON later ([compendium-expansion](post-mvp/compendium-expansion.md)).

## 2. Scope

- Import SRD (2014) from Open5e.
- Browse and search entries.
- Clone an entry into a campaign as an editable entity.
- Create homebrew entries.
- Provenance and licence per entry.
- Re-import without clobbering homebrew or clones.

## 3. Goals

> TODO (spec phase).

## 4. Non-goals

> TODO (spec phase).

## 5. User stories

> TODO (spec phase): DM and player stories (can players browse spells/items?).

## 6. Functional requirements

> TODO (spec phase): FR-CMP-NN.

## 7. UI/UX notes

> TODO (spec phase): browser with filters, entry detail, clone action, import status. DM vs player view. Per [visual-direction](../design/visual-direction.md).

## 8. Data model

> TODO (spec phase): blocked on [ADR-0010](../architecture/adr/0010-compendium-design.md) and [ADR-0009](../architecture/adr/0009-entity-content-model.md).

## 9. API & events

> TODO (spec phase): import trigger/progress, browse/search, clone. Visibility rule per event.

## 10. Permissions

> TODO (spec phase).

## 11. Edge cases & failure modes

> TODO (spec phase): Open5e unreachable, crash mid-import, schema changes upstream, duplicate names across sources.

## 12. Performance & bandwidth

> TODO (spec phase): SRD entry counts, import duration, browse/search latency.

## 13. Test plan

> TODO (spec phase): recorded Open5e fixture (no network in tests), small SRD subset. Isolated per [ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md).

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [ADR-0010](../architecture/adr/0010-compendium-design.md) | Compendium design | proposed |
| [ADR-0009](../architecture/adr/0009-entity-content-model.md) | Shape of clone target | proposed |
| [entities](entities.md) | Clone target | open |

## 15. Open questions

**Bold** option = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-CMP-01 | Scope, overrides, re-import safety | See [ADR-0010](../architecture/adr/0010-compendium-design.md) | yes | entities, combat-tracker, character-sheet |
| OQ-CMP-02 | Which Open5e content types in MVP? | **Monsters, spells, items, conditions** / all SRD types | yes | character-sheet, combat-tracker |
| OQ-CMP-03 | Import trigger: runtime UI or dev/admin script? | **DM-triggered in UI, with progress** / CLI script | no | — |
| OQ-CMP-04 | Can players browse the compendium? | **Yes, read-only for spells/items/conditions; monsters DM-only** / DM only | no | live-sync, character-sheet |
| OQ-CMP-05 | Are compendium entries usable directly (e.g. add SRD goblin to encounter) without cloning? | **Yes; clone only to edit** / must clone | yes | combat-tracker |

## 16. Out of scope

- 5etools JSON import, compendium growth → [compendium-expansion](post-mvp/compendium-expansion.md).
- Non-SRD / non-5e content.
