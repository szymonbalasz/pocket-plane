---
title: Notifications
prefix: NOTE
status: in-review
owner: spec-notifications
wave: 2
---

# Notifications

## 1. Summary

- **Notification**: a persisted, toast-like message with a history feed. It has a kind, an audience and optionally an action ([ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md), [decisions #47](../decisions-log.md)). With an action it is a **pending action** until resolved or dismissed (e.g. a damage card's "Apply"). Without one it is info.
- This spec owns the mechanism: record type, states, server helpers, toasts, history window. Kinds and payloads belong to the features that create them ([combat-tracker](combat-tracker.md): damage card).
- Created and resolved **inside the causing command's transaction** ([ADR-0027](../architecture/adr/0027-notification-creation.md), #135).
- **Polish pass** (sprint 1, R5; FR-NOTE-23, 24): a kind may declare that its pending rows are **dismissed when their encounter ends** (damage cards do; *pending DM gate, [OQ-CBT-45](combat-tracker.md#15-open-questions)*); handled action rows no longer count as unread.

## 2. Scope

- `notification` record type: kind, audience, text, payload, optional action, state, resolution, timestamps. Persisted, campaign-scoped, windowed snapshot ([ADR-0029](../architecture/adr/0029-windowed-record-types.md)).
- Server helpers for kind owners: `notify`, `resolveNotification`, `reopenNotification`; server kind registry. Intents `note.dismiss` (DM), `note.resolve` (opt-in kinds).
- Client view registries (icon, renderer, action handler); toasts; history window `note.history` in the [play shell](play-shell.md); per-browser unread badge.
- Polish pass: kind lifecycle option `onEncounterEnd` + helper `dismissForEncounter`; unread rule for action rows.
- Test mode only: kind `test` and intent `note.testSend`, so the loop is built and walked through before combat-tracker exists. MVP kinds: `damage-card` (combat-tracker), `test` (test mode). `loot-received` owned by [party-loot](party-loot.md) (#146).

## 3. Goals

- The DM never misses a pending damage card: it survives disconnect, reload and a server crash, and stays visible until handled.
- An action takes effect **exactly once**, even with double clicks or two tabs.
- A player who was tabbed out or offline catches up in one window.
- A feature adds a kind without changing notification, hub or client sync code.

## 4. Non-goals

- Wall-clock timers, scheduling, expiry ([ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)). Chat, browser/OS push, sounds.
- Notifications from post-commit rule listeners (concentration, durations: [combat-extras](post-mvp/combat-extras.md); ADR-0027 C).
- Read state synced across browsers. Loading history older than the snapshot window. Editing or deleting notifications. Pushing windows open on other clients ([OQ-SHELL-02](play-shell.md#15-open-questions)).

## 5. User stories

- As the DM, I want each player attack as a pending damage card that survives a crash or reload and that I apply (or dismiss) in one click, so nobody reads damage aloud and no hit is lost.
- As a player, I want to see what happened while I was away, and what came of my attack, without asking.
- As a player, I want a prompt meant for me to stay on screen until I deal with it.

## 6. Functional requirements

"Action owner" = who may act on a pending notification (not the roll actor of dice-roll-log). `env` = `CommandEnv`; campaign and player come from `env.actor`.

| ID | Requirement | Notes |
|---|---|---|
| FR-NOTE-01 | Record type `notification`, scope `campaign`, fields per §8. Persisted. Ordered by row `seq` (DB insertion order; not the WS frame `seq`). | CON-20, [ADR-0022](../architecture/adr/0022-deterministic-seams.md) |
| FR-NOTE-02 | `notify(env, {kind, audience, audiencePlayerId?, text, payload, action?})` inserts the row and emits `NotificationCreated` **in the caller's transaction**. Caller rolls back → no row, event or log entry. IDs and time from `env.ctx`. Returns the ID. | ADR-0027 |
| FR-NOTE-03 | Server kind registry (`src/server/features/notifications/kinds.ts`, append-only, AGENTS §9.9): `kind` (`^[a-z][a-z0-9-]{0,31}$`), owner spec, payload zod, optional resolution zod, optional `resolutionMaxBytes` (default 256 B; `damage-card` declares 8 KB, #155, #157), `genericResolve` (default false). Unknown kind, invalid payload, payload > 1 KB or resolution over its kind's cap serialized, or invalid text → helper throws; the caller's command fails `internal` and writes nothing. | Server bug, not user input; OQ-NOTE-10 |
| FR-NOTE-04 | Audience: `dm`, `player` + `audiencePlayerId` (a player of `env.actor.campaignId`, else throw), or `all`. The DM sees every notification. Audience never changes. | |
| FR-NOTE-05 | Optional action: `label` (1–24 chars), owner `dm` or `player` + `actionPlayerId`. A player owner must be in the audience. With an action the state starts `pending`, else `info`. | |
| FR-NOTE-06 | Visibility: DM `full`. Player `full` iff `audience = all` or (`player` and `audiencePlayerId` = the viewer's player), else `hidden`. No redacted form: a kind addressing players keeps DM-only data out of `text`, `payload` **and** `resolution` (each kind's leak test). | [ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md) B |
| FR-NOTE-07 | States: `info` (final); `pending` → `resolved` \| `dismissed`; `resolved` → `pending` only via FR-NOTE-10. Each change sets `closedAt` / `closedByRole` / `closedByPlayerId` (cleared on reopen, with `resolution`) and emits its event in the same transaction. | |
| FR-NOTE-08 | `resolveNotification(env, id, resolution?)` in the kind owner's command: not in `env.actor.campaignId` → `not_found`; not `pending` → `conflict`; sender is neither the action owner nor the DM → `forbidden`; resolution fails the kind's schema → `invalid`. Any failure rolls back the **whole** command. | Exactly once; #136 |
| FR-NOTE-09 | Intent `note.resolve {id, resolution?}` (DM, player) for `genericResolve` kinds only (MVP: `test`); other kinds → `forbidden`. Player who can't see it → `not_found`. Then FR-NOTE-08 checks. Emits `NotificationResolved`. | |
| FR-NOTE-10 | `reopenNotification(env, id)`: `resolved` → `pending`, else `conflict`. Called by the kind owner's undo, **after** the owner's own event. Emits `NotificationReopened`. | #139 P4, I28 |
| FR-NOTE-11 | Intent `note.dismiss {id}` (DM only): `pending` → `dismissed`, else `conflict`. Emits `NotificationDismissed`. Players close toasts locally only. | #136 |
| FR-NOTE-12 | Snapshot per ADR-0029: `window {orderBy: seq, size: 100, pin: state = pending}`. Every pending row, plus the newest 100 non-pending rows of the campaign, cut **before** the visibility filter; then the filter runs. A player may get fewer than 100. | #137 |
| FR-NOTE-13 | Toast trigger: a notification **arrives in an `event` frame** (`cause.name = NotificationCreated`) with an ID not yet in the store and is addressed to this client: info → audience (DM: `dm` or `all`; player: visible); pending → the action owner only. Snapshots never trigger per-item toasts. | |
| FR-NOTE-14 | Info toasts hide after 6 s; the timer pauses while hovered and while the tab is hidden. Pending toasts stay until the state leaves `pending` or the user closes the toast (closing ≠ dismissing). At most 3 visible; more show "+N more", which opens `note.history`. | #139 P26 |
| FR-NOTE-15 | After the first snapshot of a page load or of a (re)connection — not on resyncs while `live` (scene switch, gap) — if ≥ 1 pending notification has this client as action owner: one toast "N pending action(s)" with "Open" (opens `note.history`). | I19 |
| FR-NOTE-16 | The action button shows while `pending`, the client is `live`, and the client is the action owner or the DM. A click calls the kind's client `onAction`; with no handler, `genericResolve` kinds send `note.resolve`; otherwise no button. | |
| FR-NOTE-17 | Window type `note.history` "Notifications", both clients, closed by default, launcher bell with unread badge *(proposed, OQ-NOTE-13)*. Body: **Pending** (DM: all; player: pending they own), then **History**, newest first. Row: kind icon, text, time, state badge ("Pending", "Resolved by ‹name›", "Dismissed"), action button. DM rows add an audience tag ("DM", "All", "‹player›") and Dismiss on pending rows. | I12 |
| FR-NOTE-18 | Unread = notifications addressed to this client (FR-NOTE-13 rule) with row `seq` > last seen *(R5: action rows only while `pending`, FR-NOTE-24)*. Last seen lives in `localStorage` `pp.note.seen.v1.<campaignId>.<dm \| playerId>`; set to the highest `seq` in the store while `note.history` is open and the tab visible. No entry → baseline = highest `seq` in the first snapshot. Storage failure → memory only. | #139 P27 |
| FR-NOTE-19 | Client view registry per client (`notification-views.ts`, append-only, AGENTS §9.9): kind → icon, optional renderer, optional `onAction`. Unregistered kind → generic row (icon + text), no handler. | OQ-NOTE-10 |
| FR-NOTE-20 | A rejected action shows a toast: `conflict` → "No longer pending", else the reject message. The row keeps the server's state. | |
| FR-NOTE-21 | `text`: plain text, trimmed, control characters removed, 1–280 chars, rendered as text (never HTML). Composed by the kind owner. | |
| FR-NOTE-22 | Test mode only ([FR-SYNC-27](live-sync.md#6-functional-requirements)): kind `test` (`genericResolve`), intent `note.testSend`, a send form in `note.history`. DM: any audience and action. Player: `{text, actionLabel?}` only (other fields → `invalid`); audience = self, owner = DM (behaves like a damage card). Absent otherwise. | |
| **Polish pass** (sprint 1, R5) | | |
| FR-NOTE-23 | **Encounter-scoped kinds** (*pending DM gate, [OQ-CBT-45](combat-tracker.md#15-open-questions)*): a kind may declare `onEncounterEnd: "dismiss"` (absent = its rows stay pending, today's rule); its payload schema must then carry `encounterId` (checked when the registry loads; a test covers every kind). Server helper `dismissForEncounter(env, encounterId) → RecordChange[]`, called by the command that ends the encounter, in its transaction, after its own event: every `pending` notification of `env.actor.campaignId` whose kind declares it and whose `payload.encounterId` = `encounterId` → `dismissed` (`closedAt` from the clock, `closedByRole` / `closedByPlayerId` from `env.actor`), one `NotificationDismissed` each, in row `seq` order. None → no change, no event. MVP user: `damage-card` ([FR-CBT-59](combat-tracker.md#6-functional-requirements)); later kinds (combat-extras) choose per kind. | R5; [proposed ADR](../architecture/adr/proposed-encounter-scoped-notifications.md) |
| FR-NOTE-24 | **Handled actions aren't unread** (amends FR-NOTE-18; agent pick, holds for every OQ-CBT-45 option): a notification with an action counts as unread only while `pending`; info rows as before. A card applied, dismissed or closed at End leaves the action owner's bell; reopened (undo) → counts again if its `seq` > last seen. | R5 |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md): shadcn Toast (shell's toast region, [FR-SHELL-01](play-shell.md#6-functional-requirements): bottom-right for players, top-centre below the top bar for the DM so toasts clear the Initiative rows, #153), Badge, Button, ScrollArea, Separator; dark only; semantic tokens.

- **Screens:** toasts; `note.history` window (default bottom-right above the toast region, 360×480, min 280×240). Pending rows on top with accent border token; closed rows muted with state badge. A toast whose notification leaves `pending` disappears.
- **States:** empty "No notifications yet"; loading = shell skeleton; disconnected = last list + banner, action and Dismiss disabled; reject → FR-NOTE-20.
- **DM view:** toasts for info aimed at DM/all and every pending action the DM owns (damage cards). Window shows everything with audience tags; action on any pending row; Dismiss.
- **Player view:** toasts for info aimed at them or all and for pending actions they own. Window shows their own and `all` notifications, incl. their damage cards' state and resolution (#138); no Dismiss.
- **Test IDs** (AGENTS §9.5): `note-toast` + `data-record-id`, `note-toast-action`, `note-toast-close`, `note-toast-more`, `note-toast-pending-summary`, `note-history`, `note-history-row` + `data-record-id` + `data-state`, `note-history-action`, `note-history-dismiss`, `note-history-empty`, `note-launcher-badge`; test mode: `note-test-text`, `note-test-audience`, `note-test-owner`, `note-test-label`, `note-test-send`.

## 8. Data model

| Entity | Field | Type | Notes |
|---|---|---|---|
| Notification | id, campaignId | ID, ID → Campaign | `env.ctx.ids`; `env.actor.campaignId` |
| | seq | int | Row insertion order (CON-20) |
| | kind | string | Registered kind (FR-NOTE-03) |
| | audience, audiencePlayerId | `dm` \| `player` \| `all`, ID → Player \| null | Immutable |
| | text | text 1–280 | FR-NOTE-21 |
| | payload | **JSON leaf** ≤ 1 KB | Per-kind zod; plain IDs, no FKs |
| | actionLabel, actionRole, actionPlayerId | text \| null, `dm` \| `player` \| null, ID \| null | Action owner; all null = info |
| | state | `info` \| `pending` \| `resolved` \| `dismissed` | FR-NOTE-07; index (campaignId, state) |
| | resolution | **JSON leaf** ≤ 256 B \| null | Per-kind zod; visible to the audience |
| | closedAt, closedByRole, closedByPlayerId | timestamp, `dm` \| `player` \| null, ID \| null | From the command's clock and `env.actor` |
| | createdAt, updatedAt | timestamp | `env.ctx.clock` |
| Kind / View *(code)* | server: kind, ownerSpec, payload, resolution?, genericResolve, *(R5)* onEncounterEnd?; client: kind, icon, render?, onAction? | — | Registries, not stored |
| Seen marker *(browser)* | lastSeenSeq | int | Per (campaign, owner); never sent |

- **Relations:** campaign 1–n notification; player 0..1 as audience or action owner. Payload IDs are checked by the kind owner when the action runs.
- **Derived:** pending for me, unread count, display order. `seq` gaps show a player that hidden notifications exist, never their content (accepted). Toasts and timers are client memory only.

## 9. API & events

**REST:** none.

| Intent | Who | Validation | Result |
|---|---|---|---|
| `note.dismiss {id}` | DM | In campaign (else `not_found`); `pending` (else `conflict`) | — |
| `note.resolve {id, resolution?}` | DM, player | FR-NOTE-09 | — |
| `note.testSend {text, audience?, audiencePlayerId?, actionLabel?, actionRole?, actionPlayerId?}` *(test mode)* | DM, player | DM: FR-NOTE-04/05. Player: FR-NOTE-22 (strict) | `{id}` |

**Server API** (in-process): `notify`, `resolveNotification`, `reopenNotification` (FR-NOTE-02/08/10); kind registry (FR-NOTE-03); *(R5, pending)* `dismissForEncounter` (FR-NOTE-23): same `NotificationDismissed` event and record visibility (FR-NOTE-06) as `note.dismiss`; no new event, field or intent.

**WS events** (generic record changes, [ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md) A)

| Domain event | Payload | Changes | Logged | Undoable | Visibility rule |
|---|---|---|---|---|---|
| `NotificationCreated` | `{notificationId, kind, audience, audiencePlayerId, hasAction}` | `notification` upsert (before null) | yes | no | Record fn (FR-NOTE-06) |
| `NotificationResolved`, `NotificationDismissed`, `NotificationReopened` | `{notificationId, kind}` | `notification` upsert | yes | no | Record fn |

- Helpers emit their own event (protocol rule I15) via `env.emit`, after the kind owner's event. Each goes out as its own `event` frame, all before the sender's `ack` ([FR-SYNC-14](live-sync.md#6-functional-requirements)). No listeners, no signals.

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Create | via feature commands | via feature commands (e.g. own attack) | Kind owner's command; no generic create intent |
| See | all | audience `all` or self | FR-NOTE-06 |
| Resolve | any pending | if action owner (never damage cards: owner `dm`) | FR-NOTE-08/09 |
| Dismiss | any pending | no (close toast locally) | FR-NOTE-11 |
| Reopen | via kind owner (undo) | no | FR-NOTE-10 |

## 11. Edge cases & failure modes

- **Action owner offline:** the notification waits, no timeout. On reconnect: summary toast, unread badge. The DM can dismiss it meanwhile.
- **Player disconnect / reconnect:** snapshot restores the list; no per-item toasts; unread from the seen marker. In-flight intents are not resent ([FR-SYNC-05](live-sync.md#6-functional-requirements)); clicking again gives `conflict` if it already committed.
- **DM disconnect / reconnect:** players unaffected; cards pile up in Pending; one summary toast on return. A reconnect within the page keeps sticky (pending) toasts; a reload shows only the summary, pending cards stay under Pending (FR-NOTE-13, #168).
- **Server crash:** a notification commits with its cause or not at all; a resolve commits with its effect or not at all. After restart: identical snapshots, pending still pending.
- **Concurrent:** two tabs or a double click → commands run one at a time; the first wins, the rest get `conflict` and roll back. Two tabs of one owner both toast; seen marker last-write-wins.
- **Target gone before apply:** the kind owner's command fails; the card stays pending; the DM dismisses it.
- **Row closes below the window floor:** delivered live; a fresh snapshot omits it (ADR-0029). **Campaign switch:** list and seen markers are per campaign.
- **Encounter end (R5):** dismissals commit with the end or not at all (crash-safe). A client offline at End sees the rows `dismissed` in its reconnect snapshot; no summary toast for them; no per-item toast either way. Two DM tabs: whatever is pending at commit is dismissed; a racing `note.dismiss` / apply on one of them gets `conflict` (FR-NOTE-20 "No longer pending"). A dismissed card is final (no reopen: undo after End is refused by combat).
- **Invalid / malicious input:** players create only via feature commands and test mode; text per FR-NOTE-21, never HTML; frames > 64 KB closed by live-sync.

## 12. Performance & bandwidth

- ~50–150 notifications per evening (one per player attack). Record ~300 B typical, ≤ ~1.9 KB max (text + 1 KB payload + 256 B resolution).
- Snapshot: pending + 100 → typical ≤ 40 KB, worst ~190 KB plus pending. Pending > 100 → server warning. Budget line for the protocol table (I17).
- One `event` frame per create, resolve, dismiss, reopen. Nothing on the token-move hot path.

## 13. Test plan

Isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)); loop per [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md); `bun test` on `:memory:`, port 0; tests named after FRs.

- **Fixture unit** `notifications-test` (setup, test mode, `fixtures/units/notifications/`; DM steps `note.testSend` / `note.resolve` / `note.dismiss`; needs `player-2`):

| Item | Audience | Action | State | Text |
|---|---|---|---|---|
| `info-all` | all | — | info | "The party reaches the gate" |
| `info-dm` | dm | — | info | "SECRET-NOTE goblins wait" |
| `info-p1` | player-1 | — | info | "You hear whispers" |
| `pending-dm` | dm | DM "Apply" | pending | "SECRET-NOTE apply 6 damage?" |
| `pending-p1` | player-1 | player-1 "Done" | pending | "Roll a CON save, DC 12" |
| `resolved-all` | all | DM "Ack" | resolved (by DM) | "Torches lit" |
| `dismissed-dm` | dm | DM "Apply" | dismissed | "SECRET-NOTE stale card" |

- **Bundle** `notifications` = `base` + `player-2` + `campaign-second` + `notifications-test`. Needs `PP_TEST_MODE=1`.

| Level | What | Fixtures |
|---|---|---|
| Unit | Visibility fn per audience × role; state machine; kind registry (unknown kind, payload > 1 KB, resolution > 256 B, bad text). Client: toast trigger (event vs snapshot, audience, owner), 6 s timer paused on hover / hidden tab, 3-toast cap, summary toast on load/reconnect only (not on resync while `live`), button rules, unread + baseline + storage failure. **Polish (R5):** `FR-NOTE-24 unread` (pending card unread → resolved / dismissed not → reopened again; info row unchanged); `FR-NOTE-23 registry` (a kind with `onEncounterEnd: "dismiss"` and no `encounterId` in its payload schema throws at load) | In-code |
| Integration | DM sees 7; `player-1` sees `info-all`, `info-p1`, `pending-p1`, `resolved-all`; `player-2` sees `info-all`, `resolved-all`; `SECRET-NOTE` never in a player frame. Test command: `notify` then throw → no row, event or log. Test command changing a probe + resolve, run twice → second `conflict`, probe changed once. `note.resolve` by player-2 on `pending-p1` → `not_found`; by player on a non-generic kind → `forbidden`; `note.dismiss` by player → `forbidden`; player `testSend` with `audience` → `invalid`. Reopen after owner event (order). Window: 105 closed + 3 pending → DM 103; floor identical for all viewers; players get the visible subset. Convergence per ADR-0029 helper. Restart on same DB → identical snapshots; resolve after restart works | `notifications` |
| Integration (polish) | `FR-NOTE-23 dismissForEncounter`, test-registered kinds `t-enc` (`onEncounterEnd: "dismiss"`, payload `{encounterId}`) and `t-keep`: pending `t-enc` for E1 (×2) and E2, resolved `t-enc` for E1, pending `t-keep` for E1 → helper(E1) dismisses the two pending E1 rows only, `NotificationDismissed` × 2 in `seq` order after the caller's event; caller throws → nothing; `player-1` audience row upsert reaches `player-1` only. The real end-to-end is combat's `FR-CBT-59` test | `notifications` |
| E2E (thin) | DM `note.testSend` pending to player-1 → player toast → Done → DM row "Resolved by Player 1" | `notifications` |

**Browser walkthrough** — `PP_TEST_MODE=1`; `bun run build`; `fixtures:reset-load notifications --profile verify`; `start --profile verify` in the test agent's pane; evidence per [AGENTS §9.6](../../AGENTS.md#96-browser-verification-test-agents). Contexts **A** DM, **B** `player-1`, **C** `player-2`, **D** DM second tab. Changes show ≤ 1 s.

| # | DM | Players | Expected |
|---|---|---|---|
| 1 | A logs in, opens Notifications | — | Summary toast "1 pending action". Pending: `pending-dm`, `pending-p1`; History: 5 rows with audience tags. No per-item toasts |
| 2 | — | B, C open links, open Notifications | B: summary "1 pending action"; 4 rows, `pending-p1` with Done. C: no summary; 2 rows. No `SECRET-NOTE` in B or C |
| 3 | A sends info to All "Torches gutter" | — | Toast in A, B, C; hides after ~6 s; History row in all three |
| 4 | A sends pending to Player 1, owner Player 1, "Done", "Roll DEX save" | — | B: sticky toast with Done. C: nothing. A: no toast; row Pending "Player 1" |
| 5 | — | B clicks Done on the toast | B toast gone; "Resolved by Player 1" in A and B |
| 6 | — | B sends test "Apply 4 damage?" | A and D: sticky toast with Resolve. B: row Pending, no button, no toast |
| 7 | A and D click Resolve at once | — | One succeeds; the other "No longer pending". One "Resolved by DM" row everywhere |
| 8 | A dismisses `pending-dm`, reloads | — | Row "Dismissed"; after reload no summary toast |
| 9 | A sends info to All and pending to Player 1 while B is dropped | B closes Notifications, then "drop connection" (Probes window) | B reconnects: no per-item toasts; summary "2 pending actions" (new one + `pending-p1`); badge 2 |
| 10 | Hard-kill + restart server | — | All reconnect; lists identical; B resolves the pending one |
| 11 | A switches to Second Campaign, then back | — | "No notifications yet", then the full list again |

| 12 | *(R5)* A opens Notifications (marks seen), closes it; B sends test "Apply 2 damage?"; A resolves it from the toast | — | A's bell shows 1 while pending, then none after Resolve (FR-NOTE-24); the row stays in History "Resolved by DM". End-of-encounter dismissal is walked in [combat-tracker §13](combat-tracker.md#13-test-plan) step 14 |

Teardown: stop the server, `fixtures:reset --profile verify`.

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md), [ADR-0027](../architecture/adr/0027-notification-creation.md), [ADR-0029](../architecture/adr/0029-windowed-record-types.md) | Concept, event log; in-transaction creation; windowed snapshot with `pin` | accepted |
| [live-sync](live-sync.md) | Record-type registry + `window`, visibility fn, test-mode signal, "drop connection" | complete; `window` is a shared change |
| [play-shell](play-shell.md) | Toast region, window registry; `badge?(store)` on window types | complete; badge is a shared change (OQ-NOTE-13) |
| [campaign-management](campaign-management.md) | Player names for "Resolved by ‹name›", campaign scope | complete |
| [combat-tracker](combat-tracker.md) | Kind `damage-card` (audience = rolling player, owner `dm`; resolution incl. damage applied, #138), DM `onAction`, `cbt.applyCard` → `resolveNotification`, undo → `reopenNotification` | in-review |
| [dice-roll-log](dice-roll-log.md) | None: game log and notifications stay separate (I6) | in-review |

**Shared changes needed** (AGENTS §9.9; gate §4):
- `src/server/db/` — `notification` table, indexes (campaignId, seq), (campaignId, state). `src/shared/events/` — the four `Notification*` events.
- Record-type registry line `notification` with `window {orderBy: seq, size: 100, pin}` — needs ADR-0029 support in `src/server/ws/` + `src/shared/protocol/` (gate §4 item 4).
- New append-only registries (created empty by this build; on the AGENTS §9.9 list): `src/server/features/notifications/kinds.ts`, `src/client/dm/notification-views.ts`, `src/client/player/notification-views.ts`.
- Existing registries: `notifications` in `src/server/features/index.ts`; `note.history` in `src/client/{dm,player}/windows.ts`; `notifications` in `fixtures/bundles/index.ts`. `src/client/common/` shell: `badge?(store)` on window types (FR-SHELL-07).
- Docs (integrator): protocol rows, data-model row, ADR-0016 "MVP use" line (I30).

**Shared changes — polish pass** (sprint 1, R5; after the DM gate):
- Notifications-owned server files: kind-registry type gains optional `onEncounterEnd` + the load check; new helper `dismissForEncounter` beside `notify` / `resolveNotification`. Combat adds `onEncounterEnd: "dismiss"` to its own `damage-card` line in the append-only `kinds.ts` and calls the helper from `cbt.end` (same `fix/*` or right after; must merge **before the combat-extras build**).
- Client (own files): `logic.ts` `unreadCount` / `addressedForUnread` (FR-NOTE-24).
- **None:** DB columns, events, record types, visibility, intents. Docs at consolidation: protocol §23 (kind table: `onEncounterEnd` column), notifications row in §26 if needed. ADR: [proposed-encounter-scoped-notifications](../architecture/adr/proposed-encounter-scoped-notifications.md) (amends ADR-0016 / ADR-0027 consequences; number at merge).

## 15. Open questions

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| ~~OQ-NOTE-01~~ | ~~Who may resolve an action?~~ | Decided (#136): only the DM applies or dismisses damage cards (owner `dm`). Mechanism: action owner + DM (ADR-0016 "named actor" row; MVP's only player-owned kind is `test`) | — | combat-tracker, ADR-0016 |
| ~~OQ-NOTE-02, 04, 06, 08, 09~~ | ~~Game log as feed; toast timing; damage-card owner; `loot-received`; where "seen" lives~~ | Decided: 02 separate windows (I6); 04 info 6 s, paused on hover / hidden tab, pending stays (#139 P26); 06 combat-tracker owns `damage-card` (I7); 08 `loot-received` owned by party-loot, info to everyone (#146); 09 browser `localStorage` per (campaign, owner) (#139 P27) | — | dice-roll-log, combat-tracker, party-loot |
| ~~OQ-NOTE-03, 05, 07~~ | ~~History retention; creation; undo of applied damage~~ | Decided: 03 keep all in DB, snapshot = pending (pinned) + newest 100 closed, no load-older (#137, ADR-0029); 05 `notify` inside the causing command's transaction (#135, ADR-0027); 07 undo reopens the card, no Redo, owner event first (#139 P4, I28) | — | live-sync, combat-tracker |
| ~~OQ-NOTE-10, 12~~ | ~~Kind + view registries append-only; glossary "Action owner"~~ | Decided (integrator): both registries on the AGENTS §9.9 list (paths §14); glossary adds **Action owner** | — | AGENTS.md, glossary |
| ~~OQ-NOTE-11~~ | ~~Damage card audience~~ | Decided (#138): rolling player sees the card and its resolution incl. damage applied; DM attacks: `dm` | — | combat-tracker |
| ~~OQ-NOTE-13~~ | ~~Launcher unread badge: play-shell window types gain `badge?(store) → number` ~~ Decided (#142): add `badge?(store)`; shared change by build/notifications | **Add** (shared change, gate §4 item 11) / unread count in the window title only | no · owner: orchestrator | play-shell |
| OQ-NOTE-15 | **R5:** what happens to pending notifications when their encounter ends? | Asked once, as [OQ-CBT-45](combat-tracker.md#15-open-questions) (**A: kinds opt in to dismissal on End**, FR-NOTE-23). FR-NOTE-24 (handled actions leave the bell) is an agent pick for every option | **yes** (with OQ-CBT-45) · owner: DM | combat-tracker, combat-extras |
| ~~OQ-NOTE-14~~ | ~~Toast to the rolling player when the DM resolves their card?~~ | Decided (#141): **no**; the card's resolution in `note.history` shows it (FR-NOTE-13, -18 unchanged) | — | combat-tracker |

## 16. Out of scope

- Concentration, duration and turn reminders; rule listeners → [combat-extras](post-mvp/combat-extras.md), ADR-0027 C.
- Roll requests → [dice-extras](post-mvp/dice-extras.md) (future kind, player owner). Kill-feed toasts → [stats](post-mvp/stats.md). `loot-received` → [party-loot](party-loot.md) (#146).
- [Gems](post-mvp/gems.md) (#140): modifying a pending damage card's dice is combat-tracker's command; if card text must change then, a post-MVP `updateNotification` helper (pending only). No MVP change.
- Load older history, server read state, cross-browser seen marker.
