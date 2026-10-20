# Proposed: stats are read models computed on read over the fact tables

- Status: proposed (sprint 7, track ST; the integrator numbers it at merge)
- Date: 2026-10-20
- Refines: [ADR-0016](0016-domain-events-pending-actions.md). Its "stats computed from the event log retroactively" becomes: computed from the **typed fact tables** written in the same transaction as the logged events, filtered per viewer.
- Affects: [stats](../../specs/stats.md) (FR-STATS-01–05, -12, -13, -16), [combat-tracker](../../specs/combat-tracker.md) (FR-CBT-138), [dice-roll-log](../../specs/dice-roll-log.md) (FR-DICE-72–73), [live-sync](../../specs/live-sync.md) (leak scan over acks), later stats features (tier B: trophy case, luck tracker)
- Raised by: DM [#311](../../decisions-log.md) (stats tier A, "computed from the append-only event log, visibility-safe"), the stats stub's open "computed on read or materialised projections?"

## Context

- ADR-0016 logs every domain event (`event_log`: `type`, JSON `payload`, `at`; indexed only by campaign). The same transactions write typed, append-only **facts**:
  - `hp_change`: the glossary's "stats unit", with raw, applied, overkill, HP before / after, temp, attacker, target, `entryId` and `undone`.
  - `roll`: immutable, with `natural`, `category` and actor.
  - `game_log_entry`: with `public` stamped once, `rollIds`, `encounterId` and the `supersededBy` reserved for gems.
- `event_log` has no visibility of its own: its rows don't say which log line a player saw. `hp_change` → `entryId` → `public` does.
- Players never receive `hp_change` and see only the newest 100 log entries (ADR-0029). So the client can't compute stats.
- Measured (stats §12): one fight 0.4–0.7 ms, one session 5–7 ms, at 100 sessions of history (94k entries, 32k `hp_change`). The only cost that grows is listing sessions (103 ms cold at 100 sessions).

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Compute on read on the server: a read-only command aggregates the fact tables after a per-viewer filter (the fact's log line must be visible); no stored stats** | Works retroactively for free; one source of truth; undo and rerolls are just markers on facts; 0 B snapshot; new stats need no migration | Each query pays for one fight or session (measured ms); each viewer filter must be right (leak-scanned) |
| B. Materialised projections (per-encounter / per-session tables updated in the apply transaction) | O(1) reads | A schema lane; every undo, reroll and visibility change must update them; past sessions need a backfill; a second truth that can drift |
| C. Client-side from synced records (a lazy `hp-change` for players) | No server compute | Sends DM-only facts (applied, HP) or needs a redacted copy type; players' log window is 100 rows; heavy loads |
| D. Aggregate `event_log` payloads | "From the event log" literally | JSON scans with no index; no visibility link; duplicates `hp_change` |

## Decision (proposed)

**A.**

1. **Facts, not projections.** Stats read `hp_change`, `roll` and `game_log_entry`, plus `combatant` / `encounter` / `entity` for names and kinds, through read helpers owned by those specs. No stats table, column, record type or snapshot field.
2. **Filter, then aggregate.** A fact counts for a viewer only if its game-log entry is visible to them. For players this means `public`: one view for all players, and `audiencePlayerId` lines are excluded. Undone facts and superseded entries never count. The player result schema has no field for hidden numbers.
3. **Read-only command.** `stats.query` runs in the command pipeline with an empty event list (no write, event, log row or `seq`), so it is answered in hub frame order. Its acks pass the leak scan.
4. **Only append-only derivations may be cached** (session boundaries, extended from the last `n`). A cache is in memory and rebuilt on demand, never persisted.
5. **New facts that stats should count need a log line** (`entryId`) for their visibility. A fact without one is DM-only or not counted.

## Consequences

- Undo (ADR-0016) and gem rerolls change stats by marking facts (`undone`, `supersededBy`), never by editing totals. The GM track must supersede, not delete or edit, an entry.
- Sessions stay derived (ADR-0013 unchanged): a ≥ 6 h gap between entries.
- `hp_change`, `roll` and `game_log_entry` semantics become a contract. Changing what `raw`, `overkill`, `public` or `natural` mean needs a stats review (FR-CBT-138, FR-DICE-72).
- Revisit B only if a measured query passes its bench gate (fight 20 ms, session 50 ms) on real history.
