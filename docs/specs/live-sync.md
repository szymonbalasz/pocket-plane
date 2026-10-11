---
title: Live sync, reconnect, visibility
prefix: SYNC
status: unclaimed
owner: —
wave: 1
---

# Live sync, reconnect, visibility

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md).

## 1. Summary

- Cross-cutting: how every feature's state reaches clients live.
- Server-authoritative intents → validate → mutate → per-record events → visibility filter ([ADR-0005](../architecture/adr/0005-server-authoritative-sync.md)).
- Reconnect = snapshot. State survives server crash ([ADR-0006](../architecture/adr/0006-persistence.md)).

## 2. Scope

- WebSocket connection lifecycle: connect, auth (DM secret / player link), heartbeat, disconnect.
- Intent envelope and event envelope (shared zod schemas).
- Visibility filter contract that every feature plugs into.
- Snapshot on connect/reconnect.
- Presence: who's connected (DM sees players online). *(proposed)*
- Client-side connection state UI (connected / reconnecting / offline). *(proposed)*
- Conventions other specs follow when listing intents/events.
- WS broadcaster as a listener on the domain event bus ([ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)).

## 3. Goals

> TODO (spec phase): measurable outcomes (e.g. reconnect time, no secret leakage).

## 4. Non-goals

> TODO (spec phase).

## 5. User stories

> TODO (spec phase): DM and player stories.

## 6. Functional requirements

> TODO (spec phase): FR-SYNC-NN, each testable.

## 7. UI/UX notes

> TODO (spec phase): connection indicator, reconnect banner, presence list. DM view vs player view. Per [visual-direction](../design/visual-direction.md).

## 8. Data model

> TODO (spec phase): connection/presence records (if persisted), event sequence/version fields on records.

## 9. API & events

> TODO (spec phase): envelope schemas, snapshot request/response, presence events, error events. Visibility rule per event.

## 10. Permissions

> TODO (spec phase): how a connection is bound to DM or a player; how the filter uses it.

## 11. Edge cases & failure modes

> TODO (spec phase): flapping connections, tunnel restart, server crash mid-transaction, stale client after DM changes visibility, duplicate intents.

## 12. Performance & bandwidth

> TODO (spec phase): event rate limits (e.g. token drag), snapshot size budget, batching/coalescing.

## 13. Test plan

> TODO (spec phase): multi-client integration harness (DM + N players) usable by all other specs. Fixtures. Isolated per [ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md).

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [campaign-management](campaign-management.md) | Auth model for DM secret and player links | open |
| [fixtures-adapters](fixtures-adapters.md) | Multi-client harness seeds from fixtures | open |
| All feature specs | Their events and visibility rules (they depend on this spec's conventions) | — |

## 15. Open questions

**Bold** option = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-SYNC-01 | Visibility filter granularity | **Per-record drop + per-field redaction** / per-record only / separate player projections | yes | all specs |
| OQ-SYNC-02 | Optimistic UI policy | **Allowed for own low-risk intents (token drag), server result wins** / never optimistic | no | scenes-map, character-sheet |
| OQ-SYNC-03 | Snapshot scope | **Per campaign + active scene** / whole campaign / per feature on demand | yes | all specs |
| OQ-SYNC-04 | Intents over WS, REST, or both | **Live-play intents over WS; CRUD via Hono RPC** / everything over WS | yes | all specs |
| OQ-SYNC-05 | Detecting missed events without replay (sequence numbers → force resnapshot?) | **Per-connection seq; gap → resnapshot** / none | no | all specs |
| OQ-SYNC-06 | Reveal semantics: when a hidden record becomes visible, emit "created" to players? (MVP has few hidden records: DM-hidden rolls, inactive scenes) | **Yes, appear as create; hide as delete** / dedicated reveal event | no | dice-roll-log, scenes-map, post-mvp/scene-tools |

## 16. Out of scope

- Offline play / local-first sync.
- Event replay / history scrubbing.
- Multi-DM or co-DM.
