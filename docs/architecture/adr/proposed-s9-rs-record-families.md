# Proposed — Reminders and strongholds as record families

- Status: proposed (sprint 9, track RS; integrator numbers it at merge)
- Date: 2026-10-22
- Extends: [ADR-0045](0045-lazy-record-types.md) (lazy types), [ADR-0021](0021-sync-protocol-conventions.md) B (one visibility fn per type, reads only the record), [ADR-0024](0024-definition-visibility.md) (copies written in the same transaction)
- Affects: [reminders](../../specs/reminders.md), [strongholds](../../specs/strongholds.md), [party-board](../../specs/party-board.md), [character-sheet-full](../../specs/character-sheet-full.md), [protocol](../../protocol/README.md), [data model](../../data-model/README.md)
- Raised by: BL-73 (DM, #338): reminders for the party or one character (party + own characters for players, all for the DM), strongholds with "any row DM-only"

## Context

- Two new families of campaign data. Both are read when a window or tab is open, never during combat's hot paths, and both can grow (200 reminders, 8 strongholds × 24 facilities × 40 staff).
- Visibility needs data a per-type fn can't read across records: a reminder's character owner, whether its linked stronghold / facility is DM-only; a staff row's stronghold being DM-only.
- CON-44 (measured, throwaway probe on the heavy harness, base DM 691,581 B; last DM worst ≈ 1.15 MB of 1.5 MiB): reminders in the snapshot cost +17.8 KB DM realistic, **+369 KB at the cap**; strongholds +9.4 KB realistic, **+378 KB at the caps**. Either alone at its cap would take the DM near the 1.5 MiB ceiling.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Two lazy `"all"` types: `reminder` (one row per reminder) and `stronghold` (one row per stronghold, facilities and staff as JSON leaves). Visibility: reminders via two server-written copies (`ownerPlayerId`, `linkHidden`); strongholds redacted inside the record (DM-only rows / fields removed, pointers at removed facilities nulled). Every HOLD event `quietWhenUnchanged`** | 0 B snapshot; the existing on-demand path; the stronghold fn is pure and self-contained (no copies); a DM-only edit sends players nothing | A stronghold edit resends the whole record (realistic ≈ 5 KB per viewer, 47 KB at the caps); clients load on open |
| B. As A, but one record per facility and per staff member (`stronghold-facility`, `stronghold-staff`) | Per-edit frames 1.2 KB / 0.7 KB at the caps | Each row needs copies of its stronghold's and its target facility's `dmOnly` (rewritten on every flip), or a refusal rule "no visible row points at a DM-only row"; 3 types, 3 loads |
| C. Rows in the snapshot (not lazy) | No load spinner | +369 KB / +378 KB DM at the caps (CON-44); reminders of other players' characters must still be filtered |

## Decision

> Undecided. Suggested pick **A**.

- `reminder`: campaign scope, `lazy: "all"`; DM full; player hidden if `dmOnly`, `linkHidden`, or another player's character (`ownerPlayerId` ≠ viewer); else redacted (the three DM keys dropped). `ownerPlayerId` is refreshed through one `definitionChangedHooks` line on an owner change; `linkHidden` by every HOLD command that flips a stronghold's or facility's `dmOnly`, in that transaction (changes ride on its event).
- `stronghold`: campaign scope, `lazy: "all"`; DM full; player hidden if `dmOnly`; else redacted inside the record. Events `quietWhenUnchanged` (#276) so an edit invisible to players sends them no frame.
- Removing a facility / stronghold deletes its linked reminders in the same transaction (BL-73).

## Consequences

- No new registry, no ws / protocol core change (lazy types and `quietWhenUnchanged` exist). Shared files: schema (two tables), `src/shared/events/` (two files), record-type registry lines, one entities hook line.
- Leak tests per player cover `sync.load` acks of both types and the show → hide round trip.
- Later per-row records (B) stay possible as an additive change if stronghold edits ever get frequent.
