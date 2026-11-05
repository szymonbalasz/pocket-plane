# Proposed — Owner-only records (the DM's filter too)

- Status: proposed, with [linked-notes](../../specs/linked-notes.md) (FR-NOTES-02). The DM decided the product rule at the sprint 15 gate: "the DM doesn't see" a player's private notes.
- Date: 2026-11-05
- Amends: [ADR-0005](0005-server-authoritative-sync.md) ("DM sees all": now "DM sees all but owner-only records"). Extends [ADR-0021](0021-sync-protocol-conventions.md) (visibility reads record + viewer only) and [ADR-0058](0058-feature-switches.md) (a gate before the role rule).
- Affects: `src/server/ws/records.ts` (shared core), `src/server/ws/testing/convergence.ts`, [live-sync](../../specs/live-sync.md) §8 Registrations.

## Context

- `RecordRegistry.view()` returns `full` for every DM connection before the type's `visibility` runs. Only the scope and feature gates come first. So any record reaches every DM connection, including the MCP server's.
- Private notes must reach only their author's connections. That is the DM's own tabs for a DM note, and one player's tabs for a player's note.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Optional `ownerOf(r) → {role, playerId?} \| null` on a record type; non-null → only matching viewers see the record, DM included; checked right after the feature gate** | One rule in one place; snapshots, `sync.load`, live events and the transition matrix all follow; a flip is an ordinary upsert / delete | A shared-core edit; the first type the DM can't see |
| B. Keep private notes out of the record system (own frames) | No core change | A second delivery path to keep leak-free; no snapshot purge, convergence or leak helpers |
| C. Send to the DM and hide in the DM client | Trivial | The data reaches the DM: fails the rule |

## Decision

> Suggested: **A**.

- Viewer key: `{role: "dm"}` for DM connections; `{role: "player", playerId}` for players.
- `leakScan` flags a held row that `view()` hides only if the provider returns that row (`scanRecords` skips other IDs). So an owner-gated type's provider returns **every row of the campaign** and lets `view()` filter, never a per-viewer query. Leak tests also assert that held IDs ⊆ readable IDs. DM clients join the scans.
- The MCP server is a DM connection, so it can receive the DM's own private notes: that is the DM acting as themselves. A player's note never reaches it, because the gate runs before the DM rule. A tool that sends notes to the model is OQ-NOTES-10.

## Consequences

- One field in §8 Registrations of live-sync and in the protocol docs, changed in the same merge as the code (AGENTS §9.9).
- Not encryption at rest: the rows sit in the DM's DB file and backups (spec OQ-NOTES-07).
