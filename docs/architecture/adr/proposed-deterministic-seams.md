# NNNN — Deterministic IDs, tokens and clock for fixtures and tests

- Status: proposed
- Date: 2026-10-11
- Affects: fixtures-adapters, campaign-management, live-sync, all specs that create records
- Extends: [ADR-0008](0008-parallel-dev-isolation.md) ("non-deterministic inputs need a test seam"). Raised by [OQ-FIX-12](../../specs/fixtures-adapters.md#15-open-questions)

## Context

- Fixture loads must be repeatable. The same bundle should give the same record IDs and the **same player link URL**, so open tabs, bookmarks and walkthrough scripts survive a reset ([ADR-0017](0017-agent-verification-fixture-library.md)).
- Every command that creates a record generates IDs, tokens or timestamps. Without a shared seam, each feature would invent its own.
- Dice already have an owner ([dice-roll-log](../../specs/dice-roll-log.md)). IDs, secret tokens and the clock don't.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. One injectable ID/token generator + clock on the command context; seeded and fixed during fixture load and tests, real otherwise** | Stable links and handles; one rule for every feature | Every command must use the context, never call the platform directly |
| B. Random everywhere; fixtures look records up by name | No seam to build | Player links change every reset; walkthroughs can't hard-code IDs |
| C. Fixtures pass explicit IDs/tokens into commands | Fully explicit | Commands grow test-only inputs; easy to misuse in real play |

## Decision

> Undecided. Suggested: **A**. Mechanism and names go in the AGENTS.md build conventions.

## Consequences

- If A: commands get IDs, tokens and "now" only from the command context. A lint rule or review check enforces it.
- Real play keeps cryptographically random player link tokens. The seed applies only while the loader or tests run.
- Timestamps in fixture-created records are fixed, so time-ordered views stay deterministic in walkthroughs.
