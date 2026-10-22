---
title: Live sync, reconnect, visibility
prefix: SYNC
status: in-review
owner: spec-live-sync, spec-fx
wave: 1
phase: post-mvp-9
---

# Live sync, reconnect, visibility

> **Sprint 3 revision: lazy record types (decided #207, 2026-10-16; written by party-board by orchestrator assignment, review ruling L2).** Implements [ADR-0045](../architecture/adr/0045-lazy-record-types.md) option A, accepted at DM gate 1 (OQ-PARTY-03). New FR-SYNC-30–38; nothing below this block changes. One generic on-demand path for campaign- and global-scope types (seams S1). Consumers: party-board `handout`, `handout-body`, `party-item`; compendium `imported-entity`; effect-modifiers `rule-trigger`. Built by `fix/lazy-records` (after V0, before P core and C2).
>
> | ID | Requirement | Named test |
> |---|---|---|
> | FR-SYNC-30 | **Registration:** a record type may declare `lazy: "all" \| "ids"`, campaign or global scope only. `"all"` allows whole-type and id loads; `"ids"` id loads only. `lazy` on a scene-scope type, or together with `window` / `dmWindow`, throws at registration (boot). A lazy type is omitted from every snapshot, DM included. | `FR-SYNC-30 lazy registration: scene scope and window combos throw; lazy types absent from DM and player snapshots` |
> | FR-SYNC-31 | **`sync.load {type, ids?}`** intent, DM and player, read-only: no bus, DB write, event log or `seq`. `invalid`: unknown type, non-lazy type, `"ids"` type without `ids`, `ids` empty, > 50 or not unique. `forbidden`: the type's audience excludes the sender (e.g. `audience: dm` loaded by a player). No other rejects. | `FR-SYNC-31 sync.load validation: invalid and forbidden cases, no change` |
> | FR-SYNC-32 | **Result** `ack {records {<type>: Record[]}}`: every row of the type (no `ids`) or the rows among `ids`, through the **scope gate** and the visibility fn exactly as a snapshot would send them (`redacted` stays redacted). Ids not visible or not existing are absent, never an error. Scope gate: campaign scope = the sender's campaign only; global scope = any connection passes, the visibility fn and audience decide (as FR-SYNC-09). Result frames count against the 4 MiB send limit only; each lazy type states its worst load in its spec §12. | `FR-SYNC-32 load result filtered as snapshot: hidden ids absent, redacted fields, other campaign absent, global gate` |
> | FR-SYNC-33 | **Frame order:** the load is answered in the hub's frame order (as `sync.loadScene`, [ADR-0041](../architecture/adr/0041-active-scene-window.md)): changes committed before the read are in the result, later ones follow as events; none lost, none duplicated (as FR-SYNC-10, using FR-SYNC-26's pause hook). | `FR-SYNC-33 commit during load: in result or as later event, never both, never neither` |
> | FR-SYNC-34 | **Live events unchanged:** lazy rows reach every connection that may see them, loaded or not; visibility flips upsert / delete per FR-SYNC-19. An event never marks a type or id loaded. | `FR-SYNC-34 events for unloaded lazy rows delivered, loaded set unchanged` |
> | FR-SYNC-35 | **Client loaded set:** the store keeps `loadedTypes` (whole-type loads) and `loadedIds` per type (id loads, a union across calls). API in `src/client/common/`: `useLazyRecords(type)` / `useLazyRecords(type, ids)` → `{rows, state: loading \| ready \| error, retry}`, and `isLoaded(type, id)`. An id load requests only ids not yet loaded, in chunks of ≤ 50; at most one load in flight per (type, chunk); loads once per snapshot generation. A whole-type load marks the type loaded; a later id load on it is a no-op. A reject → `error`, nothing marked loaded. Consumers decide "is it there" with `isLoaded`, **never by presence in the store**. | `FR-SYNC-35 useLazyRecords: chunks of 50, no reload of loaded ids, whole-type covers ids, reject → error + retry` |
> | FR-SYNC-36 | **Replace on load:** a whole-type result replaces every row of that type in the store; an id result replaces those ids (a requested id absent from the result is removed from the store). | `FR-SYNC-36 load replaces: stale rows of the type / requested ids removed` |
> | FR-SYNC-37 | **Snapshot purge:** every snapshot (connect, `resync`, reconnect, campaign switch) removes **every lazy-type row** from the store and resets `loadedTypes` / `loadedIds`; open consumers reload (new generation). So a row unshared or deleted while the client was away can't be shown from a stale store. | `FR-SYNC-37 snapshot purges lazy rows and loaded sets; stale row not readable after reconnect` |
> | FR-SYNC-38 | **Test helpers** (`src/server/ws/testing/`): FR-SYNC-20 convergence compares lazy types only for loaded types / ids (`convergence` takes the client's loaded set, as ADR-0041); `leakScan` also scans `sync.load` acks; a `lazyLoadSizes` helper measures a type's worst load for spec §12. | `FR-SYNC-38 convergence with loaded set; leak scan covers load acks` |
>
> Data model §8 *Registrations* gains `lazy?`; §9 *Client → server* gains `intent sync.load {type, ids?}` (DM, player; FR-SYNC-31). Protocol docs change with the code in `fix/lazy-records` (AGENTS §9.9).

> **Sprint 9 (track FX, fix pack; DM [#338](../decisions-log.md)).** **BL-54**: a player who went offline kept "Connected" for about 24 s. New FR-SYNC-40: the client marks the socket dropped at once on `offline` or 5 s without a frame after a ping, without waiting for the close handshake. Slice **FX3**, walkthrough [§13 FX3](#13-test-plan). Server unchanged, 0 B.

## 1. Summary

- Cross-cutting: how every feature's state reaches clients live. Built first, in the Phase 2 skeleton. Features plug in via [§9](#9-api--events) and the [ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md).
- Intent → validate → mutate + commit → domain event → **visibility filter** → WS events ([ADR-0005](../architecture/adr/0005-server-authoritative-sync.md), [ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)). Reconnect = fresh snapshot; state survives a crash ([ADR-0006](../architecture/adr/0006-persistence.md)).
- **Playtest pass** (#171; FR-SYNC-28, 29): a signal type may route itself (DM only vs everyone) or refuse a sender, so scenes-map's live **drag preview** never leaks a hidden token ([ADR-0033](../architecture/adr/0033-signal-audience.md)); presence is "unknown" while the DM is not live (G10).

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
| FR-SYNC-05 | Client auto-reconnects forever: backoff 0.5 s doubling to 1.5 s (#131), ±20 % jitter; also retries at once when the tab regains focus, becomes visible or goes online. Stops only on `4401`. Never resends intents in flight at disconnect. | No double damage |
| FR-SYNC-06 | Player `hello` whose campaign is not active → close `4409 campaign-inactive`, no other frame. Client enters `waiting` (campaign-management's screen), keeps reconnecting, and joins without reload ≤ 10 s after the campaign is activated. | Retryable |
| FR-SYNC-07 | When a change of active campaign commits, the hub closes every connection whose `campaignId` ≠ the new one with `4409`. The DM client reconnects at once into the new campaign; players wait (FR-SYNC-06). | Campaign never changes on a live connection |
| FR-SYNC-08 | After a valid `hello`, exactly one `snapshot` (seq 0, with `you {campaignId, role, playerId}`) precedes any `event`. Client replaces its whole store with it and drops optimistic state. | |
| FR-SYNC-09 | Snapshot = each record type's provider output through the filter. Scopes: `global` (imported definitions, [ADR-0018](../architecture/adr/0018-global-imported-content.md)), `campaign`, `scene` (DM: all scenes; player: active scene only). The `scene` gate (`sceneOf(record)` = active scene, else hidden for players) applies to snapshots **and** live events. | OQ-SYNC-03, CON-22 |
| FR-SYNC-10 | Changes committed between snapshot read and send arrive as events after it: none lost, none duplicated. | Hook: FR-SYNC-26 |
| FR-SYNC-11 | Client `resync` → fresh snapshot. Switching the active scene resyncs every player connection of the campaign. | |
| FR-SYNC-12 | Intents are zod-validated and dispatched by `name`. Unknown → `reject unknown_intent`; bad payload or JSON → `reject invalid` (issues), connection stays open. Frame > 64 KB → close `1009`. | |
| FR-SYNC-13 | Handlers declare roles (**default DM only**) and, if players are allowed, an ownership check. Failure → `reject forbidden`, no change, no event. | [ADR-0004](../architecture/adr/0004-tenancy-auth-permissions.md) |
| FR-SYNC-14 | Every intent gets exactly one `ack` or `reject`, sender only, keyed by `intentId`. Events it caused reach the sender **before** the `ack`. | Needs synchronous listeners: [ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md) option F (decided: synchronous) |
| FR-SYNC-15 | Commands called via REST (Hono RPC) produce the same events; the result comes in the HTTP response. | OQ-SYNC-04 |
| FR-SYNC-16 | Domain events are appended to the event log in the commit's transaction (unless their spec marks them non-logged) and dispatched only after commit. Commit hooks (cache refresh only) run after commit, before any listener (CON-23). Rollback → no event, no log entry. A listener failure never rolls back. | [ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md) |
| FR-SYNC-17 | Per domain event, each connection gets at most one `event` holding its filtered changes `{type, id, op: upsert \| delete, data?}` (upsert = whole filtered record), applied atomically; nothing if none survive. | OQ-SYNC-07, OQ-SYNC-14 |
| FR-SYNC-18 | Visibility fn per record type: `(record, ctx) → full \| redacted \| hidden`. DM gets `full`. Unregistered type → hidden for players. | OQ-SYNC-01 |
| FR-SYNC-19 | Per connection: hidden→visible = `upsert`; visible→hidden = `delete`; visible→visible = `upsert`; hidden→hidden = nothing. | Reveal = appear |
| FR-SYNC-20 | Snapshot and events share the filter: for any change sequence, a player's store equals a fresh snapshot; for windowed types ([ADR-0029](../architecture/adr/0029-windowed-record-types.md)) only pinned rows and rows at or above the window floor are compared. | Convergence |
| FR-SYNC-21 | `event` carries a per-connection `seq` (1, 2, … after each snapshot); gap → client `resync`. Send-buffer overflow or broadcaster error → close `4000`, never drop frames. | |
| FR-SYNC-22 | **Signals** are not domain events. `signal {name, data}` is checked against its registered type (zod + roles; failure → `reject` to the sender, nobody receives it) and forwarded to every **other** live connection of the sender's campaign as `signal {name, data, from {role, playerId?}}`; `from` is stamped by the server from the connection context, never the payload. Receivers filter by scene. No bus, DB, event log, snapshot or `seq`. A type with an `audience` hook routes per FR-SYNC-28. | [ADR-0026](../architecture/adr/0026-signal-routing.md); [scenes-map](scenes-map.md) ping/laser/pull; amended #171 |
| FR-SYNC-23 | DM gets a `presence {playerId, online}` record per player: ≤ 1 s after connect or clean close, ≤ 30 s after a silent drop. Not persisted, never sent to players. | |
| FR-SYNC-24 | Client state `connecting \| live \| reconnecting \| waiting \| rejected`; intent controls disabled unless `live`. "Reconnecting…" banner after 1 s not live; after 60 s it adds "Server unreachable — check with your DM". | |
| FR-SYNC-25 | Hub, broadcaster and presence hold no play state. After restart on the same DB, snapshots contain every change committed before the kill. | |
| FR-SYNC-26 | Test seams: injectable clock and timers (heartbeat, backoff); a test-only hook pauses a snapshot between read and send so a test can commit in that window. | [ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md) |
| FR-SYNC-27 | Test mode only: **sync probe** record type, its intents (§9), a probe panel and a "drop connection" button in both clients. Absent otherwise. | |
| **Playtest pass** (#171) | | |
| FR-SYNC-28 | **Signal audience** ([ADR-0033](../architecture/adr/0033-signal-audience.md), decided #172): a signal type may register `audience(data, sender {role, playerId?, campaignId}, read) → "all" \| "dm"`; `read` = read-only DB access + active-scene cache, no writes. The hub runs it once per signal after the zod + roles checks. A thrown reject (`not_found`, `forbidden`, `invalid`) goes to the sender only; nobody receives the signal. `"all"` = FR-SYNC-22 forwarding; `"dm"` = every other live **DM** connection of the campaign only. No hook = FR-SYNC-22 unchanged. A hook error is logged at most once per (connection, signal name) per 10 s. Still no bus, DB write, log, snapshot, `seq` or rate limit. First user: scenes-map `map.drag` ([FR-MAP-41](scenes-map.md#6-functional-requirements)). | P3; amends ADR-0026 |
| FR-SYNC-29 | **Presence while not live** (G10): presence is only known while the client is `live`. The client marks it unknown on leaving `live` (drop, server outage, `waiting`) and takes it from the next snapshot; every presence display shows "unknown", never stale values (DM badge: [FR-SHELL-33](play-shell.md#6-functional-requirements)). Client-only; server presence rules (FR-SYNC-23) unchanged. | G10 |
| **Sprint 7** (#315) | | |
| FR-SYNC-39 | **Feature switches** ([ADR-0058](../architecture/adr/0058-feature-switches.md), OQ-GEM-17): the connection context gains the campaign's `features`. A record type, log kind or intent registered with `feature: <key>` is hidden from every viewer (DM included) in the snapshot, live frames and `sync.load` while that feature is off, and its intents reject `forbidden`. Switching a feature resyncs every connection of the campaign (client-only UI state kept, FR-SYNC-11). | Built by `fix/gems-core`; tests: off = no tagged data in any frame / ack; on / off resync |
| **Sprint 9** (track FX, fix pack, #338) | | |
| FR-SYNC-40 | **Drop detection** (BL-54: a player offline kept "Connected" for about 24 s; amends FR-SYNC-04's client side).<br>• **Root cause** (code read, `sync/connection.ts`): the state leaves `live` only in `onclose`. The pong check runs on the 10 s ping tick with a 20 s threshold, then calls `ws.close()` and waits for a close handshake that a dead link delays (that delay is a hypothesis). There is no `offline` listener.<br>• **Rule:** the browser's `offline` event, or a `ping` with no frame of any kind back within **5 s**, marks the socket dropped **at once**: the client detaches it (its late `onclose` and frames are ignored), enters `reconnecting` (FR-SYNC-24), closes it best-effort and starts FR-SYNC-05's backoff. `online` still retries at once.<br>• The heartbeat check runs every 1 s, so a silent drop shows "Reconnecting…" within 15 s (10 s ping + 5 s) and an `offline` event within 1 s.<br>• Server unchanged: it closes after 30 s of silence, and presence follows within 30 s (FR-SYNC-23).<br>• No intent is resent (FR-SYNC-05). | `FR-SYNC-40 drop detection` (FX3) |

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
| Registrations *(code)* | record type: type, scope, schema, campaignOf, sceneOf (scope `scene`), visibility, snapshot; intent: name, schema, roles, authorize, execute; signal: name, schema, roles, `audience?` (#171) | scope `global`\|`campaign`\|`scene` | Intent roles default `[dm]`; signal routing per FR-SYNC-22, FR-SYNC-28 |
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
| `signal` | `name`, `data`, `from {role, playerId?}` (server-stamped) | Every other live connection of the sender's campaign (FR-SYNC-22); a type's `audience` may narrow it to DM connections or refuse it (FR-SYNC-28) |
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
- **Playtest pass:** an `audience` hook throwing a non-reject error → `reject internal` to the sender, nobody receives it, connection stays open. Signals in flight at a crash or drop are lost (as FR-SYNC-22); receivers clear signal-driven state on a snapshot (feature rule, e.g. FR-MAP-40). Presence during a DM drop or server outage: "unknown" (FR-SYNC-29); players are unaffected.

## 12. Performance & bandwidth

- 1 DM + ≤ 6 players, one process. Commit → frame < 50 ms locally; snapshot ≤ 512 KB JSON for a `session-sim`-sized campaign, < 200 ms (all proposed).
- Records carry asset IDs; clients build the URL ([assets-pipeline](assets-pipeline.md), [ADR-0023](../architecture/adr/0023-asset-access-by-capability-id.md)). Heartbeat keeps cloudflared from idling; JSON frames, no compression in MVP.

## 13. Test plan

- **Isolation:** fresh temp DB, asset dir and ports per run ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)); build loop per [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md). Stable links use seeded tokens, only when the data dir is flagged disposable.
- **Fixtures:** `base` (campaign, `player-1` "Player 1") and `player-2` ([fixtures-adapters](fixtures-adapters.md)); `campaign-second` ([campaign-management](campaign-management.md)); `sync-probes` (this spec, via `probe.set`): `public` (no owner), `secret` (hidden, text has `SECRET-PROBE`), `mine` (owner `player-1`).
- **Bundle `sync-probe`** = `base` + `player-2` + `campaign-second` + `sync-probes`.
- **Harness (shared):** in-process server, temp DB; `connect(dm | player-N)` → real store reducer, `nextEvent()`, `expectNoFrame(ms)`, frame log; fake clock; `pauseSnapshot()`; `restartServer()` keeps the DB.

| Level | What | Fixtures |
|---|---|---|
| Unit | Envelopes; transition matrix; default deny; scope gate; backoff (fake clock); reducer incl. seq gap. **Playtest:** `FR-SYNC-29 presence unknown` (leaving `live` marks it unknown; snapshot restores; `waiting` → unknown) | In-code |
| Integration | 4408/4401/4409 with no data frame; snapshot race via `pauseSnapshot`; rejects → no event; events before `ack`; rollback → no event/log; convergence per player; **leak scan** for `SECRET-PROBE`; switch closes old campaign, waiting player rejoins; presence; overflow → 4000; restart → identical snapshots | `sync-probe` |
| Integration (playtest) | `FR-SYNC-28 audience`, with a test-registered signal whose hook reads a probe: probe hidden → `"dm"`: a second DM connection receives it, `player-1` / `player-2` don't (`expectNoFrame`); visible → all others; hook rejects → only the sender gets `reject`, nobody else a frame; hook throws → `reject internal`; no hook → ADR-0026 forwarding; no DB write, log row or `seq` change | `sync-probe` |
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
| 8 | Hard-kill server, restart on same DB | — | All show "Reconnecting…", then rejoin; state unchanged. During the outage A's presence shows "unknown" (badge "– / 2 online", no online dots), not "2/2 online" (FR-SYNC-29) |
| 9 | — | New context D: mangled link | Invalid-link screen ([campaign-management §7](campaign-management.md#7-uiux-notes) wording); no data frame (REST 404; any WS shows only the `4401` close) |

The audience hook's browser check is scenes-map's drag walkthrough ([scenes-map §13](scenes-map.md#13-test-plan) step 10: the hidden Wolf's drag never reaches B, C).

**Sprint 9, track FX: slice FX3** (sync, shell, misc; FR-SYNC-40, [FR-SHELL-175–176](play-shell.md#6-functional-requirements), [FR-CAMP-51](campaign-management.md#6-functional-requirements), BL-81's e2e helper; [FR-CBTX-75](combat-extras.md#6-functional-requirements) / [FR-PARTY-86](party-board.md#6-functional-requirements) only if the DM picks them).
- **Unit `connection.test.ts`** (fake socket + clock, FR-SYNC-26). `FR-SYNC-40 drop detection`:
  - The fake socket never fires `onclose`; the clock advances 15 s past the last frame → `reconnecting`, and a new socket opens on the backoff.
  - `offline` → `reconnecting` within one tick.
  - A late `onclose` or frame of the detached socket changes nothing.
  - Any frame resets the 5 s deadline.
- **E2E (thin) `e2e/fx-stale-chunk.e2e.ts`** (bundle `base`; reads only):
  - DM page loaded; `page.route` answers the Dice tray chunk with 404 → open the Dice tray → `ui-window-reload` shows.
  - The map, Game log roll and other windows still work.
  - Unroute + Reload → the tray opens.
- **E2E support** (BL-81, no spec change; a bug against [FR-SHELL-57](play-shell.md#6-functional-requirements)'s footprint rule):
  - `e2e/support/konva.ts` `tokenNode` centres on the `map-token` group's footprint (its absolute position + size cells × `data-cell-px`), never on a child `Circle`.
  - New assertion `BL-81 tokenNode centres on the footprint` in `e2e/cp-tokens.e2e.ts`: an image token with an icon row → the centre is the footprint's.
  - `cb-turn-ring` and `cp-tokens` stay green.

**Walkthrough FX3** (test agent; bundle `session-sim-12`, profile `verify`; **A** DM, **B** `player-1`, **C** `player-2`):

| # | Do | Expect |
|---|---|---|
| 1 | C: context offline; after 5 s back online | Chip "Reconnecting…" within 1 s; "Connected" within 2 s of online; no intent resent |
| 2 | C: stop pongs silently (`routeWebSocket`, server → client dropped) | Chip leaves "Connected" within 15 s |
| 3 | A: page open; `bun run build` in the worktree (new chunk hashes); open the Dice tray | "New version available" + Reload in the tray's body; map, socket and other windows live; Reload → the tray opens (BL-91, the DM's real repro) |
| 4 | A at 1280×720 and 1024×768: rename the campaign to a 40-character name | Switcher name ends in "…", full name in the Tooltip; nothing cut; switching still works (BL-77) |
| 5 | *(If [OQ-CBTX-37](combat-extras.md#15-open-questions) A)* Thorn concentrating on Conjure Elemental with his elementals; Mira on Bless; A: End | Elementals gone, Thorn's concentration ended on A, B, C; Mira's Bless kept |
| 6 | *(If [OQ-PARTY-47](party-board.md#15-open-questions) B)* B creates a draft PC | C's Party status doesn't list it; A and B do |
| 7 | Hard kill + restart after step 5 | `state:digest` equal; step 5's state kept |

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [campaign-management](campaign-management.md) | Resolvers; campaign/player record types; activation domain event; invalid-link + waiting screens; `campaign-second` | agreed |
| [fixtures-adapters](fixtures-adapters.md) | `base`, `player-2`; bundles build on `base` | agreed |
| [ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md) open row "Listener execution" | **Synchronous, after commit** (FR-SYNC-14 relies on it) | open — pick synchronous ([proposed ADR option F](../architecture/adr/0021-sync-protocol-conventions.md#options), needs DM OK) |
| [scenes-map](scenes-map.md) / [play-shell](play-shell.md) | Active scene id + resync on switch, ping/laser as signals / hosts indicator, banner, presence | open |
| Build conventions (AGENTS.md) | `PP_TEST_MODE`, `PP_DATA_DISPOSABLE`, ports: AGENTS §9.2 (agreed, pending merge); WS path: open (OQ-SYNC-15) | agreed, pending merge |
| [scenes-map](scenes-map.md) (playtest) | `map.drag` registers the first `audience` hook (FR-MAP-41) | complete (#172) |
| [campaign-management](campaign-management.md) | FR-CAMP-14 / §7: online dot hidden (muted "–") while the DM client is not `live` (FR-SYNC-29); CAMP §7 amended at consolidation (#172) | agreed |

**Shared changes** (playtest pass, #171; shared core, orchestrator routes per AGENTS §9.9):
- `src/server/ws/signals.ts` (`SignalDef.audience?`), `src/server/ws/hub.ts` (run it; `"dm"` routing; reject / `internal`); hub gets read-only DB + active-scene cache access for the hook. `src/shared/protocol/`: none (frames unchanged).
- Client: `src/client/common/sync/store.ts` or `connection.ts`: presence marked unknown while not `live` (a `usePresence()` returning `{known, records}`), used by the DM badge (play-shell) and players panel (campaign-management).
- Docs consolidated (#172, protocol §30): protocol §7 routing (hook, `"dm"` audience), §15 (`map.drag`); [ADR-0033](../architecture/adr/0033-signal-audience.md). No schema, event or record-type change.

**Shared changes: sprint 9, FX3** `fix/fx-sync-shell` (orchestrator routes per AGENTS §9.9):
- **Shared:** `src/client/common/sync/connection.ts` (heartbeat, `offline`, detach) and `src/shared/protocol/frames.ts` (`CLIENT_PONG_TIMEOUT_MS` 20 000 → 5 000; the check interval), so `shared change needed`. FX3 is their only holder (seams S10).
- **Order** (seams S5, S10): FX3 builds in wave 2, in parallel with RS0, and **merges after RS0**. Its BL-91 `ShellWindow.tsx` branch lands after PM1.
- **Docs:** protocol heartbeat paragraph (FR-SYNC-04 / -40). Server unchanged.
- The rest of FX3's split: [play-shell §14](play-shell.md#14-dependencies) (BL-91), [campaign-management §14](campaign-management.md#14-dependencies) (BL-77).

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
| ~~OQ-SYNC-16~~ | ~~How a hidden token's drag preview stays off players' sockets (P3)~~ | **Decided (#172):** per-signal `audience` hook, `"all"` / `"dm"` + sender reject ([ADR-0033](../architecture/adr/0033-signal-audience.md), option A); no longer blocking | — | scenes-map, protocol §7, §15 |

## 16. Out of scope

- Multi-DM; player-ready indicator ([scene-tools](scene-tools.md)); DM "view as player" (tier C, [play-shell](play-shell.md)). Fixture load into a running server: CLI refuses ([fixtures-adapters](fixtures-adapters.md) OQ-FIX-10).
