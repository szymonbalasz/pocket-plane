---
title: Notifications
prefix: NOTE
status: complete
owner: spec-notifications
wave: 2
---

# Notifications

## 1. Summary

- **Notification**: a persisted, toast-like message with a history feed. It has a kind, an audience and optionally an action ([ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md), [decisions #47](../decisions-log.md)). With an action it is a **pending action** until resolved or dismissed (e.g. a damage card's "Apply"). Without one it is info.
- This spec owns the mechanism: record type, states, server helpers, toasts, history window. Kinds and payloads belong to the features that create them ([combat-tracker](combat-tracker.md): damage card).
- Created and resolved **inside the causing command's transaction** ([ADR-0027](../architecture/adr/0027-notification-creation.md), #135).
- **Polish pass** (sprint 1, R5; FR-NOTE-23, 24): a kind may declare that its pending rows are **dismissed when their encounter ends** (damage cards do; decided #178, [OQ-CBT-45](combat-tracker.md#15-open-questions)); handled action rows no longer count as unread.
- **Sprint 2** (track P2a; FR-NOTE-25–32; 31/32 are sprint-1 leftovers: history window size, toasts clear of Initiative): a kind owner may **update** a pending row (combat's split Attack / Damage card, N7); a view's action learns **where it was clicked** and can close its toast (N8); the DM's bell counts pending actions owned by players and rule closures read "Closed" (G9); the DM sees a few-second **action cue** on a player's token when that player gets an action (N11).

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
- Notifications from post-commit rule listeners (concentration, durations: [combat-extras](combat-extras.md); ADR-0027 C).
- Read state synced across browsers. Loading history older than the snapshot window. ~~Editing~~ or deleting notifications (*sprint 2:* the kind owner may update a **pending** row's text and payload, FR-NOTE-25; users still can't edit). Pushing windows open on other clients ([OQ-SHELL-02](play-shell.md#15-open-questions)).

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
| FR-NOTE-18 | Unread = notifications addressed to this client (FR-NOTE-13 rule) with row `seq` > last seen (action rows only while `pending`, FR-NOTE-24; amended #178). Last seen lives in `localStorage` `pp.note.seen.v1.<campaignId>.<dm \| playerId>`; set to the highest `seq` in the store while `note.history` is open and the tab visible. No entry → baseline = highest `seq` in the first snapshot. Storage failure → memory only. | #139 P27 |
| FR-NOTE-19 | Client view registry per client (`notification-views.ts`, append-only, AGENTS §9.9): kind → icon, optional renderer, optional `onAction`. Unregistered kind → generic row (icon + text), no handler. | OQ-NOTE-10 |
| FR-NOTE-20 | A rejected action shows a toast: `conflict` → "No longer pending", else the reject message. The row keeps the server's state. | |
| FR-NOTE-21 | `text`: plain text, trimmed, control characters removed, 1–280 chars, rendered as text (never HTML). Composed by the kind owner. | |
| FR-NOTE-22 | Test mode only ([FR-SYNC-27](live-sync.md#6-functional-requirements)): kind `test` (`genericResolve`), intent `note.testSend`, a send form in `note.history`. DM: any audience and action. Player: `{text, actionLabel?}` only (other fields → `invalid`); audience = self, owner = DM (behaves like a damage card). Absent otherwise. | |
| **Polish pass** (sprint 1, R5) | | |
| FR-NOTE-23 | **Encounter-scoped kinds** (decided #178, [OQ-CBT-45](combat-tracker.md#15-open-questions)): a kind may declare an **end rule** `EncounterEndRule = {onEncounterEnd: "dismiss", encounterIdOf(payload) → string}` (type in `@shared/notifications`; absent = its rows stay pending, today's rule). The rule is a **shared constant** exported by the kind owner from `@shared/<feature>` and referenced by both the server kind definition (FR-NOTE-03) and the kind's client view entries (FR-NOTE-19), so clients can tell which pending rows End will close (combat's confirm count, FR-CBT-59). Load check + test: every kind with `onEncounterEnd` has `encounterIdOf`, and its server definition and client views reference the same rule. Server helper `dismissForEncounter(env, encounterId) → RecordChange[]`, called by the command that ends the encounter, in its transaction, after its own event: every `pending` notification of `env.actor.campaignId` whose kind has the rule and whose `encounterIdOf(payload)` = `encounterId` → `dismissed` (`closedAt` from the clock, `closedByRole` / `closedByPlayerId` from `env.actor`), one `NotificationDismissed` each, in row `seq` order. None → no change, no event. MVP user: `damage-card` ([FR-CBT-59](combat-tracker.md#6-functional-requirements)); later kinds (combat-extras) choose per kind. | R5; [ADR-0034](../architecture/adr/0034-encounter-scoped-notifications.md) |
| FR-NOTE-24 | **Handled actions aren't unread** (amends FR-NOTE-18; decided #178): a notification with an action counts as unread only while `pending`; info rows as before. A card applied, dismissed or closed at End leaves the action owner's bell; reopened (undo) → counts again if its `seq` > last seen. | R5 |
| **Sprint 2** (track P2a) | | |
| FR-NOTE-25 | **Update a pending row** (N7; [ADR: split attack and damage](../architecture/adr/0037-split-attack-damage.md), accepted #190): server helper `updateNotification(env, id, {text?, payload})` in the kind owner's command and transaction: not in campaign → `not_found`; not `pending` → `conflict`; payload re-checked against the kind's zod and the kind's `payloadMaxBytes` (`damage-card`: 4 KB as built, #163), text per FR-NOTE-21 (failure → helper throws, FR-NOTE-03). Audience, action, `seq` and `createdAt` never change; `updatedAt` from the clock. Emits **`NotificationUpdated {notificationId, kind}`** (new event; record upsert; visibility FR-NOTE-06) after the owner's event. No toast (FR-NOTE-13 stays create-only), unread unchanged (same `seq`); an open toast or row re-renders the new text. MVP user: combat's `cbt.rollDamage` ([FR-CBT-71](combat-tracker.md#6-functional-requirements)). | Was a non-goal ("editing"); gems' future update fits it |
| FR-NOTE-26 | **Where an action came from** (N8, report item 11): `NotificationActionContext` gains `origin: {source: "toast" \| "history", rect}` (the clicked toast's or row's bounding box in viewport px) and `closeToast()` (closes this notification's toast locally, as the user's close: no dismiss, FR-NOTE-14). Client export `hideToast(notificationId)` (same effect, callable by a kind owner's own UI, e.g. combat's popup opened from its Pending list). A hidden toast doesn't come back for that row in this page load; the row stays in `note.history` and the bell. | N8, item 11 |
| FR-NOTE-27 | **DM bell counts players' pending actions** (G9; amends FR-NOTE-18, -24; OQ-NOTE-17): on the DM client, a `pending` row whose action owner is a **player** also counts as unread while pending (`seq` > last seen), since the DM may act on it (FR-NOTE-08). Still **no DM toast** for it (FR-NOTE-13 unchanged: pending toasts go to the action owner). Player clients unchanged. DM-owned pending rows count exactly as before (e.g. character-sheet-full's G8 `charx-draft` card, owner DM: toast + bell per FR-NOTE-13 / -24). | G9 |
| FR-NOTE-28 | **Rule closures have no actor** (G9; amends FR-NOTE-07, -17 and [FR-CBTX-43](combat-extras.md#6-functional-requirements)): `resolveNotification(…, {byRule: true})` writes `closedByRole` and `closedByPlayerId` **null** (`closedAt` set). The history state badge reads **"Closed"** (no name) for a resolved row with no actor; the kind's resolved view gives the reason (e.g. CBTX "Ended", "Undone"). Rows closed by rule before this pass keep "Resolved by DM" (no backfill). | G9 "Resolved by DM" after End |
| FR-NOTE-29 | **Encounter link on a view** (G9): a client view may declare `encounterIdOf?(payload) → string \| null` (plain function; the end rule's `encounterIdOf` counts too). Combat's DM Initiative lists pending rows whose view links them to the started encounter ([FR-CBT-79](combat-tracker.md#6-functional-requirements)). Notifications itself only carries the field. | G9 |
| FR-NOTE-30 | **Action cue** (N11, DM client only; OQ-NOTE-16 settled S3; scope decided #190: **pending action notifications only, info rows never cue**; the label is always the notification text): when an `event` frame (`cause.name = NotificationCreated`) brings a row new to the store with `state = pending` and `actionRole = player`, the DM sees a cue for **4 s** on the tokens returned by the kind's DM view `cueTokens?(n, store) → tokenId[]`; no hook → default = tokens on the DM's viewed scene owned by `actionPlayerId` that are bound to an active combatant of the started encounter, else all their tokens on that scene. Cue = scenes-map decoration `cue {id: "note-token-cue", label}` (pulsing accent ring + bell above the token; static under reduced motion), label = the notification text; a second cue on a token restarts the 4 s. Drawn through notifications' own `tokenOverlays` line `note` (new file `token-cue.ts`, DM client only; registry append-only). Never from a snapshot, resync or reconnect; a token not on the viewed scene gets none (the Pending row and the bell still show it). Players: nothing. | N11 |
| FR-NOTE-31 | **History window opens at its size** (sprint-1 leftover, seam S5; amends FR-NOTE-17 geometry): `note.history` opens at its default **360×480** at both 1440×900 and 1280×720 (it opened ~250 px tall), under FR-SHELL-29's fit unchanged; a stored (user-resized) size is respected as today. **Root cause first** (the window def declares 360×480, `window.tsx`): if the cause is in the play-shell frame (default rect, anchor offset or fit), the fix goes into P2b's `fix/shell-minimise` (frame lock), not into notifications' files. | Leftover |
| FR-NOTE-32 | **Toasts keep clear of Initiative** (sprint-1 leftover, seam S5; amends FR-NOTE-14 placement within the shell's toast region, FR-SHELL-01): on the DM client the toast stack is placed so it doesn't overlap the rendered rect of an open, non-minimised `cbt.initiative` window (incl. its Undo and footer): it shifts left within the toast region, keeping a 12 px gap; if the region left of Initiative is narrower than a toast, the stack drops below Initiative's bottom edge. Rects come from play-shell's rendered window rects (consumed, no shell change). Players unchanged (bottom-right). | Leftover; FR-CBT-77 |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md): shadcn Toast (shell's toast region, [FR-SHELL-01](play-shell.md#6-functional-requirements): bottom-right for players, top-centre below the top bar for the DM so toasts clear the Initiative rows, #153), Badge, Button, ScrollArea, Separator; dark only; semantic tokens.

- **Screens:** toasts; `note.history` window (default bottom-right above the toast region, 360×480, min 280×240). Pending rows on top with accent border token; closed rows muted with state badge. A toast whose notification leaves `pending` disappears.
- **States:** empty "No notifications yet"; loading = shell skeleton; disconnected = last list + banner, action and Dismiss disabled; reject → FR-NOTE-20.
- **DM view:** toasts for info aimed at DM/all and every pending action the DM owns (damage cards). Window shows everything with audience tags; action on any pending row; Dismiss.
- **Player view:** toasts for info aimed at them or all and for pending actions they own. Window shows their own and `all` notifications, incl. their damage cards' state and resolution (#138); no Dismiss.
- **Sprint 2:** an updated pending row re-renders in place (no new toast). DM: pending rows owned by a player (audience tag "‹player›") count on the bell (FR-NOTE-27); rule-closed rows show a neutral "Closed" badge (FR-NOTE-28). Action cue: accent ring pulse + small bell above the token for 4 s, DM map only (FR-NOTE-30).
- **Test IDs** (AGENTS §9.5): `note-toast` + `data-record-id`, `note-toast-action`, `note-toast-close`, `note-toast-more`, `note-toast-pending-summary`, `note-history`, `note-history-row` + `data-record-id` + `data-state`, `note-history-action`, `note-history-dismiss`, `note-history-empty`, `note-launcher-badge`, *(sprint 2)* `note-history-closed` (the "Closed" badge); Konva `note-token-cue` (id = token id, attr `label`); test mode: `note-test-text`, `note-test-audience`, `note-test-owner`, `note-test-label`, `note-test-send`.

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
| Kind / View *(code)* | server: kind, ownerSpec, payload, resolution?, genericResolve, *(R5)* endRule?; client: kind, icon, render?, onAction?, *(R5)* endRule? (same shared constant), *(sprint 2)* encounterIdOf?, cueTokens? | — | Registries, not stored |
| Seen marker *(browser)* | lastSeenSeq | int | Per (campaign, owner); never sent |

- **Relations:** campaign 1–n notification; player 0..1 as audience or action owner. Payload IDs are checked by the kind owner when the action runs.
- *(Sprint 2)* `closedByRole` null on a `resolved` row = closed by a rule (FR-NOTE-28); no column change.
- **Derived:** pending for me, unread count, display order. `seq` gaps show a player that hidden notifications exist, never their content (accepted). Toasts and timers are client memory only.

## 9. API & events

**REST:** none.

| Intent | Who | Validation | Result |
|---|---|---|---|
| `note.dismiss {id}` | DM | In campaign (else `not_found`); `pending` (else `conflict`) | — |
| `note.resolve {id, resolution?}` | DM, player | FR-NOTE-09 | — |
| `note.testSend {text, audience?, audiencePlayerId?, actionLabel?, actionRole?, actionPlayerId?}` *(test mode)* | DM, player | DM: FR-NOTE-04/05. Player: FR-NOTE-22 (strict) | `{id}` |

**Server API** (in-process): `notify`, `resolveNotification`, `reopenNotification` (FR-NOTE-02/08/10); kind registry (FR-NOTE-03); *(R5)* `dismissForEncounter` (FR-NOTE-23): same `NotificationDismissed` event and record visibility (FR-NOTE-06) as `note.dismiss`; no new event, field or intent. *(Sprint 2)* `updateNotification` (FR-NOTE-25); `resolveNotification(…, {byRule})` writes no actor (FR-NOTE-28). **Client API:** `hideToast(id)`, action context `origin` / `closeToast()` (FR-NOTE-26).

**WS events** (generic record changes, [ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md) A)

| Domain event | Payload | Changes | Logged | Undoable | Visibility rule |
|---|---|---|---|---|---|
| `NotificationCreated` | `{notificationId, kind, audience, audiencePlayerId, hasAction}` | `notification` upsert (before null) | yes | no | Record fn (FR-NOTE-06) |
| `NotificationResolved`, `NotificationDismissed`, `NotificationReopened` | `{notificationId, kind}` | `notification` upsert | yes | no | Record fn |
| `NotificationUpdated` *(sprint 2, FR-NOTE-25)* | `{notificationId, kind}` | `notification` upsert (pending → pending, new text / payload) | yes | no | Record fn: the row's audience (e.g. a damage card: the rolling player + DM); others nothing |

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
- **Sprint 2.** *Update:* commits with the owner's change or not at all; an update racing a resolve / dismiss → whichever commits first wins, the other gets `conflict` (FR-NOTE-20). A client offline during an update gets the new text in its reconnect snapshot; nothing replays. *Hidden toast* (FR-NOTE-26) is page memory: a reload shows the summary toast as usual (FR-NOTE-15). *DM bell* (FR-NOTE-27) is derived from the store, so it survives reconnect and restart. *Action cue* is live-only: a DM offline or on another scene at creation sees no cue, and a crash between commit and send loses it (the row stays pending; accepted, as the turn alert).
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
| Unit | Visibility fn per audience × role; state machine; kind registry (unknown kind, payload > 1 KB, resolution > 256 B, bad text). Client: toast trigger (event vs snapshot, audience, owner), 6 s timer paused on hover / hidden tab, 3-toast cap, summary toast on load/reconnect only (not on resync while `live`), button rules, unread + baseline + storage failure. **Polish (R5):** `FR-NOTE-24 unread` (pending card unread → resolved / dismissed not → reopened again; info row unchanged); `FR-NOTE-23 registry` (an end rule without `encounterIdOf` throws at load; for every kind with an end rule the server definition and both client views hold the same constant; `encounterIdOf` of the damage-card payload = its `encounterId`) | In-code |
| Integration | DM sees 7; `player-1` sees `info-all`, `info-p1`, `pending-p1`, `resolved-all`; `player-2` sees `info-all`, `resolved-all`; `SECRET-NOTE` never in a player frame. Test command: `notify` then throw → no row, event or log. Test command changing a probe + resolve, run twice → second `conflict`, probe changed once. `note.resolve` by player-2 on `pending-p1` → `not_found`; by player on a non-generic kind → `forbidden`; `note.dismiss` by player → `forbidden`; player `testSend` with `audience` → `invalid`. Reopen after owner event (order). Window: 105 closed + 3 pending → DM 103; floor identical for all viewers; players get the visible subset. Convergence per ADR-0029 helper. Restart on same DB → identical snapshots; resolve after restart works | `notifications` |
| Unit (sprint 2) | `FR-NOTE-26` toast hidden by `closeToast()` / `hideToast(id)` stays hidden while pending, row and bell unchanged; `FR-NOTE-27 DM unread` (player-owned pending row counts for the DM, not toasted; leaves the count when resolved; player client unchanged); `FR-NOTE-28 badge` (resolved, role null → "Closed"; role dm → "Resolved by DM"); `FR-NOTE-30 cue predicate` (live `NotificationCreated` + pending + player owner → cue; snapshot, resync, info row, DM-owned row → none; `cueTokens` hook wins; default picks the owner's bound token, else every owned token on the viewed scene; 4 s expiry, restart on a second cue; player client none); `FR-NOTE-31 history geometry` (1440×900 and 1280×720 → 360×480 inside the work area; a regression test at the root cause's layer); `FR-NOTE-32 toast keep-out` (Initiative open → stack left of it with 12 px gap; too narrow → below it; minimised / closed → default place; player client unchanged) | In-code |
| Integration (sprint 2) | `FR-NOTE-25 updateNotification`, test-registered kind `t-upd` (player audience): update pending row → one `NotificationUpdated` after the caller's event, `seq` unchanged, `player-1` gets the upsert, `player-2` nothing; on a resolved row → `conflict`, caller rolls back; payload over the kind's `payloadMaxBytes` → throws, nothing written. `FR-NOTE-28`: `resolveNotification(…, {byRule: true})` → `closedByRole` null; restart → identical snapshots | `notifications` |
| Integration (polish) | `FR-NOTE-23 dismissForEncounter`, test-registered kinds `t-enc` (end rule `{onEncounterEnd: "dismiss", encounterIdOf: p => p.encounterId}`) and `t-keep`: pending `t-enc` for E1 (×2) and E2, resolved `t-enc` for E1, pending `t-keep` for E1 → helper(E1) dismisses the two pending E1 rows only, `NotificationDismissed` × 2 in `seq` order after the caller's event; caller throws → nothing; `player-1` audience row upsert reaches `player-1` only. The real end-to-end is combat's `FR-CBT-59` test | `notifications` |
| E2E (thin) | DM `note.testSend` pending to player-1 → player toast → Done → DM row "Resolved by Player 1" | `notifications` |

**Browser walkthrough** — `PP_TEST_MODE=1`; `bun run build`; `fixtures:reset-load notifications --profile verify`; `start --profile verify` in the test agent's pane; evidence per [AGENTS §9.6](../../AGENTS.md#96-browser-verification-test-agents). Contexts **A** DM, **B** `player-1`, **C** `player-2`, **D** DM second tab. Changes show ≤ 1 s.

| # | DM | Players | Expected |
|---|---|---|---|
| 1 | A logs in, opens Notifications | — | Summary toast "1 pending action". Pending: `pending-dm`, `pending-p1`; History: 5 rows with audience tags. No per-item toasts. *(Sprint 2)* The window is 360×480 at 1440×900 (FR-NOTE-31) |
| 2 | — | B, C open links, open Notifications | B: summary "1 pending action"; 4 rows, `pending-p1` with Done. C: no summary; 2 rows. No `SECRET-NOTE` in B or C |
| 3 | A sends info to All "Torches gutter" | — | Toast in A, B, C; hides after ~6 s; History row in all three |
| 4 | A sends pending to Player 1, owner Player 1, "Done", "Roll DEX save" | — | B: sticky toast with Done. C: nothing. A: no toast; row Pending "Player 1"; *(sprint 2)* A's bell badge +1 (FR-NOTE-27), back after step 5 |
| 5 | — | B clicks Done on the toast | B toast gone; "Resolved by Player 1" in A and B |
| 6 | — | B sends test "Apply 4 damage?" | A and D: sticky toast with Resolve. B: row Pending, no button, no toast |
| 7 | A and D click Resolve at once | — | One succeeds; the other "No longer pending". One "Resolved by DM" row everywhere |
| 8 | A dismisses `pending-dm`, reloads | — | Row "Dismissed"; after reload no summary toast |
| 9 | A sends info to All and pending to Player 1 while B is dropped | B closes Notifications, then "drop connection" (Probes window) | B reconnects: no per-item toasts; summary "2 pending actions" (new one + `pending-p1`); badge 2 |
| 10 | Hard-kill + restart server | — | All reconnect; lists identical; B resolves the pending one |
| 11 | A switches to Second Campaign, then back | — | "No notifications yet", then the full list again |
| 12 | *(R5)* A opens Notifications (marks seen), closes it; B sends test "Apply 2 damage?"; A resolves it from the toast | — | A's bell shows 1 while pending, then none after Resolve (FR-NOTE-24); the row stays in History "Resolved by DM". End-of-encounter dismissal is walked in [combat-tracker §13](combat-tracker.md#13-test-plan) step 14 |
| 13 | *(sprint 2)* A sends pending to Player 1 (owner Player 1) while viewing no scene | — | No cue (this bundle has no scene or token; FR-NOTE-30 needs one): the cue, "Closed" badge and the Initiative Pending row are walked in [combat-extras §13](combat-extras.md#13-test-plan) steps 4 and 13; the update helper and toast-over-popup in [combat-tracker §13](combat-tracker.md#13-test-plan) steps 6–7 and 9c; toasts clear of Initiative (FR-NOTE-32) in combat-tracker step 6 |

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
| Sprint 2 (P2a) | [scenes-map](scenes-map.md) token decoration `cue` + overlay redraw on client-only state (OQ-NOTE-16); [combat-tracker](combat-tracker.md) FR-CBT-71 (update user), FR-CBT-75 (origin), FR-CBT-79 (encounter link); [combat-extras](combat-extras.md) FR-CBTX-48/49 (concentration view `encounterIdOf`, `cueTokens`) | in-review |

**Shared changes needed** (AGENTS §9.9; gate §4):
- `src/server/db/` — `notification` table, indexes (campaignId, seq), (campaignId, state). `src/shared/events/` — the four `Notification*` events.
- Record-type registry line `notification` with `window {orderBy: seq, size: 100, pin}` — needs ADR-0029 support in `src/server/ws/` + `src/shared/protocol/` (gate §4 item 4).
- New append-only registries (created empty by this build; on the AGENTS §9.9 list): `src/server/features/notifications/kinds.ts`, `src/client/dm/notification-views.ts`, `src/client/player/notification-views.ts`.
- Existing registries: `notifications` in `src/server/features/index.ts`; `note.history` in `src/client/{dm,player}/windows.ts`; `notifications` in `fixtures/bundles/index.ts`. `src/client/common/` shell: `badge?(store)` on window types (FR-SHELL-07).
- Docs (integrator): protocol rows, data-model row, ADR-0016 "MVP use" line (I30).

**Shared changes — polish pass** (sprint 1, R5; after the DM gate):
- Notifications-owned files: `@shared/notifications` gains type `EncounterEndRule` (beside `schemas.ts`); `kind.ts` (kind type gains optional `endRule` + the load check), `helpers.ts` (new `dismissForEncounter` beside `notify` / `resolveNotification`); client view type (`views.ts`) gains optional `endRule`. Combat exports `DAMAGE_CARD_END_RULE` from `@shared/combat-tracker`, references it in its own `card-kind.ts` and `card-view.ts`, and calls the helper from `cbt.end`; the append-only `kinds.ts` / `notification-views.ts` untouched (same `fix/*`; must merge **before the combat-extras build**).
- Client (own files): `logic.ts` `unreadCount` / `addressedForUnread` (FR-NOTE-24).
- **None:** DB columns, events, record types, visibility, intents. Docs at consolidation: protocol §23 (kind table: end-rule column), notifications row in §26 if needed. ADR: [ADR-0034](../architecture/adr/0034-encounter-scoped-notifications.md) (amends ADR-0016 / ADR-0027 consequences; number at merge).

**Shared changes — sprint 2** (track P2a; builders report `shared change needed:`):
- `src/shared/events/`: new `NotificationUpdated {notificationId, kind}` (+ `domainEvents` line). **No** DB column, record type, visibility or intent change (`closedByRole` is already nullable).
- Notifications-owned: `helpers.ts` (`updateNotification`; `byRule` writes no actor); client `views.ts` (view type: `encounterIdOf?`, `cueTokens?`; action context `origin`, `closeToast`), `parts.tsx` / `ToastRuntime.tsx` / `toasts.ts` (`hideToast`, origin rect), `logic.ts` (DM unread rule), `HistoryWindow.tsx` ("Closed" badge), new `token-cue.ts`, `window.tsx` (FR-NOTE-31, only if the root cause is there; else P2b's `fix/shell-minimise`), `ToastRuntime.tsx` keep-out (FR-NOTE-32; reads play-shell's rendered window rects incl. grown heights, FR-SHELL-39, so it builds after `fix/shell-minimise`).
- Append-only: `tokenOverlays` line `note` (`src/client/common/features/scenes-map/token-overlays.ts`).
- scenes-map contract (scenes-map-owned, OQ-NOTE-16): `TokenDecoration.cue`, overlay redraw hook.
- Docs (integrator): protocol §8 / §22 event row, §23 note ("pending rows may be updated by their kind owner"); glossary **Action cue** (OQ-NOTE-18); ADR "split attack and damage" (accepted #190; integrator numbers it) (amends this spec's non-goal).

## 15. Open questions

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| ~~OQ-NOTE-01~~ | ~~Who may resolve an action?~~ | Decided (#136): only the DM applies or dismisses damage cards (owner `dm`). Mechanism: action owner + DM (ADR-0016 "named actor" row; MVP's only player-owned kind is `test`) | — | combat-tracker, ADR-0016 |
| ~~OQ-NOTE-02, 04, 06, 08, 09~~ | ~~Game log as feed; toast timing; damage-card owner; `loot-received`; where "seen" lives~~ | Decided: 02 separate windows (I6); 04 info 6 s, paused on hover / hidden tab, pending stays (#139 P26); 06 combat-tracker owns `damage-card` (I7); 08 `loot-received` owned by party-loot, info to everyone (#146); 09 browser `localStorage` per (campaign, owner) (#139 P27) | — | dice-roll-log, combat-tracker, party-loot |
| ~~OQ-NOTE-03, 05, 07~~ | ~~History retention; creation; undo of applied damage~~ | Decided: 03 keep all in DB, snapshot = pending (pinned) + newest 100 closed, no load-older (#137, ADR-0029); 05 `notify` inside the causing command's transaction (#135, ADR-0027); 07 undo reopens the card, no Redo, owner event first (#139 P4, I28) | — | live-sync, combat-tracker |
| ~~OQ-NOTE-10, 12~~ | ~~Kind + view registries append-only; glossary "Action owner"~~ | Decided (integrator): both registries on the AGENTS §9.9 list (paths §14); glossary adds **Action owner** | — | AGENTS.md, glossary |
| ~~OQ-NOTE-11~~ | ~~Damage card audience~~ | Decided (#138): rolling player sees the card and its resolution incl. damage applied; DM attacks: `dm` | — | combat-tracker |
| ~~OQ-NOTE-13~~ | ~~Launcher unread badge: play-shell window types gain `badge?(store) → number` ~~ Decided (#142): add `badge?(store)`; shared change by build/notifications | **Add** (shared change, gate §4 item 11) / unread count in the window title only | no · owner: orchestrator | play-shell |
| ~~OQ-NOTE-15~~ | ~~R5: what happens to pending notifications when their encounter ends?~~ | **Decided #178** (with [OQ-CBT-45](combat-tracker.md#15-open-questions)): **A**, kinds opt in to dismissal on End with an end rule (FR-NOTE-23); handled actions leave the bell (FR-NOTE-24) | — | combat-tracker, combat-extras |
| ~~OQ-NOTE-16~~ | ~~N11 cue on the map: scenes-map's overlay contract has no transient cue, and overlays redraw only on record or selection changes~~ | **Settled S3 (orchestrator):** scenes-map FR (P2b): `TokenDecoration.cue {id, label}` (pulsing accent ring + bell) and `TokenOverlay.subscribe(onChange)`; built in P2a's `fix/combat2-core` after P2b's `fix/map-fit-floor` | — | scenes-map FR-MAP-34 |
| ~~OQ-NOTE-17~~ | ~~G9: which pending rows count on the DM's bell~~ | **Decided (#190):** every pending row owned by a player (the DM may act on any, FR-NOTE-08; no toast). Rejected: per-kind opt-in flag | — | combat-extras |
| OQ-NOTE-18 | Glossary: **Action cue** ("a few-second mark on a player's token on the DM's map when that player gets an action notification") | **Add** | no · owner: integrator | glossary |
| ~~OQ-NOTE-14~~ | ~~Toast to the rolling player when the DM resolves their card?~~ | Decided (#141): **no**; the card's resolution in `note.history` shows it (FR-NOTE-13, -18 unchanged) | — | combat-tracker |

## 16. Out of scope

- Concentration, duration and turn reminders; rule listeners → [combat-extras](combat-extras.md), ADR-0027 C.
- Roll requests → [dice-extras](post-mvp/dice-extras.md) (future kind, player owner). Kill-feed toasts → [stats](post-mvp/stats.md). `loot-received` → [party-loot](party-loot.md) (#146).
- [Gems](post-mvp/gems.md) (#140): modifying a pending damage card's dice is combat-tracker's command; if card text must change then, ~~a post-MVP `updateNotification` helper (pending only)~~ *(sprint 2: exists, FR-NOTE-25)*. No MVP change.
- Load older history, server read state, cross-browser seen marker.
