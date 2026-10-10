# 0007 — Product scope and exclusions

- Status: accepted
- Date: 2026-10-10
- Affects: all specs

## Context

- Built for one table. Scope control matters more than feature breadth.

## Decision

**In**
- D&D 5e, 2014 SRD rules.
- Compendium import: Open5e first, 5etools-style JSON later.
- **Full 5e character sheet from the start**: abilities, skills, saves, AC/HP/speed, hit dice, spells and slots, features, attacks, inventory, currency, proficiencies, notes. Expanded over time.

**Out**
- Touch / mobile. Laptops only.
- Dynamic lighting / vision.
- Freehand drawing (use AoE props).
- Audio.
- Extension / plugin system.
- Porting the Obsidian vault (optional importer post-MVP only).

## Consequences

- Specs must not add touch gestures, lighting, drawing, audio or plugin hooks.
- Character sheet spec can't defer core sections to post-MVP.
