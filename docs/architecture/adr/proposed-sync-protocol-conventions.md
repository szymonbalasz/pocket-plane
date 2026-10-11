# NNNN — Sync protocol conventions

- Status: proposed
- Date: 2026-10-11
- Affects: all specs with live state; [live-sync](../../specs/live-sync.md), [protocol](../../protocol/README.md)
- Extends: [ADR-0005](0005-server-authoritative-sync.md) (resolves its filter-granularity and optimistic-UI to-dos), [ADR-0016](0016-domain-events-pending-actions.md)

## Context

- Every feature spec plugs its records, intents and visibility into live-sync. These choices must be fixed before Phase 2 (skeleton) or every feature reworks its sync code.
- Detail and FRs: [live-sync §6, §9](../../specs/live-sync.md#9-api--events). Open questions OQ-SYNC-01, -03, -04, -07.

## Options

**A. WS event shape (OQ-SYNC-07)**

| Option | Pros | Cons |
|---|---|---|
| **Generic record changes `{type, id, op: upsert\|delete, data}` + `cause`** | One client reducer; reveal/hide fall out of upsert/delete; features add no client sync code | UI effects need `cause` to know *why* |
| Named per-feature events (`TokenMoved` …) | Expressive | A reducer per event; easy to miss reveal/hide paths |

**B. Visibility granularity (OQ-SYNC-01)**

| Option | Pros | Cons |
|---|---|---|
| **One fn per record type: `(record, ctx) → full \| redacted \| hidden`** | Covers hidden tokens and HP bands; same fn for snapshot and events | Each type must write and test its fn |
| Per-record drop only | Simplest | HP bands need extra records |
| Separate player projections | Explicit | Duplicated logic, drift |

**C. Snapshot scope (OQ-SYNC-03)**

| Option | Pros | Cons |
|---|---|---|
| **DM: whole campaign; player: campaign-scoped + active scene; scene switch resyncs players** | Bounded for players; no scene logic in filters | DM snapshot grows with scene count |
| Per-connection viewed scene | Smallest | Extra per-connection state and resync paths |
| Whole campaign for all | One rule | Filters must know which scene is active |

**D. Transport (OQ-SYNC-04)**

| Option | Pros | Cons |
|---|---|---|
| **Live-play intents over WS; CRUD/uploads over Hono RPC; same command layer, same events** | Fits ADR-0001; uploads stay HTTP | Two caller paths to test |
| Everything over WS | One path | Uploads and request/response awkward |

## Decision

> Undecided. Suggested: the **bold** option in each table, plus these rules:
> - Default deny: unregistered record types are hidden from players; intent handlers are DM-only unless they list `player`.
> - Visibility fns read only the record and the connection context; visibility flags live on the record.
> - Optimistic UI only for intents a spec marks optimistic; server result wins.

## Consequences

- Each spec's §9 lists record types (scope + visibility rule), intents (roles + ownership) and domain events (logged? transient? undoable?).
- Domain events carry `changes` (before/after per record); any record whose visibility changes must be included.
- Integrator seeds [protocol](../../protocol/README.md) with the envelopes and close/reject codes from live-sync.
