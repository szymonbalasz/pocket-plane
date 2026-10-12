# 0029 — Windowed record types (bounded snapshot for append-only logs)

- Status: accepted (2026-10-12; decisions-log #137)
- Date: 2026-10-12
- Affects: [live-sync](../../specs/live-sync.md) (FR-SYNC-09, FR-SYNC-20), [dice-roll-log](../../specs/dice-roll-log.md), [notifications](../../specs/notifications.md) (history), [party-loot](../../specs/party-loot.md), [protocol](../../protocol/README.md) §5
- Raised by: [OQ-DICE-04](../../specs/dice-roll-log.md#15-open-questions)

## Context

- Append-only logs (game log, notification history, loot log) grow for the life of a campaign. Snapshots must stay bounded (live-sync §12: ≤ 512 KB; scenes already use ≤ 300 KB).
- A provider returning only the newest N breaks FR-SYNC-20 as written: after a live session a client's store holds more than N entries, so it no longer equals a fresh snapshot.
- Three specs will hit this; one rule avoids three answers.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Registration gains `window {orderBy, size}`; snapshot = newest `size`; FR-SYNC-20 compares only the newest `size` records of windowed types; clients may hold more until the next snapshot** | No client sync code; one test rule; tiny registry change | Store differs from snapshot beyond the window (harmless: older entries are real, just not resent) |
| B. Generic client reducer trims windowed types to `size` after each event | Exact convergence | Client sync code per type; entries vanish from a window mid-read |
| C. Full log in every snapshot | No rule change | Unbounded snapshot; slow joins over the tunnel late in a campaign |

## Decision

**A, amended by the integrator** (#137; the DM: players don't need the full log). Registration gains optional `window {orderBy, size, pin?}`:

- **Snapshot** = every row with `pin(row)` true, plus the newest `size` rows by `orderBy`. The cut is taken **before** the visibility filter, so its floor (the lowest `orderBy` in the window) is the same for every viewer.
- **Convergence** (FR-SYNC-20) for windowed types compares only rows with `orderBy` ≥ that floor, plus pinned rows. Older rows a client still holds are real, just not resent. A change to a row below the floor (late reveal, undo) is still delivered live; a fresh snapshot simply doesn't include it.
- **Sizes:** game log `n`, 100. Notifications: `pin` = pending, newest 100 closed. Party-loot picks its own.
- No "load older" in MVP; that is a later, separate read path.

## Consequences

- Record-type registration (`src/server/ws/`, `src/shared/protocol/`) gets an optional `window`; convergence and leak-scan helpers honour it. Shared change via the orchestrator.
- The window is cut before the visibility filter: the provider takes the newest `size` rows, then the filter runs. A player may get fewer than `size` when many are hidden. Accepted for MVP.
- dice-roll-log uses `window {orderBy: n, size: 100}`; notifications and party-loot pick their own sizes.
