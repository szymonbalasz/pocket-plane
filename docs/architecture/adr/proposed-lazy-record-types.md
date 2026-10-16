# Proposed — Lazy record types (load on open)

- Status: proposed (sprint 3, spec-party-board; accept at sprint-3 DM gate 1)
- Date: 2026-10-16
- Affects: [live-sync](../../specs/live-sync.md), [protocol](../../protocol/README.md), [party-board](../../specs/party-board.md); likely [compendium](../../specs/post-mvp/compendium.md) (sprint-3 plan: "compendium data should load on demand, not in the snapshot")
- Extends: [ADR-0021](0021-sync-protocol-conventions.md) C (snapshot scope), [ADR-0029](0029-windowed-record-types.md) (windowed types), [ADR-0041](0041-active-scene-window.md) (load on view). Raised by OQ-PARTY-03.

## Context

- CON-44: heavy DM snapshot 676,050 B of 786,432 B; the fog CON-44 test asserts ≥ 100 KiB headroom, so ~8 KB is left for all of sprint 3 (V, R, P, C, D).
- Party-board data grows with the campaign and is read only when its window is open. Measured (PARTY §12, heavy harness probe): 30 handout headers +12.9 KB DM / +7.6–9.9 KB per player; 100 headers ≈ 55 KB; 60 party items +24 KB; 30 inline bodies at 10,000 chars +313 KB DM.
- ADR-0041 already loads scene-scoped rows on view (`sync.loadScene`). Campaign-scoped data has no such path.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Registration flag `lazy: true` (campaign or global scope): never in a snapshot; `sync.load {type, ids?}` returns the rows through the scope gate + visibility fn, in hub frame order; live events unchanged** | 0 B snapshot cost; one generic path (party board, compendium); same filter, leak scan and convergence helpers | ws / protocol / client-store change (hotspot); clients track a loaded set and reload after each snapshot |
| B. Feature read command (`party.load`) returning rows in `ack` | No ws change | Each feature re-implements the scope gate + visibility fn; helpers don't see it; drift risk |
| C. Keep rows in the snapshot with tight caps; lower the 100 KiB headroom | No new path | Spends headroom V and C need; caps the board's size per campaign |

## Decision

> TODO (DM gate 1): pick. Suggested **A**.

## Consequences (if A)

| Topic | Rule |
|---|---|
| Registration | `lazy?: true` on a campaign- or global-scope type (scene scope → registration error; scene types use `dmWindow`). A lazy type has no `window` |
| Snapshot | Lazy types are omitted for every viewer, DM included |
| Load | `sync.load {type, ids?}` (DM, player; `ids` ≤ 50, unique). Unknown or non-lazy type → `invalid`. Result `ack {records {<type>: Record[]}}`: every visible row (or the visible rows among `ids`; ids not visible are simply absent), scope gate + visibility fn as in a snapshot. Read-only, no bus, log or `seq`; answered in hub frame order (events committed before the read are in it, later ones follow as events), as `sync.loadScene` |
| Live events | Unchanged: lazy rows reach every connection that may see them, loaded or not. An upsert lands in the store; a type not yet loaded stays "not loaded" until its load replaces its rows |
| Client | Store keeps `loadedTypes` (and loaded ids for id loads); a snapshot resets it; features call `useLazyRecords(type, ids?)`, which loads once per snapshot generation and reports `loading` / `ready` / `error` |
| Convergence (FR-SYNC-20) | Lazy types compared only for loaded types / ids; helper takes the loaded set (as ADR-0041) |
| Leak scan | Also scans `sync.load` acks |
| Budgets | Load results count against the 4 MiB frame limit only; each lazy type states its worst load result in its spec §12 |
| Build | Own branch `fix/lazy-records` (ws / protocol / common store lock), after V's ws work, before P core |
