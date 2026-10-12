---
title: Notifications
prefix: NOTE
status: in-review
owner: spec-notifications
wave: 2
---

# Notifications

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md).

## 1. Summary

- **Notification**: a persisted, toast-like message with a history feed. It has a kind, an audience and optionally an action ([ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md), [decisions #47](../decisions-log.md)).
- With an action, it is a **pending action** until resolved or dismissed (e.g. a damage card's "Apply"). Without one, it is info (e.g. "Party received 50 gp").
- This spec owns the mechanism: the record type, its states, the server helpers, toasts and the history window. Kinds and their payloads belong to the features that create them ([combat-tracker](combat-tracker.md): damage card).

## 2. Scope

- `notification` record type: kind, audience, text, payload, optional action, state, timestamps. Persisted, campaign-scoped, in the snapshot.
- Server helpers that kind owners call **inside their own command's transaction**: `notify`, `resolveNotification`, `reopenNotification` ([OQ-NOTE-05](#15-open-questions), [proposed ADR](../architecture/adr/0027-notification-creation.md)).
- Intents: `note.dismiss` (DM), `note.resolve` (only for kinds that opt in).
- Kind registries: server (payload schema) and per-client views (icon, renderer, action handler).
- Toasts on arrival; history window `note.history` in the [play shell](play-shell.md); per-browser unread badge.
- Test mode only: kind `test` and intent `note.testSend`, so the whole loop can be built and walked through before combat-tracker exists.
- MVP kinds: `damage-card` (combat-tracker), `loot-received` *(proposed, [OQ-NOTE-08](#15-open-questions))*, `test` (test mode).

## 3. Goals

- The DM never misses a pending damage card: it survives disconnect, reload and a server crash, and stays visible until handled.
- An action takes effect **exactly once**, even with double clicks, two tabs or the DM and a player clicking at the same time.
- A player who was tabbed out or offline can catch up in one window.
- A feature adds a kind without changing notification, hub or client sync code.

## 4. Non-goals

- Wall-clock timers or scheduling ([ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)). No expiry.
- Chat (only ever inside the game log, [feature tiers](../feature-tiers.md#4-notes-handouts-world-and-party)). Browser or OS push notifications. Sounds.
- Rule-driven notifications from post-commit listeners (concentration, durations: [combat-extras](post-mvp/combat-extras.md)); see the proposed ADR.
- Read state synced across browsers. Loading history older than the snapshot window. Editing or deleting notifications.
- Pushing windows open on other clients ([OQ-SHELL-02](play-shell.md#15-open-questions)).

## 5. User stories

**DM**
- As the DM, I want each player attack to appear as a pending damage card I can apply in one click, so that nobody reads damage out loud.
- As the DM, I want pending cards to still be there after a crash or reload, so that I don't lose a hit.
- As the DM, I want to dismiss a card that no longer applies, so that the pending list stays honest.

**Player**
- As a player, I want to see what happened while I was tabbed out or offline, so that I can catch up without asking.
- As a player, I want a prompt meant for me to stay on screen until I deal with it.

## 6. Functional requirements

| ID | Requirement | Notes |
|---|---|---|
| FR-NOTE-01 | Record type `notification`, scope `campaign`, fields per §8. Persisted. Ordered by `createdAt`, then `seq`. | [ADR-0022](../architecture/adr/0022-deterministic-seams.md) |
| FR-NOTE-02 | `notify(env, {kind, audience, text, payload, action?})` inserts the row and emits `NotificationCreated` **in the caller's transaction**. Caller rolls back → no row, no event, no log entry. IDs and time from `ctx`. Returns the ID. | OQ-NOTE-05 |
| FR-NOTE-03 | Server kind registry: `kind` (`^[a-z][a-z0-9-]{0,31}$`), owner spec, payload zod, optional resolution zod, `genericResolve` (default false). Unknown kind, invalid payload (> 2 KB serialized counts as invalid) or invalid text → `notify` throws, so the caller's command fails `internal` and writes nothing. | Server bug, not user input |
| FR-NOTE-04 | Audience is `dm`, `player` + `audiencePlayerId` (a player of `ctx.campaignId`, else throw), or `all`. The DM sees every notification. Audience never changes. | |
| FR-NOTE-05 | Optional action: `label` (1–24 chars), actor `dm` or `player` + `actionPlayerId`. A player actor must be in the audience (`all`, or `player` with the same ID). With an action the state starts `pending`, without one it is `info`. | |
| FR-NOTE-06 | Visibility: DM `full`. Player `full` iff `audience = all` or (`audience = player` and `audiencePlayerId = ctx.playerId`), else `hidden`. No redacted form: a kind addressing players must keep DM-only data out of `text` and `payload` (each kind's leak test). | [ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md) B |
| FR-NOTE-07 | States: `info` (final); `pending` → `resolved` \| `dismissed`; `resolved` → `pending` only via FR-NOTE-10. Every change sets `closedAt` / `closedByRole` / `closedByPlayerId` (or clears them on reopen) and emits its event in the same transaction. | |
| FR-NOTE-08 | `resolveNotification(env, id, resolution?)`, called in the kind owner's command: not in `ctx.campaignId` → `not_found`; not `pending` → `conflict`; `env.actor` is neither the action's actor nor the DM → `forbidden`; resolution fails the kind's schema → `invalid`. Any failure rolls back the **whole** caller command (no effect without the resolve). | Exactly once |
| FR-NOTE-09 | Intent `note.resolve {id, resolution?}` (DM, player) for `genericResolve` kinds only (MVP: `test`); other kinds → `forbidden`. Same checks as FR-NOTE-08. A player who can't see the record → `not_found`. Emits `NotificationResolved`. | |
| FR-NOTE-10 | `reopenNotification(env, id)`: `resolved` → `pending`, for the kind owner's compensating command (combat undo, OQ-NOTE-07). Else `conflict`. Emits `NotificationReopened`. | *(proposed)* |
| FR-NOTE-11 | Intent `note.dismiss {id}` (DM only): `pending` → `dismissed`, else `conflict`. Emits `NotificationDismissed`. Players close toasts locally only. | OQ-NOTE-01 |
| FR-NOTE-12 | Snapshot provider (per viewer): every `pending` notification the viewer can see, plus the 100 most recent other ones it can see, in `seq` order. | OQ-NOTE-03 |
| FR-NOTE-13 | Toast trigger: a notification **arrives in an `event` frame** with an ID not yet in the store, and is addressed to this client: info → audience (DM: audience `dm` or `all`; player: visible); pending → the action's actor only. Snapshots never trigger per-item toasts. | |
| FR-NOTE-14 | Info toasts hide after 6 s; the timer pauses while hovered and while the tab is hidden. Pending toasts for this client stay until the state leaves `pending`, or the user closes the toast (closing ≠ dismissing). At most 3 toasts visible; more show "+N more", which opens `note.history`. | OQ-NOTE-04 |
| FR-NOTE-15 | After every snapshot (load, reconnect, resync), if ≥ 1 pending notification has this client as actor: one toast "N pending action(s)" with "Open" (opens `note.history`). | No toast flood |
| FR-NOTE-16 | The action button shows while the state is `pending`, the client is `live`, and the client is the actor or the DM. A click calls the kind's client `onAction`; with no handler, `genericResolve` kinds send `note.resolve`; otherwise no button. | DM can always act |
| FR-NOTE-17 | Window type `note.history` "Notifications", both clients, not open by default, launcher bell with an unread badge. Body: **Pending** (DM: all pending; player: pending where they are the actor), then **History**, newest first. Row: kind icon, text, time, state badge ("Pending", "Resolved by ‹name›", "Dismissed"), action button (FR-NOTE-16). DM rows also show an audience tag ("DM", "All", "‹player›") and Dismiss on pending rows. | [OQ-SHELL-06](play-shell.md#15-open-questions) |
| FR-NOTE-18 | Unread = notifications addressed to this client (FR-NOTE-13 rule) with `seq` > last seen. Last seen lives in `localStorage` `pp.note.seen.v1.<campaignId>.<dm \| playerId>`; it is set to the highest `seq` in the store while `note.history` is open and the tab visible. No entry → baseline = highest `seq` in the first snapshot. Storage failure → memory only. | OQ-NOTE-09 |
| FR-NOTE-19 | Client view registry per client: kind → icon, optional renderer, optional `onAction`. Kind not registered on this client → generic row (icon + text), no handler. | OQ-NOTE-10 |
| FR-NOTE-20 | A rejected action shows a toast: `conflict` → "No longer pending", otherwise the reject message. The row keeps the server's state. | |
| FR-NOTE-21 | `text`: plain text, trimmed, control characters removed, 1–280 chars, always rendered as text (never HTML). Composed by the kind owner. | |
| FR-NOTE-22 | Test mode only ([FR-SYNC-27](live-sync.md#6-functional-requirements) signal): kind `test` (`genericResolve`), intent `note.testSend`, and a send form in `note.history`. DM: any audience and action. Player: audience = self, actor = DM (behaves like a damage card). Absent otherwise. | |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md): shadcn Toast (shell's bottom-right region, [FR-SHELL-01](play-shell.md#6-functional-requirements)), Badge, Button, ScrollArea, Separator; dark only; semantic tokens.

- **Screens:** toasts; `note.history` window (default geometry: bottom-right above the toast region, 360×480, min 280×240 *(proposed)*). No page of its own.
- **States:** empty "No notifications yet"; loading = shell skeleton; disconnected = last list + banner, action and Dismiss buttons disabled; reject → FR-NOTE-20 toast.
- **Pending vs closed:** pending rows on top, accent border token; resolved/dismissed rows muted, with state badge. A toast whose notification leaves `pending` disappears.
- **DM view:** toasts for info aimed at DM/all and every DM-actor pending action (damage cards). Window shows everything with audience tags; action on any pending row; Dismiss.
- **Player view:** toasts for info aimed at them or all and for pending actions where they are the actor. Window shows their own and `all` notifications; no Dismiss.
- **Test IDs** (AGENTS §9.5): `note-toast` + `data-record-id`, `note-toast-action`, `note-toast-close`, `note-toast-more`, `note-toast-pending-summary`, `note-history`, `note-history-row` + `data-record-id` + `data-state`, `note-history-action`, `note-history-dismiss`, `note-history-empty`, `note-launcher-badge`; test mode: `note-test-text`, `note-test-audience`, `note-test-actor`, `note-test-label`, `note-test-send`.

## 8. Data model

| Entity | Field | Type | Notes |
|---|---|---|---|
| Notification | id, campaignId | ID, ID → Campaign | `ctx.ids`; `ctx.campaignId` |
| | seq | int | DB insertion order ([CON-20](../data-model/README.md#8-conflicts-log)) |
| | kind | string | Registered kind (FR-NOTE-03) |
| | audience, audiencePlayerId | `dm` \| `player` \| `all`, ID → Player \| null | Immutable |
| | text | text 1–280 | FR-NOTE-21 |
| | payload | **JSON leaf** | Per-kind zod, ≤ 2 KB; plain IDs, no FKs |
| | actionLabel, actionRole, actionPlayerId | text \| null, `dm` \| `player` \| null, ID \| null | All null = info |
| | state | `info` \| `pending` \| `resolved` \| `dismissed` | FR-NOTE-07 |
| | resolution | **JSON leaf** \| null | Per-kind zod (e.g. applied amount) |
| | closedAt, closedByRole, closedByPlayerId | timestamp, `dm` \| `player` \| null, ID \| null | Resolve / dismiss; `ctx.clock`, actor from the command |
| | createdAt, updatedAt | timestamp | `ctx.clock` |
| Kind *(server code)* | kind, ownerSpec, payload, resolution?, genericResolve | — | Registry, not stored |
| View *(client code)* | kind, icon, render?, onAction? | — | Per client |
| Seen marker *(browser `localStorage`)* | lastSeenSeq | int | Per (campaign, owner); never sent |

- **Relations:** campaign 1–n notification; player 0..1 as audience or actor. Payload IDs (token, combatant…) are checked by the kind owner when the action runs.
- **Derived:** pending for me, unread count, display order. `seq` gaps can show a player that hidden notifications exist, never their content (accepted).
- **Persisted runtime state:** every notification and its state. Toasts and timers are client memory only.

## 9. API & events

**REST:** none.

**WS intents** (default DM only)

| Intent | Who | Validation / ownership | Result |
|---|---|---|---|
| `note.dismiss {id}` | DM | In `ctx.campaignId` (else `not_found`); `pending` (else `conflict`) | — |
| `note.resolve {id, resolution?}` | DM, player | FR-NOTE-09: visible (else `not_found`); `genericResolve` kind (else `forbidden`); actor or DM (else `forbidden`); `pending` (else `conflict`) | — |
| `note.testSend {text, audience, audiencePlayerId?, actionLabel?, actionRole?, actionPlayerId?}` *(test mode)* | DM, player | DM: FR-NOTE-04/05 rules. Player: fields other than `text` and `actionLabel` ignored; audience = self, actor = DM | `{id}` |

**Server API** (in-process, for kind owners): `notify`, `resolveNotification`, `reopenNotification` (FR-NOTE-02/08/10); `registerNotificationKind` (FR-NOTE-03).

**WS events** (generic record changes, [ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md) A)

| Domain event | Payload | Changes | Logged | Undoable | Visibility rule |
|---|---|---|---|---|---|
| `NotificationCreated` | `{notificationId, kind, audience, audiencePlayerId, hasAction}` | `notification` upsert (before null) | yes | no | Record fn (FR-NOTE-06) |
| `NotificationResolved` | `{notificationId, kind}` | `notification` upsert | yes | no | Record fn |
| `NotificationDismissed` | `{notificationId, kind}` | `notification` upsert | yes | no | Record fn |
| `NotificationReopened` | `{notificationId, kind}` | `notification` upsert | yes | no | Record fn |

- Helpers call `env.emit` in the caller's transaction, in call order (kind owners emit their own event first, then call the helper). Each domain event goes out as its own `event` frame, all before the sender's `ack` ([FR-SYNC-14](live-sync.md#6-functional-requirements)); the client toasts on `cause.name = NotificationCreated` (FR-NOTE-13).
- No listeners added. No signals.

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Create | via feature commands | via feature commands (e.g. own attack) | Kind owner's command; no generic create intent |
| See | all | audience `all` or self | FR-NOTE-06 |
| Resolve | any pending | if they are the action's actor | FR-NOTE-08/09 |
| Dismiss | any pending | no (close toast locally) | FR-NOTE-11, roles |
| Reopen | via kind owner (undo) | no | FR-NOTE-10 |

## 11. Edge cases & failure modes

- **Actor offline:** the notification waits, no timeout. On reconnect: summary toast (FR-NOTE-15), unread badge. DM can dismiss it meanwhile.
- **Player disconnect / reconnect:** snapshot restores the list; no per-item toasts; unread count from the seen marker. Intents in flight at the drop are not resent ([FR-SYNC-05](live-sync.md#6-functional-requirements)); the player clicks again and gets `conflict` if it already committed.
- **DM disconnect / reconnect:** players unaffected; pending cards pile up and appear in the Pending section with one summary toast.
- **Server crash:** a notification commits with its cause or not at all; a resolve commits with its effect or not at all, so "resolved but not applied" can't happen. After restart: snapshot identical, pending still pending.
- **Concurrent:** two tabs, double click, or DM + actor at once → commands run one at a time; the first wins, the rest get `conflict` and roll back their whole command.
- **Target gone before resolve** (e.g. token deleted): the kind owner's command fails (`not_found`), the notification stays pending, the DM dismisses it.
- **Campaign switch:** campaign-scoped; the DM sees the new campaign's list; seen markers are per campaign.
- **Invalid / malicious input:** players can create only through feature commands and test mode; `note.testSend` text checked as FR-NOTE-21; text never rendered as HTML; frames > 64 KB closed by live-sync.
- **Two tabs, same owner:** both toast; seen marker last-write-wins.

## 12. Performance & bandwidth

- Expected: ~50–150 notifications per evening (one per player attack, plus loot). Record ~300 B typical, ≤ 3 KB max.
- Snapshot: pending + 100 → typical ≤ 40 KB, worst ~300 KB; inside live-sync's 512 KB budget only if other types stay small. If pending exceeds 100, the server logs a warning.
- One extra `event` frame per create or resolve. Nothing to do on the hot path (token moves).
- A live store can hold more than 100 closed ones after a long session; a fresh snapshot holds 100. Convergence tests ([FR-SYNC-20](live-sync.md#6-functional-requirements)) stay under 100 (accepted).

## 13. Test plan

Isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)); build loop per [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md); `bun test` on `:memory:`, port 0. Tests named after FRs.

- **Fixture unit** `notifications-test` (setup, test mode only, `fixtures/units/notifications/`; DM authority via `note.testSend` / `note.resolve` / `note.dismiss`; requires `player-2`):

| Key | Audience | Action | State | Text |
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
| Unit | Visibility fn per audience × role; state machine; kind registry (unknown kind, bad payload, > 2 KB, bad text). Client: toast trigger (event vs snapshot, audience, actor), 6 s timer paused on hover / hidden tab, 3-toast cap, summary toast, button rules, unread + baseline + storage failure | In-code |
| Integration | DM sees 7; `player-1` sees `info-all`, `info-p1`, `pending-p1`, `resolved-all`; `player-2` sees `info-all`, `resolved-all`; leak scan: `SECRET-NOTE` never in a player frame. A test command calling `notify` then throwing → no row, event or log. A test command that changes a probe and resolves: run twice → second `conflict`, probe changed once. `note.resolve` by player-2 on `pending-p1` → `not_found`; by player on non-generic kind → `forbidden`; `note.dismiss` by player → `forbidden`. Reopen. Window: 105 closed + 3 pending → snapshot 103. Restart on same DB → identical snapshots; resolve after restart works. Convergence per player | `notifications` |
| E2E (thin) | DM `note.testSend` pending to player-1 → player toast → Done → DM row "Resolved by Player 1" | `notifications` |

**Browser walkthrough** — `PP_TEST_MODE=1`; `bun run build`; `fixtures:reset-load notifications --profile verify`; `start --profile verify` in the test agent's pane; evidence per [AGENTS §9.6](../../AGENTS.md#96-browser-verification-test-agents). Contexts **A** DM, **B** `player-1`, **C** `player-2`, **D** DM second tab. Changes must show ≤ 1 s.

| # | DM | Players | Expected |
|---|---|---|---|
| 1 | A logs in, opens Notifications | — | Summary toast "1 pending action". Pending: `pending-dm`, `pending-p1`; History: 5 rows with audience tags. No per-item toasts |
| 2 | — | B, C open links, open Notifications | B: summary "1 pending action"; sees 4 rows, `pending-p1` with Done. C: no summary; 2 rows. No `SECRET-NOTE` in B or C |
| 3 | A sends info to All "Torches gutter" | — | Toast in A, B, C; hides after ~6 s; History row in all three |
| 4 | A sends pending to Player 1, actor Player 1, label "Done", "Roll DEX save" | — | B: sticky toast with Done. C: nothing. A: no toast; row Pending "Player 1" |
| 5 | — | B clicks Done on the toast | B toast gone; row "Resolved by Player 1" in A and B |
| 6 | — | B sends test "Apply 4 damage?" | A and D: sticky toast with Resolve. B: row Pending, no button, no toast |
| 7 | A and D click Resolve at once | — | One succeeds; the other shows "No longer pending". One "Resolved by DM" row everywhere |
| 8 | A dismisses `pending-dm`, reloads | — | Row "Dismissed"; after reload no summary toast (nothing pending for the DM) |
| 9 | A sends info to All and pending to Player 1 while B is dropped | B closes Notifications, then "drop connection" (Probes window) | B reconnects: no per-item toasts; summary "1 pending action"; badge shows 2 |
| 10 | Hard-kill + restart server | — | All reconnect; lists identical; B resolves the pending one |
| 11 | A switches to Second Campaign, then back | — | Empty "No notifications yet", then the full list again |

Teardown: stop the server, `fixtures:reset --profile verify`.

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md) | Concept, event log | accepted (core) |
| [live-sync](live-sync.md) | Record-type registry, visibility fn, per-viewer snapshot provider, test-mode signal, "drop connection" | complete |
| [play-shell](play-shell.md) | Toast region, window registry, launcher badge | complete |
| [campaign-management](campaign-management.md) | Player names for "Resolved by ‹name›", campaign scope | complete |
| [combat-tracker](combat-tracker.md) | `damage-card` kind: payload, client `onAction` (attack popup), apply command calling `resolveNotification`; undo calling `reopenNotification` | open (OQ-NOTE-06/07/11) |
| [party-loot](party-loot.md) | `loot-received` kind *(proposed)* | open (OQ-NOTE-08) |
| [dice-roll-log](dice-roll-log.md) | Nothing in MVP; rolls only create notifications through a kind owner | open (OQ-NOTE-02) |

## 15. Open questions

**Bold** option = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-NOTE-01 | Who may resolve an action? | **The action's actor, and the DM always** (matches ADR-0016's open row) / anyone in the audience (one player could resolve another's prompt) | yes | combat-tracker, ADR-0016 |
| OQ-NOTE-02 | Is the game log a notification feed? | **Separate windows; a roll creates a notification only through a kind owner** (log stays the record of rolls) / merged feed (one window, but mixes facts with to-dos) | no · owner: dice-roll-log | dice-roll-log |
| OQ-NOTE-03 | History retention and reach | **Keep all in the DB; snapshot = all pending + last 100; "load older" later (tier B)** (bounded snapshot, nothing lost) / snapshot everything (simple, unbounded) | no · owner: DM | live-sync |
| OQ-NOTE-04 | Toast timing | **Info hides after 6 s (paused on hover / hidden tab); pending stays** / all sticky (noisy) | no · owner: DM | — |
| OQ-NOTE-05 | How are notifications created? | **Inside the causing command's transaction via `notify` (atomic, crash-safe, no core change)** / post-commit listener (ADR-0016 wording; lost if the server dies between commit and listener, needs listener-issued commands). [Proposed ADR](../architecture/adr/0027-notification-creation.md) | yes | combat-tracker, party-loot, ADR-0016 |
| OQ-NOTE-06 | Damage-card contract (combat-tracker) | **Combat-tracker owns kind `damage-card`: payload schema, DM `onAction` opening the attack popup, and the apply command calling `resolveNotification`** / notifications models damage fields itself (couples us to combat) | no · owner: combat-tracker | combat-tracker |
| OQ-NOTE-07 | Undoing applied damage: what happens to its card? | **Undo calls `reopenNotification`; the card is pending again for a corrected apply** / card stays resolved (DM recreates it) | no · owner: combat-tracker | combat-tracker |
| OQ-NOTE-08 | `loot-received` kind | **Yes: party-loot calls `notify` (info, audience `all`) when the DM adds loot** (toast to everyone) / no (loot log window only) | no · owner: party-loot | party-loot |
| OQ-NOTE-09 | Where does "seen" live? | **Browser `localStorage` per (campaign, owner), like layout (#121)** (no server state; resets on a new browser) / server read-state per player (works across browsers; new table + intent) | no · owner: DM | — |
| OQ-NOTE-10 | AGENTS §9.9: add `src/client/dm/notification-views.ts`, `src/client/player/notification-views.ts` (created empty by the notifications build) to the append-only registries; server kinds register from each feature's own module | **Yes** (like window registries, OQ-SHELL-07) / shared file via orchestrator (serialises Combat builds) | no · owner: orchestrator | AGENTS.md, combat-tracker, party-loot |
| OQ-NOTE-11 | Damage card audience | **The rolling player (sees Pending → Resolved in their history; no toast, as only the actor gets toasts)** / DM only (player relies on the game log) | no · owner: combat-tracker | combat-tracker |

## 16. Out of scope

- Concentration, duration and turn reminders; rule listeners → [combat-extras](post-mvp/combat-extras.md) and the proposed ADR.
- Roll requests ("DM asks for a save") → [dice-extras](post-mvp/dice-extras.md) (a future kind with a player actor).
- Kill-feed toasts → [stats](post-mvp/stats.md) (a future info kind).
- Load older history, server read state, cross-browser seen marker (OQ-NOTE-03, OQ-NOTE-09).
