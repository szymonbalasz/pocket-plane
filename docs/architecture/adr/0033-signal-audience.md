# 0033 — Signal audience hook (server-side signal routing per signal type)

- Status: accepted (2026-10-14; decisions-log #172)
- Date: 2026-10-14
- Amends: [ADR-0026](0026-signal-routing.md) ("No server `sceneId` check, no `authorize` hook")
- Affects: [live-sync](../../specs/live-sync.md) (FR-SYNC-22, FR-SYNC-28), [scenes-map](../../specs/scenes-map.md) (FR-MAP-39–41), [protocol §7, §15](../../protocol/README.md#7-signals)
- Raised by: playtest P3, live drag preview (tier S, [decisions-log](../../decisions-log.md) #171)

## Context

- P3: while a token is dragged, others see it move. The DM's rule: a **hidden token's drag never reaches players**. The preview is ephemeral, throttled, never logged or persisted: a signal, like ping and laser ([FR-SYNC-22](../../specs/live-sync.md#6-functional-requirements)).
- Today the hub forwards a valid signal to **every** other connection of the campaign; receivers filter by scene. That was safe for ping / laser: a sender only knows the scene it views and the signal names nothing hidden.
- A drag signal names a token. Forwarded to players, a drag of a hidden token (or of a token on a non-active scene the DM is prepping) leaks its id and position, breaking scenes-map's zero-leakage goal. Client-side "don't send" is not a guarantee (live-sync goal: hidden stays hidden even with dev tools; a client bug leaks).
- A player could also send drag signals for tokens they may not move (fake previews of others' tokens).

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. Optional per-signal `audience(data, sender, read) → "all" \| "dm"`, may throw a reject; run once per signal before forwarding. Absent → today's rule** | One small hook; the token lookup stays in scenes-map; ping / laser / pull unchanged; sender authorisation and routing in one place | Hub gains a read-only DB / cache access path for signals; a signal costs one indexed read |
| B. Per-receiver visibility fn on signals (like record types) | Most general | A fn call per connection per frame (≤ 20/s); overkill for one rule |
| C. Client-only: DM client never sends drags of hidden tokens | No shared change | Not a guarantee; players could spoof previews |
| D. Drag preview as a non-persisted record type through the visibility filter | Reuses the filter | Records are domain-event changes: bus, `seq`, convergence for 20 frames/s; contradicts "signals bypass the bus" |

## Decision

**A** (DM, #172): optional per-signal `audience` hook, `"all"` / `"dm"`.

| Rule | Detail |
|---|---|
| Signature | `audience?(data, sender {role, playerId?, campaignId}, read) → "all" \| "dm"`; `read` = the same context record visibility / snapshot code gets (`{db, activeSceneOf(campaignId)}`), not a new shape; no transaction |
| Synchronous | No `await` (bun:sqlite is synchronous), so the hub keeps per-connection frame order |
| Read-only | A convention, not enforced: review check + a test that table row counts are unchanged after signals |
| Order | Hub: live → registered → role → zod → `audience` → forward. A thrown reject (`not_found`, `forbidden`, `invalid`) goes to the sender only; nobody receives the signal |
| `"all"` | Every other live connection of the campaign (ADR-0026 rule) |
| `"dm"` | Every other live **DM** connection of the campaign only (e.g. the DM's second tab) |
| No hook | ADR-0026 unchanged (ping, laser, pull) |
| Hook error | `reject internal` to the sender; logged at most once per (connection, signal name) per 10 s |
| Still not added | Rate limit (post-MVP); per-receiver filtering |

## Consequences

- live-sync: FR-SYNC-28 (hook); FR-SYNC-22 refers to it. protocol §7 routing rules gain the hook; §15 gains `map.drag`. Signal registration (`src/server/ws/signals.ts`, hub) is shared core (AGENTS §9.9): one sequenced shared change, before the scenes-map playtest build.
- scenes-map registers `map.drag` with an `audience` that applies FR-MAP-21 to players and routes hidden / non-active-scene tokens to the DM only.
- Tests: a test-registered signal with `"dm"` reaches only other DM connections; a reject reaches only the sender; `map.drag` of the hidden Wolf never appears in player frames (leak scan); hook absent → ADR-0026 behaviour.
- **Limitation:** `"all" | "dm"` is enough only while every player sees the same tokens. Per-player visibility (fog / vision, post-MVP) needs per-receiver filtering (option B) and a new ADR.
- **ADR-0026 lines amended:** "No server `sceneId` check, no `authorize` hook" → a signal type may register `audience`; its test bullet "signals touch no DB, log or `seq`" → "no DB **write**, log or `seq`".
- [ADR-0021](0021-sync-protocol-conventions.md)'s line "signals still pass their type's visibility fn" now has a concrete form for signals that need it.
