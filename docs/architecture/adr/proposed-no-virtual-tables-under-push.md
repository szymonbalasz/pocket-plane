# Proposed — No SQLite virtual tables in the main DB while schema push runs

- Status: proposed, with OQ-NOTES-12 in [linked-notes](../../specs/linked-notes.md)
- Date: 2026-10-31
- Extends: [#416](../../decisions-log.md) (schema push stays until release), [ADR-0001](0001-tech-stack.md)
- Affects: any later search feature; [world-builder](../../specs/post-mvp/world-builder.md) ("SQLite FTS" pick); [ADR-0009](0009-entity-content-model.md) (full-text indexing deferred); `src/server/db/push.ts`; [fixtures-adapters](../../specs/fixtures-adapters.md) (reset), `state:digest`

## Context

The server compares `schema.ts` with the live DB at every start. Would an FTS5 table survive that? Probed in scratch DBs: drizzle-kit 0.31.11 (repo's pinned lock version) `pushSQLiteSchema`, Bun 1.3.14 on Windows, SQLite 3.53.0 with `ENABLE_FTS5`.

| Case | Result |
|---|---|
| Empty FTS5 table beside an unchanged schema | 6 tables seen (`note_fts` + 5 shadow). 6 `DROP TABLE`; `hasDataLoss = true`, because shadow tables hold rows even with no documents |
| Populated | Same, more warnings |
| FTS5 + a new table in `schema.ts` | drizzle-kit asks whether it's a rename → `Interactive prompts require a TTY`. Since the upgrade guards merged (#424), `renameQuestions` refuses first, with a clear message: it lists every `table` row in `sqlite_master`, so the FTS5 tables count as old tables (read in `push.ts`, not re-probed) |
| External-content FTS5 with a trigger | 5 `DROP TABLE`, `hasDataLoss = true` |
| The drops applied anyway | Fails: `no such table: note_fts_data` (dropping the virtual table already removed it) |
| FTS5 in an `ATTACH`ed file | Push sees nothing: 0 statements, no loss; queries work |
| New plain tables on a populated DB | `CREATE` only, no warning or prompt; second boot 0 statements |

`pushSchema` turns `hasDataLoss` into `SchemaPushError`, so **a real campaign with an FTS5 table in the main DB refuses to start**. `pushSQLiteSchema(imports, db)` takes no table filter.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. No virtual tables in the main DB while push runs; search with the shared matcher in server memory** | No schema risk; same results as compendium and pickers; incremental per note, filled per viewer's visible set, so a player can't time hidden notes; no corpus statistics | First-search fill (DM: 235 ms at 2,000 × 2,000 chars); no stemming beyond the plural rule |
| A2. Same rule, with a plain `note_word` table instead of memory | No cold start; survives push (ordinary table); filter by join | Roughly 600,000 rows at the cap (an estimate); each save rewrites its rows; backups and digest grow; `searchTier`'s tiers to redo in SQL |
| B. FTS5 in an attached sidecar file | Real FTS; survives push | A second DB file for backup, reset, digest, Windows locks; a different matcher; BM25 ranking could reflect hidden notes unless filtered per viewer |
| C. Teach `push.ts` to ignore virtual tables and shadows | FTS5 in one file | Shared-core change on the path every real upgrade takes; the rename prompt returns with each later table; the guard must parse `sqlite_master` |

## Decision

> Undecided: the DM's gate (OQ-NOTES-12). Suggested: **A**.

## Consequences (if A)

- `AGENTS §9.4` (test DB) and `§9.9` gain one line: virtual tables stay out of `schema.ts`'s DB until generated migrations start ([#416](../../decisions-log.md)).
- Revisit at release, when migrations replace push, or if search over notes outgrows memory.
