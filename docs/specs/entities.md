---
title: Entities / world builder
prefix: ENT
status: unclaimed
owner: —
wave: 2
---

# Entities / world builder

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md).

## 1. Summary

- Campaign-owned world records: NPCs, monsters, items, locations, factions, quests, characters.
- Portraits/assets, search, cross-references.
- Gradually replaces the DM's Obsidian vault (not ported).

## 2. Scope

- CRUD for each entity kind.
- Portraits and attached assets ([assets-pipeline](assets-pipeline.md)).
- Search across entities.
- Cross-references between entities.
- Per-entity visibility to players (reveal/hide). *(proposed)*
- Create entity from a compendium entry ([compendium](compendium.md)).

## 3. Goals

> TODO (spec phase).

## 4. Non-goals

> TODO (spec phase).

## 5. User stories

> TODO (spec phase): DM and player stories.

## 6. Functional requirements

> TODO (spec phase): FR-ENT-NN.

## 7. UI/UX notes

> TODO (spec phase): entity list/browser, editor, search (Command palette?), backlinks. DM vs player view. Per [visual-direction](../design/visual-direction.md).

## 8. Data model

> TODO (spec phase): blocked on [ADR-0009](../architecture/adr/0009-entity-content-model.md) and [ADR-0011](../architecture/adr/0011-cross-references.md).

## 9. API & events

> TODO (spec phase). Visibility rule per event.

## 10. Permissions

> TODO (spec phase).

## 11. Edge cases & failure modes

> TODO (spec phase): delete referenced entity, reveal entity that references hidden ones, concurrent DM edits in two tabs.

## 12. Performance & bandwidth

> TODO (spec phase): expected entity counts, search latency.

## 13. Test plan

> TODO (spec phase): fixture world (a few of each kind, with cross-references). Isolated per [ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md).

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [ADR-0009](../architecture/adr/0009-entity-content-model.md) | Content model | proposed |
| [ADR-0011](../architecture/adr/0011-cross-references.md) | Cross-reference model | proposed |
| [campaign-management](campaign-management.md) | Campaign scope | open |
| [live-sync](live-sync.md) | Event/visibility conventions | open |
| [assets-pipeline](assets-pipeline.md) | Portraits | open |
| [compendium](compendium.md) | Clone-to-campaign shape | open |

## 15. Open questions

**Bold** option = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-ENT-01 | Content model | See [ADR-0009](../architecture/adr/0009-entity-content-model.md) | yes | compendium, character-sheet, combat-tracker |
| OQ-ENT-02 | Cross-reference model | See [ADR-0011](../architecture/adr/0011-cross-references.md) | yes | compendium |
| OQ-ENT-03 | Player-visible fields: whole entity reveal, or DM-only notes section within a revealed entity? | **Revealed entity + DM-only notes field** / whole-entity only | yes | live-sync |
| OQ-ENT-04 | Search: what's indexed, and do players get search? | **SQLite FTS over name + text; players search revealed only** / DM only | no | live-sync |
| OQ-ENT-05 | Rich-text format for notes | **Markdown** / structured editor JSON | no | post-mvp/obsidian-importer, post-mvp/agent-api |
| OQ-ENT-06 | Is "monster" an entity kind or only a compendium entry until cloned? | Depends on [ADR-0010](../architecture/adr/0010-compendium-design.md) | yes | compendium, combat-tracker |

## 16. Out of scope

- Relation graph, region maps → [world-builder-deep](post-mvp/world-builder-deep.md).
- Obsidian import → [obsidian-importer](post-mvp/obsidian-importer.md).
- Character sheet details → [character-sheet](character-sheet.md).
