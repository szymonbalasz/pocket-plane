# 0007 — Product scope and exclusions

- Status: accepted — **partially superseded by [ADR-0014](0014-mvp-scope.md)** (character sheet timing, compendium import timing)
- Date: 2026-10-10
- Affects: all specs

## Context

- Built for one table. Scope control matters more than feature breadth.

## Decision

**In**
- D&D 5e, 2014 SRD rules.
- Compendium import: Open5e first, 5etools-style JSON later. *Post-MVP per [ADR-0014](0014-mvp-scope.md).*
- ~~**Full 5e character sheet from the start**~~ → Full 5e sheet is the **target**; MVP ships the basics ([ADR-0014](0014-mvp-scope.md)). Target: abilities, skills, saves, AC/HP/speed, hit dice, spells and slots, features, attacks, inventory, currency, proficiencies, notes.

**Out**
- Touch / mobile. Laptops only.
- Dynamic lighting / vision.
- Freehand drawing (use AoE props).
- Audio, except short UI notification sounds ([ADR-0030](0030-ui-notification-sounds.md)).
- Extension / plugin system.
- Porting the Obsidian vault (optional importer post-MVP only).

## Consequences

- Specs must not add touch gestures, lighting, drawing, audio or plugin hooks.
- ~~Character sheet spec can't defer core sections to post-MVP.~~ Superseded: see [ADR-0014](0014-mvp-scope.md).
