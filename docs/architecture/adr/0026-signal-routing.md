# 0026 — Signal routing: sender stamp, DM-only pull, receiver scene filter

- Status: accepted (2026-10-12; decisions-log #125)
- Amended by: [ADR-0033](0033-signal-audience.md) (optional per-signal `audience` hook: everyone / DM only / refuse, #172)
- Date: 2026-10-12
- Affects: [live-sync](../../specs/live-sync.md) (FR-SYNC-22), [protocol §3.3, §7](../../protocol/README.md#7-signals), [scenes-map](../../specs/scenes-map.md) (FR-MAP-23–25)
- Amends: [ADR-0021](0021-sync-protocol-conventions.md) signal handling. Raised by [OQ-MAP-16](../../specs/scenes-map.md#15-open-questions).

## Context

- Signal registration today is `name, schema, roles, visibility`; the server → client `signal` frame is `{name, data}` (live-sync §8, protocol §3.3). Signals have no handler.
- Ping and laser must show who sent them (colour per role) and must not be spoofable. Receivers can't tell the sender from `{name, data}` alone.
- "DM pulls everyone's view" must not be sendable by players.
- A server-side "`sceneId` = active scene" check needs state beyond record + ctx; a per-connection rate limit adds hub state. Both are more than the table needs (trusted players, 64 KB frame cap exists).

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Hub stamps `from`; `map.pull` is its own DM-only signal; receivers filter by scene; no server scene check or rate limit** | Smallest change: one frame field + one forwarding rule; roles check already covers pull; nothing leaks (a sender only knows the scene it views) | A misbehaving player can spam signals until the frame cap or a later rate limit |
| B. Signal `authorize(data, ctx)` hook with the active-scene id + per-connection rate limit | Server drops off-scene and flood signals | New registry hook in shared core; hub holds per-connection counters; signals stop being state-free |
| C. Checks inside scenes-map | No shared change | Not possible: signals have no feature handler |

## Decision

**A** (integrator ruling, gate Scenes).

| Rule | Detail |
|---|---|
| Forwarding | The hub forwards a valid signal to every **other** live connection of the sender's campaign; never back to the sender |
| Sender stamp | Server → client frame becomes `signal {name, data, from {role, playerId?}}`; `from` comes from the connection context, never from the payload |
| Pull | `map.pull {sceneId, x, y}` is a separate signal with roles `[dm]`; the existing roles check drops it from players |
| Scene filter | Client-side: a receiver acts on a signal only if `data.sceneId` is the scene it shows (player: active; DM: viewed) |
| Not added | No server `sceneId` check, no `authorize` hook, no rate limit (post-MVP) |

## Consequences

- live-sync FR-SYNC-22 and protocol §3.3 / §7 gain `from` and the "other connections" rule; integrator updates them at merge.
- Built after the skeleton as one sequenced shared change (AGENTS §9.9: `src/server/ws/`, `src/shared/protocol/`), before the scenes-map build; owner: orchestrator.
- Tests: ping reaches every other connection with the right `from`, not the sender; a spoofed `from` in `data` is ignored; player `map.pull` dropped (nobody receives it); signals touch no DB, log or `seq`.
- A rate limit, if needed later, is a new ADR.
