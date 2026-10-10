# 0015 — Source adapters and fixtures

- Status: proposed
- Date: 2026-10-10
- Affects: fixtures-adapters, entities, character-sheet, combat-tracker, scenes-map, post-mvp/compendium, post-mvp/compendium-expansion, post-mvp/obsidian-importer

## Context

- Two working goals from the DM:
  1. **Lots of fixtures** — tear down and rebuild a test/dev setup at will.
  2. **Adapters** — automate import of reference material from many sources (Open5e, 5etools JSON, homebrew, later Obsidian).
- Both load external data into the app DB. Two code paths would drift.
- Must satisfy [ADR-0008](0008-parallel-dev-isolation.md): isolated per worktree, deterministic.

## Options

| Option | Pros | Cons |
|---|---|---|
| A. **Fixtures are a source.** One adapter pipeline: fetch → normalise to our schema (zod) → upsert with provenance. Fixture adapter reads files in the repo. | One path to test; every fixture load exercises the import pipeline; new sources are "just another adapter" | Pipeline must exist in MVP (small) |
| B. **Separate seed scripts** for fixtures; adapters built later for import | Fastest to first fixture | Two paths; import pipeline untested until post-MVP |
| C. **SQL/DB snapshots** as fixtures | Fastest load | Brittle across schema changes; opaque in review |

Suggested: **A**.

## Questions to answer

- Adapter interface: stages, inputs, outputs, error reporting.
- Fixture file format and location (JSON? TS modules with zod?).
- Fixture composition: small units (player, enemy, scene) combined into bundles (e.g. "session-sim").
- Stable IDs for idempotent re-load / upsert.
- Provenance fields shared with [ADR-0010](0010-compendium-design.md).
- Fixture image assets: source and licence.

## Decision

> Undecided.

## Consequences

> TODO (spec phase): fill once decided. Spec: [fixtures-adapters](../../specs/fixtures-adapters.md).
