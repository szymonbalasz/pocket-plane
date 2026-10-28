# 0011 — Cross-reference model

- Status: proposed
- Date: 2026-10-10
- Affects: post-mvp/world-builder, post-mvp/compendium, post-mvp/obsidian-importer, agent-api
- MVP: not blocking ([ADR-0014](0014-mvp-scope.md)).

## Context

- Entities link to each other (NPC → faction, quest → location, item → owner).
- Need: backlinks, search, rename-safe links, future relation graph.
- Must survive import from external sources and an optional Obsidian importer (wikilinks).

## Options

| Option | Pros | Cons |
|---|---|---|
| A. **Explicit relations**: `relation` table (from, to, type) | Queryable; backlinks and graph are trivial; typed | Can't link from inside prose; feels rigid while brainstorming |
| B. **Inline references**: links embedded in rich text, by ID | Natural writing flow; wikilink-like | Backlinks need parsing/indexing; untyped |
| C. **Both**: inline refs are indexed into the relation table as untyped "mentions"; typed relations added explicitly | Best of both; one query surface | Two write paths; must keep index in sync |

## Decision

> Undecided.

## Questions to answer

- Link target: by stable ID, with display text resolved at render?
- Behaviour on target delete (dangling link, cascade, tombstone)?
- Visibility: a player can see entity X which mentions hidden entity Y — what renders?
- Can entities reference compendium entries directly?

## Consequences

> TODO (spec phase): fill once decided.
