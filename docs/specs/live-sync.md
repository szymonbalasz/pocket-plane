---
title: Live sync, reconnect, visibility
prefix: SYNC
status: complete
owner: spec-live-sync
wave: 1
---

# Live sync, reconnect, visibility

## 1. Summary

- Cross-cutting: how every feature's state reaches clients live. Built first, in the Phase 2 skeleton. Features plug in via [§9](#9-api--events) and the [ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md).
- Intent → validate → mutate + commit → domain event → **visibility filter** → WS events ([ADR-0005](../architecture/adr/0005-server-authoritative-sync.md), [ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)). Reconnect = fresh snapshot; state survives a crash ([ADR-0006](../architecture/adr/0006-persistence.md)).

## 2. Scope

- WS lifecycle (`hello` auth, heartbeat, auto-reconnect, close codes); envelopes; record-type registry with visibility fns.
- Snapshot on (re)connect; resync on active-scene switch; campaign switch closes other campaigns' connections (one active campaign, [decisions-log](../decisions-log.md) #108).
- Broadcaster as a domain event bus listener; event log write hook ([ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)).
- **Signals** (ping, laser): transient, not domain events; bypass the bus, DB and event log. **Presence** (DM sees who is online): not in [feature tiers](../feature-tiers.md); near-free, kept under the tier B rule ([decisions-log](../decisions-log.md) #114).
- Client connection state + reconnect banner; multi-client test harness; test-mode **sync probe** record.

## 3. Goals

- **Zero leakage:** no DM-only record or field ever appears in a player connection's frames.
- **Convergence:** a player's store after live events equals a fresh snapshot.
- **Reconnect** (numbers proposed, OQ-SYNC-13): drop shown ≤ 20 s after a silent loss (at once on a clean close); live ≤ 2 s after the server is reachable.
- **Crash-safe:** after a hard kill + restart on the same DB, every committed change reaches every client.
- **Plug-in cost:** a feature adds record types, intents and visibility fns without touching hub, broadcaster or client sync code.

## 4. Non-goals

- Event replay from the event log ([ADR-0005](../architecture/adr/0005-server-authoritative-sync.md)); offline play; field-level diffs; multi-server.
- Credentials, link format, DM login, invalid-link and waiting screens ([campaign-management](campaign-management.md)); per-feature visibility rules (each feature spec).

## 5. User stories

- As the DM, I want hidden things to stay hidden even if a player opens dev tools.
- As the DM, I want a crash or laptop sleep to cost a restart, not the session.
- As a player, I want my view to recover by itself after Wi-Fi drops or a campaign switch, without reloading.

## 6. Functional requirements

| ID | Requirement | Notes |
|---|---|---|
| FR-SYNC-01 | One WS endpoint. No `hello` within 5 s of open → close `4408`. | |
| FR-SYNC-02 | `hello.credential` resolves via campaign-management's resolvers to a context `{connId, campaignId, role, playerId?}`. Invalid → close `4401`, no other frame. DM `campaignId` = active campaign at `hello`. Resolver `throttled` → close `4401` (FR-CAMP-05); `noActiveCampaign` → close `4409` (the DM client normally opens no WS then, [campaign-management §9](campaign-management.md#9-api--events)). | [ADR-0019](../architecture/adr/0019-auth-credentials.md) |
| FR-SYNC-03 | Context is fixed for the connection's life; ids or role in payloads are never trusted. Several connections per player or DM each get the same stream. | |
| FR-SYNC-04 | Client sends `ping` every 10 s; server answers `pong` and closes a connection silent 30 s. Client treats 20 s without `pong` as dropped. | Keeps the tunnel alive |
| FR-SYNC-05 | Client auto-reconnects forever: backoff 0.5 s doubling to 5 s, ±20 % jitter. Stops only on `4401`. Never resends intents in flight at disconnect. | No double damage |
| FR-SYNC-06 | Player `hello` whose campaign is not active → close `4409 campaign-inactive`, no other frame. Client enters `waiting` (campaign-management's screen), keeps reconnecting, and joins without reload ≤ 10 s after the campaign is activated. | Retryable |
| FR-SYNC-07 | When a change of active campaign commits, the hub closes every connection whose `campaignId` ≠ the new one with `4409`. The DM client reconnects at once into the new campaign; players wait (FR-SYNC-06). | Campaign never changes on a live connection |
| FR-SYNC-08 | After a valid `hello`, exactly one `snapshot` (seq 0, with `you {campaignId, role, playerId}`) precedes any `event`. Client replaces its whole store with it and drops optimistic state. | |
| FR-SYNC-09 | Snapshot = each record type's provider output through the filter. Scopes: `global` (imported definitions, [ADR-0018](../architecture/adr/0018-global-imported-content.md)), `campaign`, `scene` (DM: all scenes; player: active scene only). | OQ-SYNC-03 |
| FR-SYNC-10 | Changes committed between snapshot read and send arrive as events after it: none lost, none duplicated. | Hook: FR-SYNC-26 |
| FR-SYNC-11 | Client `resync` → fresh snapshot. Switching the active scene resyncs every player connection of the campaign. | |
| FR-SYNC-12 | Intents are zod-validated and dispatched by `name`. Unknown → `reject unknown_intent`; bad payload or JSON → `reject invalid` (issues), connection stays open. Frame > 64 KB → close `1009`. | |
| FR-SYNC-13 | Handlers declare roles (**default DM only**) and, if players are allowed, an ownership check. Failure → `reject forbidden`, no change, no event. | [ADR-0004](../architecture/adr/0004-tenancy-auth-permissions.md) |
| FR-SYNC-14 | Every intent gets exactly one `ack` or `reject`, sender only, keyed by `intentId`. Events it caused reach the sender **before** the `ack`. | Needs synchronous listeners: [ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md) option F (decided: synchronous) |
| FR-SYNC-15 | Commands called via REST (Hono RPC) produce the same events; the result comes in the HTTP response. | OQ-SYNC-04 |
| FR-SYNC-16 | Domain events are appended to the event log in the commit's transaction (unless their spec marks them non-logged) and dispatched only after commit. Rollback → no event, no log entry. A listener failure never rolls back. | [ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md) |
| FR-SYNC-17 | Per domain event, each connection gets at most one `event` holding its filtered changes `{type, id, op: upsert \| delete, data?}` (upsert = whole filtered record), applied atomically; nothing if none survive. | OQ-SYNC-07, OQ-SYNC-14 |
| FR-SYNC-18 | Visibility fn per record type: `(record, ctx) → full \| redacted \| hidden`. DM gets `full`. Unregistered type → hidden for players. | OQ-SYNC-01 |
| FR-SYNC-19 | Per connection: hidden→visible = `upsert`; visible→hidden = `delete`; visible→visible = `upsert`; hidden→hidden = nothing. | Reveal = appear |
| FR-SYNC-20 | Snapshot and events share the filter: for any change sequence, a player's store equals a fresh snapshot. | Convergence |
| FR-SYNC-21 | `event` carries a per-connection `seq` (1, 2, … after each snapshot); gap → client `resync`. Send-buffer overflow or broadcaster error → close `4000`, never drop frames. | |
| FR-SYNC-22 | **Signals** are not domain events. `signal {name, data}` is checked against its registered type (zod + roles) and forwarded through its visibility fn. No bus, DB, event log, snapshot or `seq`. | [scenes-map](scenes-map.md) ping/laser |
| FR-SYNC-23 | DM gets a `presence {playerId, online}` record per player: ≤ 1 s after connect or clean close, ≤ 30 s after a silent drop. Not persisted, never sent to players. | |
| FR-SYNC-24 | Client state `connecting \| live \| reconnecting \| waiting \| rejected`; intent controls disabled unless `live`. "Reconnecting…" banner after 1 s not live; after 60 s it adds "Server unreachable — check with your DM". | |
| FR-SYNC-25 | Hub, broadcaster and presence hold no play state. After restart on the same DB, snapshots contain every change committed before the kill. | |
| FR-SYNC-26 | Test seams: injectable clock and timers (heartbeat, backoff); a test-only hook pauses a snapshot between read and send so a test can commit in that window. | [ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md) |
| FR-SYNC-27 | Test mode only: **sync probe** record type, its intents (§9), a probe panel and a "drop connection" button in both clients. Absent otherwise. | |

## 7. UI/UX notes

- **Screens:** none. Components (shadcn Badge, Tooltip, Alert per [visual-direction](../design/visual-direction.md); placed by [play-shell](play-shell.md)): connection indicator, reconnect banner, DM presence list, test-mode probe panel.
- **States:** `connecting`: loading skeleton. `live`: dot + Tooltip "Connected". `reconnecting`: last state stays, banner, controls disabled. `waiting` / `rejected`: campaign-management's waiting / invalid-link screen (DM: back to login). No empty/error states of its own.
- **DM view:** indicator; presence list (name, online dot). Probe panel: all probes, hidden ones translucent; edit, hide/reveal, owner.
- **Player view:** indicator and banner; no presence. Probe panel: visible probes; edit own only.

## 8. Data model

| Entity | Field | Type | Notes |
|---|---|---|---|
| Connection *(in-memory)* | connId, campaignId, role, playerId | id, id, `dm`\|`player`, id \| null | Immutable |
| | phase, seq, lastInboundAt | `awaiting-hello`\|`snapshotting`\|`live`, int, timestamp | |
| Presence *(in-memory, derived)* | playerId, online | id, bool | From live connections |
| Record change *(in a domain event)* | type, id, before, after | string, id, record \| null ×2 | Create: before null; delete: after null |
| Registrations *(code)* | record type: type, scope, schema, visibility, snapshot; intent: name, schema, roles, authorize, execute; signal: name, schema, roles, visibility | scope `global`\|`campaign`\|`scene` | Intent roles default `[dm]` |
| Event log entry *(persisted)* | id, campaignId, type, at, payload, actorRole, actorPlayerId, intentId | payload = **JSON leaf** | Append-only; `campaignId` null for global events (imported definitions, [FR-FIX-23](fixtures-adapters.md#6-functional-requirements)); undo fields: [combat-tracker](combat-tracker.md) |
| Sync probe *(persisted, test)* | id, campaignId, text, hidden, ownerPlayerId | id, id, string, bool, id \| null | Player sees it iff `!hidden && (owner == null \|\| owner == ctx.playerId)` |

- **Relations:** connection → campaign, player ([campaign-management](campaign-management.md)); scene records → scene ([scenes-map](scenes-map.md)).
- **Derived values:** presence; each connection's visible view; active campaign/scene ids (cached, rebuilt at boot). **Persisted runtime state:** event log, probes; connections and presence rebuild from reconnects. No per-record versions.

## 9. API & events

| Client → server | Who | Validation / ownership |
|---|---|---|
| `hello {credential}` | DM, player | First frame; resolvers per [ADR-0019](../architecture/adr/0019-auth-credentials.md) |
| `intent {intentId, name, payload}` | DM, player | Handler schema, roles, ownership |
| `signal {name, data}` / `resync {}` / `ping {}` | DM, player | Signal schema + roles / live connection |
| *(test)* intents `probe.set {id?, text, hidden, ownerPlayerId?}` / `probe.edit {id, text}` | DM / player | Owner is a player of `ctx.campaignId` / probe visible and `ownerPlayerId == ctx.playerId` |

| Server → client | Payload | Visibility rule |
|---|---|---|
| `snapshot` | `seq 0`, `you`, `records {type: Record[]}` | Each type's fn; scopes per FR-SYNC-09 |
| `event` | `seq`, `cause {name, intentId?}`, `changes[]` | Each type's fn + FR-SYNC-19; `intentId` on sender's copy only |
| `signal` | `name`, `data` | Signal type's fn |
| `ack` / `reject` / `pong` | `intentId`, `result?` / `code` (`invalid`, `unknown_intent`, `forbidden`, `not_found`, `conflict`, `internal`), `message`, `issues?` | Sender only |
| record `presence` / `probe` | see §8 | DM only / §8 rule |

- **REST:** only the WS upgrade (path `/ws` *(proposed)*, OQ-SYNC-15); auth is in `hello`. **Hub API:** `resync(selector)`, `disconnect(selector, code)`, `connections(campaignId)`.
- **Close codes:** `1001` shutdown, `1009` frame too large, `4000` resync required, `4408` no `hello` → reconnect. `4401` credential invalid → `rejected`. `4409 campaign-inactive` (retryable) → DM reconnects now, player `waiting`.
- **Plug-in conventions (every feature spec):** register record types (scope, schema, visibility fn, bounded snapshot provider) and intents (`<feature>.<verb>`, roles, ownership). Campaign and player are record types of [campaign-management](campaign-management.md). No named per-feature WS events.
- Visibility reads record + context only (OQ-SYNC-08). Domain events list `changes`, including every record whose visibility changes; per event state logged? and undoable?

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| `hello` | ✓ | ✓ | Credential resolves; player's campaign active |
| Receive records | full | filtered | Type's fn + scope; `ctx.campaignId` (+ `global`) only |
| Send intent / signal | if type allows DM | types listing `player` | Roles + ownership (probes: §9) |
| See presence | ✓ | — | Presence visibility = DM only |

## 11. Edge cases & failure modes

- **Player / DM disconnect:** stale view stays, banner, controls disabled; reconnect → fresh snapshot. In-flight intents not resent; if committed, they're in the snapshot. Players unaffected by DM drops. Tunnel restart / sleep: clients keep retrying; new tunnel host → re-shared links (campaign-management).
- **Campaign switch:** old campaign's players → `waiting`, rejoin on reactivation. A connection mid-snapshot is closed too.
- **Server crash mid-action:** open transaction rolls back → no event, log entry or `ack`. Crash after commit → change is in the next snapshot.
- **Concurrent edits:** serialised transactions, last commit wins; features guard non-idempotent actions (`conflict`). **Invalid / malicious input:** zod rejects; oversize frames close; spoofed ids ignored; unknown types hidden.

## 12. Performance & bandwidth

- 1 DM + ≤ 6 players, one process. Commit → frame < 50 ms locally; snapshot ≤ 512 KB JSON for a `session-sim`-sized campaign, < 200 ms (all proposed).
- Assets are URLs ([assets-pipeline](assets-pipeline.md)). Heartbeat keeps cloudflared from idling; JSON frames, no compression in MVP.

## 13. Test plan

- **Isolation:** fresh temp DB, asset dir and ports per run ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)); build loop per [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md). Stable links use seeded tokens, only when the data dir is flagged disposable.
- **Fixtures:** `base` (campaign, `player-1` "Player 1") and `player-2` ([fixtures-adapters](fixtures-adapters.md)); `campaign-second` ([campaign-management](campaign-management.md)); `sync-probes` (this spec, via `probe.set`): `public` (no owner), `secret` (hidden, text has `SECRET-PROBE`), `mine` (owner `player-1`).
- **Bundle `sync-probe`** = `base` + `player-2` + `campaign-second` + `sync-probes`.
- **Harness (shared):** in-process server, temp DB; `connect(dm | player-N)` → real store reducer, `nextEvent()`, `expectNoFrame(ms)`, frame log; fake clock; `pauseSnapshot()`; `restartServer()` keeps the DB.

| Level | What | Fixtures |
|---|---|---|
| Unit | Envelopes; transition matrix; default deny; scope gate; backoff (fake clock); reducer incl. seq gap | In-code |
| Integration | 4408/4401/4409 with no data frame; snapshot race via `pauseSnapshot`; rejects → no event; events before `ack`; rollback → no event/log; convergence per player; **leak scan** for `SECRET-PROBE`; switch closes old campaign, waiting player rejoins; presence; overflow → 4000; restart → identical snapshots | `sync-probe` |
| E2E (thin) | Playwright, DM + `player-1`: reveal/hide, reload, restart | `sync-probe` |

**Browser walkthrough.** With test mode on (`PP_TEST_MODE=1`, AGENTS §9.2), reset-and-load `sync-probe` and start the app (verify profile). Separate contexts: **A** DM, **B** `player-1`, **C** `player-2`. Throughout, B's and C's frames contain `SECRET-PROBE` only while `secret` is revealed.

| # | DM (A) | Players (B, C) | Expected |
|---|---|---|---|
| 1 | Log in | — | "Connected"; both players offline; 3 probes, `secret` translucent |
| 2 | — | B, C open links | Both online ≤ 1 s. B sees `public` + `mine`; C sees `public` |
| 3 | Edit `public`; reveal `secret`, then hide it | — | B, C update live; `secret` appears, then disappears |
| 4 | — | B edits `mine` | A and B update; C never sees `mine` |
| 5 | Edit `public`, reveal `secret` while B is dropped ("drop connection") | B back | B: banner + disabled controls, then both changes, no reload |
| 6 | Switch to "Second Campaign" | — | A reconnects: no probes. B, C on waiting screen |
| 7 | Switch back | — | A shows 3 probes; B, C rejoin ≤ 10 s, no reload |
| 8 | Hard-kill server, restart on same DB | — | All show "Reconnecting…", then rejoin; state unchanged |
| 9 | — | New context D: mangled link | Invalid-link screen ([campaign-management §7](campaign-management.md#7-uiux-notes) wording); no data frame (REST 404; any WS shows only the `4401` close) |

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [campaign-management](campaign-management.md) | Resolvers; campaign/player record types; activation domain event; invalid-link + waiting screens; `campaign-second` | agreed |
| [fixtures-adapters](fixtures-adapters.md) | `base`, `player-2`; bundles build on `base` | agreed |
| [ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md) open row "Listener execution" | **Synchronous, after commit** (FR-SYNC-14 relies on it) | open — pick synchronous ([proposed ADR option F](../architecture/adr/0021-sync-protocol-conventions.md#options), needs DM OK) |
| [scenes-map](scenes-map.md) / [play-shell](play-shell.md) | Active scene id + resync on switch, ping/laser as signals / hosts indicator, banner, presence | open |
| Build conventions (AGENTS.md) | `PP_TEST_MODE`, `PP_DATA_DISPOSABLE`, ports: AGENTS §9.2 (agreed, pending merge); WS path: open (OQ-SYNC-15) | agreed, pending merge |

## 15. Open questions

**Bold** = suggested pick. Cross-cutting picks: [ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-SYNC-01 | ~~Visibility granularity~~ **Decided: one fn per record type: full / redacted / hidden** (D4) | — | — | — |
| OQ-SYNC-02 | Optimistic UI | **Only intents a spec marks optimistic; server wins, reject reverts** (snappy where it matters) / never (simplest, laggier) | no — owner: spec-live-sync | scenes-map, character-sheet |
| OQ-SYNC-03 | ~~Snapshot scope~~ **Decided: DM whole campaign; player campaign + active scene; scene switch resyncs players** (D4) | — | — | — |
| OQ-SYNC-04 | ~~Transport~~ **Decided: live-play intents over WS; CRUD/uploads via Hono RPC; same command layer** (D4) | — | — | — |
| OQ-SYNC-05 | Detect missed events | **Per-connection seq; gap → resync; overflow closes** (cheap net) / none (silent drop risk) | no — owner: spec-live-sync | all specs |
| OQ-SYNC-06 | Reveal semantics | **Reveal = `upsert`, hide = `delete`** (no client code) / dedicated reveal event | no — owner: spec-live-sync | scenes-map, dice-roll-log |
| OQ-SYNC-07 | ~~WS event shape~~ **Decided: generic record changes + `cause` for all specs** (D4, integrator) | — | — | — |
| OQ-SYNC-08 | What may a visibility fn read? | **Record + context only** (pure, testable) / related records (reveal must list dependents) | no — owner: spec-live-sync | scenes-map, combat-tracker |
| OQ-SYNC-09 | ~~Handshake~~ **Decided: first-frame `hello` carries the credential** (D4) | — | — | — |
| OQ-SYNC-10 | ~~Presence~~ **Decided: DM-only, in-memory** (#114) | — | — | — |
| OQ-SYNC-11 | ~~Ping/laser~~ **Decided: signals, not domain events; bypass bus and log** (integrator) | — | — | — |
| OQ-SYNC-12 | ~~Sync probe~~ **Decided: yes, test mode only** (#114) | — | — | — |
| OQ-SYNC-13 | Numeric targets (§3, §12) | **As proposed** / DM sets others | no — owner: DM | vision |
| OQ-SYNC-14 | ~~Glossary~~ **Decided (integrator):** added **signal**, **presence**, **resync**, **record change**, **sync probe**; **WS event** = filtered record changes of one domain event (one or more records); **Snapshot** = sent by the server after `hello` and on `resync` | — | — | — |
| OQ-SYNC-15 | WS endpoint path | **`/ws`** *(proposed)*, same origin as the clients / other | no — owner: spec-live-sync | AGENTS §9.2, campaign-management OQ-CAMP-15 |

## 16. Out of scope

- Multi-DM; player-ready indicator ([scene-tools](post-mvp/scene-tools.md)); DM "view as player" (tier C, [play-shell](play-shell.md)). Fixture load into a running server: CLI refuses ([fixtures-adapters](fixtures-adapters.md) OQ-FIX-10).
