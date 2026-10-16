# Proposed — Lazy record types (load on open)

- Status: proposed (sprint 3, spec-party-board; accept at sprint-3 DM gate 1)
- Date: 2026-10-16 (seams pass: S1 global scope + id loads, consumers, build order)
- Affects: [live-sync](../../specs/live-sync.md), [protocol](../../protocol/README.md), [party-board](../../specs/party-board.md), compendium (`imported-entity`), effect-modifiers (`rule-trigger`)
- Extends: [ADR-0021](0021-sync-protocol-conventions.md) C (snapshot scope), [ADR-0029](0029-windowed-record-types.md) (windowed types), [ADR-0041](0041-active-scene-window.md) (load on view). Raised by OQ-PARTY-03.

## Context

- CON-44: heavy DM snapshot 676,045 B of 786,432 B; the fog CON-44 test asserts ≥ 100 KiB headroom, so ~8 KB is left for all of sprint 3 (V, R, P, C, D). Sprint 3 as specced: +40.6 KB DM (seams S2).
- Party-board data grows with the campaign and is read only when its window is open. Measured (PARTY §12, heavy harness probe): 30 handout headers +12.9 KB DM / +7.6–9.9 KB per player; 100 headers ≈ 55 KB; 60 party items +24 KB; 30 inline bodies at 10,000 chars +313 KB DM.
- Other sprint-3 data has the same shape: compendium-imported definitions (global, needed by id when an entry or creature opens) and rule triggers (campaign, needed when a sheet's Triggers block or the Creatures entry opens; R expects ≈ −14 KB DM).
- ADR-0041 already loads scene-scoped rows on view (`sync.loadScene`). Campaign- and global-scoped data has no such path.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Registration flag `lazy` (campaign or global scope): never in a snapshot; `sync.load {type, ids?}` returns the rows through the scope gate + visibility fn, in hub frame order; live events unchanged** | 0 B snapshot cost; **one generic on-demand path** for every track (party board, compendium, rule triggers; seams S1); same filter, leak scan and convergence helpers | ws / protocol / client-store change (hotspot); clients track a loaded set and reload after each snapshot |
| B. Feature read command (`party.load`) returning rows in `ack` | No ws change | Each feature re-implements the scope gate + visibility fn; helpers don't see it; drift risk. Ruled out for every track by seams S1 |
| C. Keep rows in the snapshot with tight caps; lower the 100 KiB headroom | No new path | Spends headroom V and C need; caps the board's size per campaign |

## Decision

> TODO (DM gate 1): pick. Suggested **A** (integrator pick per seams S1; DM decides at the gate).

## Consequences (if A)

| Topic | Rule |
|---|---|
| Registration | `lazy: "all" \| "ids"` on a **campaign- or global-scope** type. `"all"`: whole-type and id loads. `"ids"`: id loads only (large types, e.g. global imported definitions). **Scene scope → registration error**: scene types keep `dmWindow` / `sync.loadScene` (ADR-0041). A lazy type has no `window` |
| Snapshot | Lazy types are omitted for every viewer, DM included |
| Load | `sync.load {type, ids?}` (DM, player). `ids` 1–50, unique. Unknown or non-lazy type, or no `ids` on an `"ids"` type → `invalid`. A type whose audience excludes the sender (e.g. `audience: dm`) → `forbidden`. Result `ack {records {<type>: Record[]}}`: every visible row (or the visible rows among `ids`; ids not visible or not existing are simply absent, never an error), scope gate + visibility fn as in a snapshot. Read-only, no bus, log or `seq`; answered in hub frame order (events committed before the read are in it, later ones follow as events), as `sync.loadScene` |
| Scope gate | Campaign scope: the sender's active campaign only. Global scope: any connection passes the gate; the type's visibility fn and audience decide (as global types in a snapshot today, FR-SYNC-09) |
| Live events | Unchanged: lazy rows reach every connection that may see them, loaded or not. An upsert lands in the store; a type (or id) not yet loaded stays "not loaded" until its load replaces those rows |
| Client | Store keeps `loadedTypes` (whole-type loads) and `loadedIds` per type (id loads; a union across calls); a snapshot resets both. Features call `useLazyRecords(type)` or `useLazyRecords(type, ids)`; an id load requests only ids not yet loaded (chunks of 50). Loads once per snapshot generation; reports `loading` / `ready` / `error`. A whole-type load marks the type loaded; a later id load on it is a no-op |
| Convergence (FR-SYNC-20) | Lazy types compared only for loaded types / ids; helper takes the loaded set (as ADR-0041) |
| Leak scan | Also scans `sync.load` acks |
| Budgets | Load results count against the 4 MiB frame limit only; each lazy type states its worst load result in its spec §12 |
| Consumers (sprint 3) | P: `handout` (`"all"`), `handout-body` (`"ids"`), `party-item` (`"all"`). C: `imported-entity` (`"ids"`, global; compendium entries stay on REST). R: `rule-trigger` (campaign; mode per R's spec). V: none (scene scope; View-as data via `sync.loadScene` / ADR-0041) |
| Build | Own branch `fix/lazy-records` (ws / protocol / common store lock): **after V0, before P core and C2** (seams S1, S3) |
