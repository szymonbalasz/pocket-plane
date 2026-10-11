# 0009 — Entity content model

- Status: proposed
- Date: 2026-10-10
- Affects: entities, character-sheet, combat-tracker, scenes-map, fixtures-adapters, post-mvp/compendium, post-mvp/world-builder, post-mvp/agent-api, post-mvp/obsidian-importer
- MVP: **blocking** — characters and monsters are entities ([ADR-0014](0014-mvp-scope.md)). World-builder kinds can follow later but the model must accommodate them.

## Context

- Entity kinds: NPC, monster, item, location, faction, quest, character.
- Freeform markdown + wikilinks suits brainstorming, not imported structured data (5etools).
- Fully relational modelling of every relation explodes table count.
- Must support: search, cross-references, external import, future agent/API access.
- Must fit [ADR-0006](0006-persistence.md): relational, JSON only for document-shaped leaves.
- Definitions must tolerate **partial data**: an imported item may be only name + description until its mechanics are filled in ([ADR-0010](0010-compendium-design.md) DM workflow).
- **One shared interface for creatures** (DM, 2026-10-11): pulling a creature into an encounter must work the same for SRD, imported, custom and duplicated NPCs. Consumers depend on a single creature-definition contract; source/provenance is metadata. Rules out designs where compendium entries and campaign creatures are different types to the encounter builder.
- Monster/NPC definitions need **custom actions** that auto-roll against selected target(s) ([combat-extras](../../specs/post-mvp/combat-extras.md)).

## Options

| Option | Pros | Cons |
|---|---|---|
| A. **Hybrid typed records**: common `entity` table + per-kind zod/JSON schema for structured data + optional rich-text notes | Structured where it matters, flexible elsewhere; import maps to per-kind schemas | Per-kind JSON can drift toward blob state; querying inside JSON is weaker |
| B. **Generic entity + typed attribute blocks**: entity has N blocks (stat block, notes, inventory…) each with a schema | Composable; same block reused across kinds; agent-friendly | More indirection; harder to enforce "a monster must have a stat block" |
| C. **Pure relational**: a table per kind and per relation | Strongest integrity and querying | Table explosion; slow to evolve; import mapping heavy |

Suggested: **A**, with this framing (discussed, not yet accepted):

- **Definition** — what a thing *is* (stat block: AC, max HP, init bonus, attacks). Document-shaped; produced by importers/fixtures. Per-kind JSON column, zod-validated.
- **Play state** — what's happening *now* (current HP, initiative, token position). Changes every turn; relational columns on character / combatant / token.
- Test case: a goblin takes damage → only its combatant changes; the Goblin definition is untouched.

## Decision

> Undecided.

## Questions to answer

- Where does character sheet data sit — same model or separate? (see [ADR-0012](0012-character-derived-values.md))
- How is full-text search indexed (SQLite FTS over which fields)?
- How do compendium entries and entities relate — same shape or different? (see [ADR-0010](0010-compendium-design.md))
- What does an agent/MCP client read and write? ([agent-api](../../specs/post-mvp/agent-api.md))

## Consequences

> TODO (spec phase): fill once decided.
