# 0013 — Session outcomes / journal: MVP or post-MVP

- Status: accepted (2026-10-11) — option A, and no session tracking planned
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

- **No session tracking.** No session entity, no session tags.
- **Encounters are the unit of history:** start / end encounter ([combat-tracker](../../specs/combat-tracker.md#2-scope)); game log and stats group by encounter.
- Story recaps belong to notes/world-building ([world-builder](../../specs/post-mvp/world-builder.md)), not to combat data.

## Consequences

- Session recap (tier B) and calendar (C) stay in [campaign-manager](../../specs/post-mvp/campaign-manager.md) as story tools, not combat history.
- Stats like "this session" use time ranges or encounter lists, not a session record.
