# 0013 — Session outcomes / journal: MVP or post-MVP

- Status: proposed
- Date: 2026-10-10
- Affects: campaign-management, dice-roll-log, combat-tracker, post-mvp/campaign-manager
- MVP: not blocking ([ADR-0014](0014-mvp-scope.md)). Option A (post-MVP) is consistent with the MVP definition.

## Context

- DM wants a record of what happened each session (outcomes, loot, XP, notes).
- Game log and combat already produce raw history.
- [Campaign manager](../../specs/post-mvp/campaign-manager.md) (sessions, timeline) is post-MVP.

## Options

| Option | Pros | Cons |
|---|---|---|
| A. **Post-MVP entirely** | Smallest MVP | No grouping of game log/combat by session; harder to retrofit |
| B. **MVP: minimal session record** (start/end, title, freeform notes); game log and combats tagged with session | Cheap; gives history a spine for later | Small extra scope; one more entity |
| C. **MVP: full journal** (outcomes, loot, XP, linked entities) | Replaces Obsidian session notes sooner | Significant scope; overlaps campaign-manager |

## Decision

> Undecided.

## Consequences

> TODO (spec phase): fill once decided. If B or C, add a section to [campaign-management](../../specs/campaign-management.md) and update [roadmap](../../roadmap.md).
