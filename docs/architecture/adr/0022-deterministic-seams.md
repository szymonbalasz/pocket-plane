# 0022 — Deterministic IDs, tokens and clock for fixtures and tests

- Status: accepted (2026-10-12; option A, Phase 1 gate D4, [decisions-log](../../decisions-log.md) #111); "Fixed clock" amended for CLI loads by [ADR-0068](0068-fixture-load-clock.md) (#339)
- Date: 2026-10-11
- Affects: fixtures-adapters, campaign-management, live-sync, all specs that create records
- Extends: [ADR-0008](0008-parallel-dev-isolation.md) ("non-deterministic inputs need a test seam"). Raised by [OQ-FIX-12](../../specs/fixtures-adapters.md#15-open-questions). Implements the seam behind [FR-SYNC-26](../../specs/live-sync.md#6-functional-requirements) (injectable clock and timers)

## Context

- Fixture loads must be repeatable: same bundle → same record IDs and **same player link URL**, so open tabs, bookmarks and walkthrough scripts survive a reset ([ADR-0017](0017-agent-verification-fixture-library.md)).
- Every command that creates a record generates IDs, tokens or timestamps. Without one shared seam, each feature invents its own.
- Seeded tokens are predictable. They must never protect real data.
- Dice already have an owner ([dice-roll-log](../../specs/dice-roll-log.md)). IDs, secret tokens and the clock don't.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. One injectable ID/token generator + clock on the command context; seeded during fixture load and tests, real otherwise** | Stable links and IDs; one rule for every feature | Every command must use the context, never the platform directly |
| B. Random everywhere; fixtures look records up by name | No seam | Player links change every reset; walkthroughs can't hard-code IDs |
| C. Fixtures pass explicit IDs/tokens into commands | Fully explicit | Commands grow test-only inputs the UI can't reach |

## Decision

**A.** Mechanism and names go in the AGENTS.md build conventions.

| Rule | Detail |
|---|---|
| One seam | Commands get IDs, tokens and "now" only from the command context. Same seam serves FR-SYNC-26 (clock, timers) |
| Seed per fixture key | The loader reseeds the generator at the start of each fixture from `(fixed seed, fixture key)`. A fixture's IDs and tokens are the same in every bundle that includes it |
| Disposable only | The seeded generator and fixed clock can only be constructed when the data dir is flagged disposable (or for a test's own temp dir). Otherwise construction fails. Never on real data |
| Scope | Seeded only inside the fixture loader and test harness. A running server always uses a CSPRNG and the real clock, even on a disposable dir. Real player link tokens always come from a CSPRNG |
| Same format | Seeded IDs and tokens have the same format and length as real ones; nothing special-cases them |
| Fixed clock | One fixed instant for the whole load, so timestamps match across runs and bundles |
| Tiebreak | Time-ordered views order by timestamp, then insertion order (event-log sequence / row order). Never by ID or randomness. Applies to real data too |

## Consequences

- A lint rule or review check forbids direct platform calls for IDs, randomness and time outside the seam.
- Fixture-created records share one timestamp; ordering among them comes from the tiebreak, which follows load order.
- Seeded player links are guessable: a server on fixture data is for local dev and tests only, never exposed through the tunnel.
- Dice seeding stays with [dice-roll-log](../../specs/dice-roll-log.md).
