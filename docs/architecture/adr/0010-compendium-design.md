# 0010 — Compendium design

- Status: proposed
- Date: 2026-10-10
- Affects: post-mvp/compendium, entities, combat-tracker, character-sheet, post-mvp/compendium-expansion
- MVP: not blocking ([ADR-0014](0014-mvp-scope.md)). Shares the adapter pipeline and provenance with [ADR-0015](0015-source-adapters-fixtures.md).

## Context

- Grows over time from multiple sources: Open5e (first), 5etools JSON (later), homebrew.
- Needs a shared SRD library **plus** per-campaign overrides/clones.
- Must track provenance and licensing per entry.
- Re-import must not clobber homebrew edits.
- Tension with [ADR-0004](0004-tenancy-auth-permissions.md): "every record belongs to a campaign" vs a shared library.
- **DM workflow (2026-10-11):**
  - Custom NPCs are made by taking an **SRD monster as a base** and editing, or by **duplicating an existing NPC**. Many per encounter.
  - Sources: **Open5e** (important), **5etools** (separate import project), **own homebrew files**, **Griffon's Saddlebag items** (bulk import; mechanics filled in one by one as items get used).
  - Adding a creature to an encounter must be **identical for compendium and campaign creatures** (shared interface, [ADR-0009](0009-entity-content-model.md)). Favours options where using an entry directly or via clone looks the same to consumers.
  - → Entries must allow **partial data** (description only) with structured mechanics added later.

## Options

**Scope**

| Option | Pros | Cons |
|---|---|---|
| A. **Global library + campaign clones**: compendium is outside campaign scope; campaigns clone entries to edit | One import serves all campaigns; small DB | Needs an explicit exception to ADR-0004 |
| B. **Per-campaign import**: each campaign imports its own copy | Fully consistent with ADR-0004 | Duplicate data; re-import per campaign |
| C. **Global library + per-campaign overlay** (patches on top of source entries) | No copying; upstream fixes flow through | Merge/patch complexity; harder to reason about |

**Re-import safety**

| Option | Pros | Cons |
|---|---|---|
| i. Source entries immutable; edits only on clones | Simple; re-import never conflicts | Every tweak needs a clone |
| ii. Track per-field "locally edited" flags | Fine-grained | Complex UI and logic |
| iii. Version source entries; clones pin a version | Reproducible | Version churn; storage |

## Decision

> Undecided.

## Questions to answer

- Stable source IDs across re-imports (Open5e slug? 5etools name+source?).
- Provenance fields: source, licence, version, import date.
- Do compendium entries and entities share one model? (see [ADR-0009](0009-entity-content-model.md))

## Consequences

> TODO (spec phase): fill once decided. If option A or C, amend/supersede ADR-0004 tenancy wording.
