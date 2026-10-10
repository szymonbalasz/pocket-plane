---
title: World builder
prefix: WORLD
status: stub
owner: —
phase: post-mvp
---

# World builder (post-MVP stub)

Moved out of MVP by [ADR-0014](../../architecture/adr/0014-mvp-scope.md). Absorbs the former "deeper world builder" stub.

- **What:**
  - Entity kinds beyond MVP's character/monster: NPC, item, location, faction, quest.
  - Portraits/assets, search, cross-references, backlinks.
  - **Locations linked to scenes**: e.g. Neverwinter has many scenes (tavern, docks, sewers).
  - Per-entity reveal to players; DM-only notes.
  - Later: relation graph view, region/world maps.
  - Gradually replaces the Obsidian vault.
- **Builds on:** [entities](../entities.md), [scenes-map](../scenes-map.md), [ADR-0009](../../architecture/adr/0009-entity-content-model.md), [ADR-0011](../../architecture/adr/0011-cross-references.md).
- **Carried-over open questions** (suggested pick in bold):

| Question | Options |
|---|---|
| Player-visible fields | **Revealed entity + DM-only notes field** / whole-entity only |
| Search | **SQLite FTS over name + text; players search revealed only** / DM only |
| Rich-text format | **Markdown** / structured editor JSON |
| Location ↔ scene cardinality | **One location, many scenes; scene has ≤1 location** / many-to-many |
| Region maps: scenes or separate map type? | — |
| Graph from typed relations only, or mentions too? | — |

> TODO (spec phase): expand from [_template.md](../_template.md) after MVP.
