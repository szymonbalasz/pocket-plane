# 0005 — Server-authoritative sync

- Status: accepted
- Date: 2026-10-10
- Affects: all specs with live state

## Context

- ~7 concurrent clients, hidden information (fog, hidden tokens, monster HP). Clients can't be trusted with secrets or with resolving conflicts.

## Decision

- **Server is authoritative.**
- Clients send **intents**. Server validates (zod + ownership), mutates, then broadcasts.
- Broadcasts are **per-record events**, not whole-state diffs.
- Every event passes a **visibility filter**: DM sees all; players see a filtered view.
  > TODO (spec phase): filter granularity (drop whole record vs redact fields), in [live-sync](../../specs/live-sync.md).
- **Reconnect = request snapshot** (filtered full state). No event replay.

## Consequences

- Each spec lists its events and a visibility rule per event.
- Optimistic UI is allowed client-side but server result wins.
  > TODO (spec phase): optimistic UI policy, in [live-sync](../../specs/live-sync.md).
- Revealing something (e.g. un-hiding a token, removing fog) must emit events that make it appear for players, not just change a flag.
- Snapshot size must stay bounded per campaign/scene ([live-sync](../../specs/live-sync.md)).
