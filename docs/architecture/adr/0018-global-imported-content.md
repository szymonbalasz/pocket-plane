# 0018 — Imported reference content is global; custom content is per campaign

- Status: accepted
- Date: 2026-10-11
- Refines: [ADR-0004](0004-tenancy-auth-permissions.md) (tenancy), [ADR-0010](0010-compendium-design.md) (compendium scope), [ADR-0015](0015-source-adapters-fixtures.md) (upsert key)
- Affects: fixtures-adapters, entities, combat-tracker, post-mvp/compendium

## Context

- ADR-0004: every record belongs to exactly one campaign; compendium scope left open.
- The DM runs a few campaigns from day one. SRD / 5etools / Open5e content is the same for all of them.
- Raised as OQ-FIX-14 in [fixtures-adapters](../../specs/fixtures-adapters.md).

## Decision

| Content | Scope |
|---|---|
| **Imported definitions** (SRD, Open5e, 5etools, fixture source) — read-only | **Global**: no campaign; upsert key `(source, sourceKey)` as in ADR-0015 |
| **Custom definitions** (derived or from scratch, e.g. custom NPCs) | **Per campaign** |
| Everything else (players, characters, scenes, tokens, encounters, logs…) | Per campaign (ADR-0004 unchanged) |

## Consequences

- ADR-0004's "every record belongs to exactly one campaign" has one exception: imported definitions.
- Instances and encounter entries in a campaign may point at a global definition or at a custom definition of the same campaign, never at another campaign's custom.
- Deriving from a global definition creates a campaign-scoped custom.
- Fixture reset wipes the whole disposable DB, so global records need no separate cleanup.
- Visibility: imported definitions are reference content; per-field rules for players are set by [entities](../../specs/entities.md).
