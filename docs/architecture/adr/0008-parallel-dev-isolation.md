# 0008 — Parallel dev isolation

- Status: accepted
- Date: 2026-10-10
- Affects: all specs (test plans); build phase

## Context

- Many agents work in parallel git worktrees (Herdr). Fast iteration is first-class.

## Decision

- **Env-driven config**: ports, DB path, asset path, tunnel off/on. No hard-coded ports or paths.
- **Fixture data**: deterministic seed campaigns for dev and tests.
- **No shared mutable state** between worktrees: own DB file, own asset dir, own ports.
- Tests run isolated: each test run uses a fresh temp DB/asset dir.

## Consequences

- Every spec's test plan names its fixtures and states it runs isolated.
- Concurrent `bun test` and dev servers across worktrees must not collide.
- Non-deterministic inputs (dice, clock, IDs) need a test seam.
  > TODO (spec phase): dice seeding approach, in [dice-roll-log](../../specs/dice-roll-log.md).

- Env vars, port slots, data paths: [AGENTS.md §9.2](../../../AGENTS.md#92-env-ports-and-data). Fixture format and location: [§9.3](../../../AGENTS.md#93-fixtures).
