---
title: Notifications
prefix: NOTE
status: in-review
owner: spec-wf, spec-sb, spec-tt, spec-fx
wave: 2
phase: post-mvp-9
---

# Notifications

> **Sprint 5 (track K, BL-17 via [#251](../decisions-log.md)).** Decided by the DM (not open): the **player colour** appears in notifications ([campaign-management](campaign-management.md) FR-CAMP-23–29 owns the colour). New FR-NOTE-38–41 (track K's range; P adds handout rows in parallel). *(Seams S3: W edits FR-NOTE-31 / -32 in its own branch; K owns FR-NOTE-38–41.)* One schema change: `notify` stamps **who caused** the notification (`byRole`, `byPlayerId`), measured ≤ 8.4 KB on the heavy DM snapshot. Walkthrough: [CAMP §13](campaign-management.md#13-test-plan) K7, K12.

**Sprint 5 at a glance** (track K)

| FR | What | Slice | Named test |
|---|---|---|---|
| FR-NOTE-38 | `notify` stamps `byRole` / `byPlayerId` from `env.actor` | K0 | `FR-NOTE-38 notify stamps by`, `FR-NOTE-38 visibility` |
| FR-NOTE-39 | Toast + history row: a left stripe in the creator's colour | K4 | `FR-NOTE-39 accent stripe` |
| FR-NOTE-40 | *(OQ-CAMP-27, cut list, decided #256)* "Resolved by ‹name›" in the closer's colour; the action cue ring in the action owner's | K4 (+ K3 for the ring) | `FR-NOTE-40 names and cue` |
| FR-NOTE-41 | Old rows, fallback, recolour | K4 | `FR-NOTE-41 old rows` |

Decided at sprint-5 DM gate 1 (#256, every pick accepted): §15 OQ-NOTE-22–24.

> **Sprint 6 (track WF, window + layout fix pack; DM #286; session-sim-9 FAIL b, glitch 3).** Decided, not open: the DM's "N pending actions" toast **never covers the Fog bar** (sim-9 b01: 6 of 16 controls under `note-toast-pending-summary` at 68..388 × 100..157) **or the map's top-left** (a01: over the Dragon once windows were open). Root cause (`keep-out.ts` `dmStackPlacement`): with windows open, the stack's candidate spots include the left edge (x = 68) and spots beside every window, and the active tool bar is not among its blockers, so the least-window-body spot was the top-left, on the bar and the map. New FR-NOTE-42, -43; amended FR-NOTE-32. **For the DM:** OQ-NOTE-25 (how). Players unchanged. Walkthrough [play-shell §13](play-shell.md#13-test-plan) F0, F5, F6.

| FR | What | Slice | Named test |
|---|---|---|---|
| FR-NOTE-42 | The DM stack stays in its top-centre band (moves down, not sideways) (proposed, OQ-NOTE-25 A) | WF2 | `FR-NOTE-42 stack stays home` |
| FR-NOTE-43 | The DM stack never overlaps a hard keep-out (the active tool bar); recomputed when keep-outs change | WF2 | `FR-NOTE-43 never over a tool bar` |

> **Sprint 7 (track FU, DM [#311](../decisions-log.md); session-sim-10 glitch 6; BL-48).** Decided, not open: the DM's pending toast no longer **covers the Scenes window's first row while windows are pushed** by the Fog bar (b05: Scenes pushed to 546, 60, the stack at its home on top of "Goblin Ambush"); the summary's count no longer disagrees with Initiative's "Pending (2)" (BL-48). Root cause of b05: the push (FR-SHELL-55) may end inside the DM's soft top-centre box, and the stack's last choice is "the least window body". New **FR-NOTE-44** (the stack carries b05 on its own: play-shell's FR-SHELL-82 push rule was retired at review, it can't trigger at the reference sizes), **FR-NOTE-45**. Client only, 0 B. Walkthrough U4, U17 in [play-shell §13](play-shell.md#13-test-plan); slices FU1 (`keep-out.ts` fallback), FU4 (summary text). No open question.

| FR | What | Slice | Named test |
|---|---|---|---|
| FR-NOTE-44 | The DM stack never covers a pushed window's first row | FU1 | `FR-NOTE-44 toast clear of a pushed window` |
| FR-NOTE-45 | The DM summary also counts actions waiting for players | FU4 | `FR-NOTE-45 summary counts waiting` |

> **Sprint 7 (track ST, stats tier A, DM [#311](../decisions-log.md); spec-stats).** [Stats](stats.md) adds one info kind and one non-notification toast. **FR-NOTE-48**: kind `stats-awards` (audience all, no action), made when the DM presses **Show awards**. Its history row has **Open**. **FR-NOTE-49**: the overkill callout toast is a plain Toast in the same region, **not** a notification (no row, no bell, no history), like combat-extras' expiry toast (FR-CBTX-06). CON-44 measured: 575 B a `stats-awards` row, inside the 100-closed window, so the snapshot doesn't grow with sessions ([stats §12](stats.md#12-performance--bandwidth)).

| FR | What | Slice | Named test |
|---|---|---|---|
| FR-NOTE-48 | Kind `stats-awards`: info to all, payload `{fromN, toN, from, to, label}`, view with Open | ST0 (kind), ST2 (views) | `FR-NOTE-48 awards notification` |
| FR-NOTE-49 | Callout toasts are not notifications; a transient info toast in the info stack (S6) | ST2 | `FR-NOTE-49 callout toast is not a notification` |

> **Sprint 8 (track WF; DM [#333](../decisions-log.md)).** One toast policy for both clients (FR-NOTE-50). New kinds name a toast class (FR-NOTE-52; seams S3–S5, S13). Fixed **BL-59** (the DM stack stayed low after a tool closed, FR-NOTE-51). FR-NOTE-44 reads the [placer](play-shell.md#6-functional-requirements)'s plan (FR-NOTE-53). New FR-NOTE-50–53; slice **WF4**; walkthrough F8 ([play-shell §13](play-shell.md#13-test-plan)). 0 B.

> **Sprint 8 (track SB, stats tier B, DM [#334](../decisions-log.md); spec-sb).** [Stats](stats.md#61-tier-b-sprint-8) adds one info kind and widens one non-notification toast. **FR-NOTE-68**: kind `stats-fight-summary` (audience `all` or `dm`, no action), made by combat's `ended` rule hook at End; its history row has **Open**. **FR-NOTE-69**: the **kill-feed** toast replaces the overkill toast, in the **callout** class (FR-NOTE-50; no row, bell or history). Seams S4, S5, S10, S13 applied. CON-44 measured: 536 B a summary row, inside the 100-closed window, so no growth.

| FR | What | Slice | Named test |
|---|---|---|---|
| FR-NOTE-68 | Kind `stats-fight-summary`: info to `all` (public fact) or `dm`, payload `{encounterId}`, view with Open | SB0 (kind), SB1 (views) | `FR-NOTE-68 fight summary notification` |
| FR-NOTE-69 | The kill-feed toast is a callout (FR-NOTE-50), not a notification; it replaces the overkill toast (FR-NOTE-49 amended) | SB1 (after WF4) | `FR-NOTE-69 feed toast is not a notification` |

> **Sprint 8 (track TT; DM [#334](../decisions-log.md)).** A DM roll request is a notification with a roll action: [dice-extras](dice-extras.md) adds kind **`roll-request`** (toast class **card**, FR-NOTE-50; seams S3, S13), one pending prompt per target PC, resolved only by dice-extras' commands. FR-NOTE-58–64, incl. a view flag `restoreToast`. CON-44: a prompt row 994 B ([dice-extras §12](dice-extras.md#12-performance--bandwidth)). Tests and walkthrough (T4–T8, T10, T12): [dice-extras §13](dice-extras.md#13-test-plan). Decided at gate 1 (#335): OQ-NOTE-32–34.

> **Sprint 9 (track FX, fix pack; DM [#338](../decisions-log.md)).** Fixes session-sim-12 FAIL c (**BL-83**: the DM stack left its home band, landing at x 68 over Mira at 1280×720 and at 276, 218 over the party at 1440×900), **BL-75** (stack over the Game log's roll bar) and **BL-88** (a card toast over the Notifications window's own Apply). It also makes each kill-feed callout its own node (**BL-84**, with [stats](stats.md) FR-STATS-68).
> - **Root cause of BL-83** (code read, `keep-out.ts` `dmStackLefts`):
>   - Walkthrough WF4's fix added "beside a window over the home column, left then right" to the candidate lefts. It clamped them only at the rail (`left ≥ 68`).
>   - Such a spot wins whenever it clears every window body, whatever tokens it covers. That contradicts FR-NOTE-42 (decided #288: never x 68, never beside windows).
>   - The drawn stack then also differs from the frame's soft `toasts` keep-out (the home column), as c01 reported.
> - **Root cause of BL-75**: "least window body" prefers a thin overlap at a low window's bottom edge, which is where the Game log's roll bar is.
> - FR-NOTE-70–73 (slice **FX1**, client only) and FR-NOTE-74 (slice FX2, a server helper option for **BL-63**). Walkthrough [§13 FX1](#13-test-plan). 0 B.

| FR | What | Slice | Named test |
|---|---|---|---|
| FR-NOTE-70 | The DM stack's lefts are home and the Initiative shift only (BL-83) | FX1 | `FR-NOTE-70 stack never leaves its column` |
| FR-NOTE-71 | No body-clear spot → the clear spot nearest home, not the least body (BL-75) | FX1 | `FR-NOTE-71 nearest home, not the least body` |
| FR-NOTE-72 | An open Notifications window holds the card toasts; the DM stack keeps clear of it (BL-88) | FX1 | `FR-NOTE-72 cards fold into an open Notifications window` |
| FR-NOTE-73 | Each callout show is a new node (BL-84) | FX1 | `FR-NOTE-73 callout node per show` |
| FR-NOTE-74 | `updateNotification({emit: false})` folds the row into the caller's event (BL-63) | FX2 | `FR-NOTE-74 update folds into the caller's event` |

## 1. Summary

- **Notification**: a persisted, toast-like message with a history feed. It has a kind, an audience and optionally an action ([ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md), [decisions #47](../decisions-log.md)). With an action it is a **pending action** until resolved or dismissed (e.g. a damage card's "Apply"). Without one it is info.
- This spec owns the mechanism: record type, states, server helpers, toasts, history window. Kinds and payloads belong to the features that create them ([combat-tracker](combat-tracker.md): damage card).
- Created and resolved **inside the causing command's transaction** ([ADR-0027](../architecture/adr/0027-notification-creation.md), #135).
- **Polish pass** (sprint 1, R5; FR-NOTE-23, 24): a kind may declare that its pending rows are **dismissed when their encounter ends** (damage cards do; decided #178, [OQ-CBT-45](combat-tracker.md#15-open-questions)); handled action rows no longer count as unread.
- **Sprint 2** (track P2a; FR-NOTE-25–32; 31/32 are sprint-1 leftovers: history window size, toasts clear of Initiative): a kind owner may **update** a pending row (combat's split Attack / Damage card, N7); a view's action learns **where it was clicked** and can close its toast (N8); the DM's bell counts pending actions owned by players and rule closures read "Closed" (G9); the DM sees a few-second **action cue** on a player's token when that player gets an action (N11).
- **Sprint 5** (tracks W and K). **W** (seams S3; FR-NOTE-31 / -32): toasts, alerts and roll popups stay where they are (players bottom-right, DM top-centre; decided #256, OQ-SHELL-32 C), so FR-NOTE-32 is unchanged; the boxes are sized for the 320 × 190 roll popup ([FR-SHELL-49](play-shell.md#6-functional-requirements)); the history window opens 480 high where a clear slot allows, else 412 at 1280×720 (FR-NOTE-31). Stack order unchanged (notifications nearest the launcher). Other sprint-5 NOTE rows are track K's. **K** (BL-17; FR-NOTE-38–41): each notification records **who caused it** (the command's actor); toasts and history rows carry a stripe in that person's **player colour**; "Resolved by ‹name›" and the action cue use the closer's / action owner's colour.
- **Sprint 6** (track WF; FR-NOTE-42, -43; proposed, OQ-NOTE-25 A): the DM's toast stack stays at its top-centre home (it moves down past windows instead of jumping to the left edge) and never sits on the active map tool bar, so every Fog bar control stays clickable.

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
| FR-NOTE-31 | **History window opens at its size** (sprint-1 leftover, seam S5; amends FR-NOTE-17 geometry): `note.history` opens at its default **360×480** at both 1440×900 and 1280×720 (it opened ~250 px tall), under FR-SHELL-29's fit unchanged; a stored (user-resized) size is respected as today. **Root cause first** (the window def declares 360×480, `window.tsx`): if the cause is in the play-shell frame (default rect, anchor offset or fit), the fix goes into P2b's `fix/shell-minimise` (frame lock), not into notifications' files. *(Sprint 5, track W, settled by seams S3; [FR-SHELL-45](play-shell.md#6-functional-requirements))* 480 high **where a clear slot allows**; else the tallest slot clear of every window and keep-out region (≥ min size), never over the Game log: **412 high at 1280×720** (both clients). Placement does it (`minOpenH` counts as full size there); no notifications code. | Leftover; s5 |
| FR-NOTE-32 | **Toasts keep clear of Initiative** (sprint-1 leftover, seam S5; amends FR-NOTE-14 placement within the shell's toast region, FR-SHELL-01): on the DM client the toast stack is placed so it doesn't overlap the rendered rect of an open, non-minimised `cbt.initiative` window (incl. its Undo and footer): it shifts left within the toast region, keeping a 12 px gap; if the region left of Initiative is narrower than a toast, the stack drops below Initiative's bottom edge. Rects come from play-shell's rendered window rects (consumed, no shell change). Players unchanged (bottom-right). *(Sprint 5: unchanged, decided #256, OQ-SHELL-32 C; the stack keeps its top-centre region and `avoidTokens`.)* *(Sprint 6: the sideways candidates beyond the left-of-Initiative shift are retired by FR-NOTE-42; hard keep-outs block like Initiative, FR-NOTE-43.)* | Leftover; FR-CBT-77; s5, s6 |
| **Sprint 5** (track K, BL-17) | | |
| FR-NOTE-38 | *(OQ-NOTE-22 A, decided #256)* **Who caused it:** `notify` (FR-NOTE-02) writes `byRole` (`dm` \| `player` \| null) and `byPlayerId` (ID \| null) from `env.actor` in the same insert: DM actor → `dm` / null; player actor → `player` / their id. **System actor = neutral everywhere** (review #44; same rule as FR-DICE-61): `notify` under a system actor stamps null / null (no stripe), and `resolveNotification` / `note.dismiss` under a system actor write `closedByRole` / `closedByPlayerId` null (the badge reads "Closed", FR-NOTE-28), never "DM" (both in `helpers.ts`, K0's grant, S15). Never in a helper argument or intent (a kind can't set it); `updateNotification`, resolve, dismiss and reopen never change it. Visibility unchanged (FR-NOTE-06: the whole row to its audience); a player only ever learns a player id of their own campaign, whose names they already have (FR-CAMP-19). `note.testSend` (test mode) stamps its sender. | OQ-NOTE-22; review #44 |
| FR-NOTE-39 | *(OQ-NOTE-22, -24, decided #256)* **Accent stripe:** a toast (FR-NOTE-13) and a `note.history` row draw a 3 px **left stripe** in `colorOf(store, {role: byRole, playerId: byPlayerId})` ([FR-CAMP-28](campaign-management.md#6-functional-requirements)); `byRole` null → no stripe. Pending rows keep their accent border (§7) besides the stripe. The stripe is decoration: the text names the person where it matters (colour-blind backup, OQ-CAMP-25). | |
| FR-NOTE-40 | *(OQ-CAMP-27, decided #256: in)* **Names and cue:** the history state badge "Resolved by ‹name›" (FR-NOTE-17) draws ‹name› in the closer's colour (`closedByRole` / `closedByPlayerId`; "Closed" rows unchanged, FR-NOTE-28). The DM's **action cue** ring (FR-NOTE-30) draws in the **action owner's** colour (`actionPlayerId`) instead of the client's role accent: the cue decoration passes `color` (scenes-map's `cue.color?`, [FR-MAP-72](scenes-map.md#6-functional-requirements), drawn over the casing). | review #12 |
| FR-NOTE-41 | *(OQ-NOTE-23 A, decided #256)* **Old rows, fallback, recolour:** rows created before sprint 5 have `byRole` null → no stripe (no backfill: the actor isn't recoverable). A person without a `player` record in the store → no stripe / default text colour. A colour change restripes every row and open toast ≤ 1 s (OQ-CAMP-21, #256). | OQ-NOTE-23 |
| **Sprint 6** (track WF; sim-9 b01, a01) | | |
| FR-NOTE-42 | **The DM stack stays home** (proposed, OQ-NOTE-25 A; amends FR-NOTE-32 and the P3 / sim-6 candidate list in `dmStackPlacement`): the DM stack's candidate **lefts** are only its home, centred (`(vw − 320) / 2`: 480 / 480 / 560 / 640 at 1280×720 / 1280×800 / 1440×900 / 1600×900, [play-shell §7](play-shell.md#7-uiux-notes)), and FR-NOTE-32's left-of-Initiative shift; never x = 68 (the rail), beside other windows or beside tokens. Its **tops** stay as built (100, below title bars, below windows, around the cards' target tokens), so it moves **down** within its band. Choice as built: clear of Initiative, title bars and hard keep-outs (FR-NOTE-43), then the least area of the cards' target tokens (`avoidTokens`), then the least window body, ties → the earlier spot; nothing holds the whole stack above the launcher → the home row, clear of hard keep-outs (the runtime shows "+N more"). Covers every DM toast (summary, cards, info, alerts), not only the summary. Players unchanged. Pure in `keep-out.ts`. | sim-9 a01, b01 |
| FR-NOTE-43 | **Never over a tool bar** (BL-40): a spot overlapping (≥ 1 px) a **hard** keep-out region (play-shell [FR-SHELL-48](play-shell.md#6-functional-requirements) (b): the active map tool bar `map.toolbar`, reported by scenes-map / fog-of-war) is not clear, like Initiative. `ToastRuntime.tsx` reads `useKeepOuts("dm")` and re-places the stack when the keep-outs change (a tool opens, closes, its bar wraps) as it does on window changes. Outcome: with any tool bar shown, `elementFromPoint` at the centre of each of its controls hits that control (sim-9: 6 / 16 Fog bar controls under the summary). The bar's max width already ends 8 px before the home band ([FR-MAP-60](scenes-map.md#6-functional-requirements)), so this bites only when the stack is shifted left of a moved Initiative; then it drops below the bar (top = bar bottom + 8). *(Under [OQ-MAP-57](scenes-map.md#15-open-questions) D or C, proposed)* the runtime also reports the stack's rendered rect through play-shell's `reportShownStack("note.toasts", rect \| null)` ([FR-SHELL-59](play-shell.md#6-functional-requirements)). | sim-9 b01 |
| FR-NOTE-44 | **Never over a pushed window's first row** (sprint 7, sim-10 b05; amends FR-NOTE-42's "least window body"): outcome: with any map tool's bar shown and windows pushed by it (FR-SHELL-55), no DM toast covers the **title bar or the first 40 px of the body** of a rendered window. Means (rulings-b #3: this rule alone carries b05): in `dmStackPlacement` (`keep-out.ts`), a rendered window whose `data-placed` is `pushed` counts like Initiative (FR-NOTE-32: not clear), so the stack shifts within its band or drops below that window's **title bar + 40 px** of body before it takes "the least window body". Players unchanged. Outcome check (b05 repro): `elementFromPoint` at the centre of Scenes' first row hits the row. | sim-10 b05 |
| FR-NOTE-45 | **The summary counts what waits for players** (sprint 7, BL-48: "1 pending action" toast while Initiative lists Pending (2); amends FR-NOTE-15's text, DM only): the DM's summary toast reads "N pending action(s)" for the DM's own as today and, when the started encounter also has pending notifications whose action owner is a player (the rows Initiative lists as "Waiting for …", FR-CBT-79), appends " · M waiting for players" (M ≥ 1; "1 waiting for a player"). With **N = 0 and M ≥ 1** the summary reads the waiting part alone ("1 waiting for a player", "2 waiting for players"), same "Open" action. So N + M = Initiative's "Pending (n)" for combat cards. Players: unchanged. `note-toast-pending-summary` gains `data-waiting` = M. | BL-48 |
| **Sprint 7** (track ST, [stats](stats.md)) | | |
| FR-NOTE-48 | **Kind `stats-awards`** (owner stats; one line in `kinds.ts`, append). Audience `all`, no action, so state `info`: a 6 s toast per FR-NOTE-13 / -14 plus a history row. Payload zod `{fromN, toN, from, to, label}` (`label` ≤ 40 chars, e.g. "Tue 20 Oct"); text "Session awards: ‹label›". Both are player-safe: times and a date only. Made only by `stats.showAwards` through `notify` (FR-NOTE-02). Client views (both `notification-views.ts`, append): icon lucide `Trophy`, and a renderer with an **Open** Button (`note-stats-awards-open`, client-only, not an action) calling `openStatsAwards(fromN)` ([FR-SHELL-94](play-shell.md#6-functional-requirements)). No `endRule` (awards outlive fights). | 575 B a row (measured) |
| FR-NOTE-49 | **Callout toasts are not notifications** ([FR-STATS-22](stats.md#6-functional-requirements)). The overkill toast (`stats-overkill-toast`) is a shadcn Toast in this client's toast region: players bottom-right, DM top-centre band, under FR-NOTE-42 / -43's placement. It makes no row and doesn't count in the bell or appear in history. It is a transient **info** toast, not a card toast (seam S6): it uses the existing info-toast stack, never pushes windows, and Fit ([OQ-MAP-61](scenes-map.md#15-open-questions)) and the pending-toast rules ignore it. Only one shows at a time (a new callout replaces it). It starts from a live event frame only (`useEventFrame`), like FR-CBTX-06. *(Sprint 8: widened by FR-NOTE-69.)* | OQ-STATS-03 |
| FR-NOTE-50 | **One toast policy** (S8, WF; both clients): **one stack per client**: players bottom-right, the DM at the top-centre home band (FR-NOTE-42). **Classes**: **card** (pending, sticky), **alert** (6 s), **info** (6 s), **callout** (4 s, not a notification; **one at a time**, a new one replaces it). **Order** from home: the DM summary, cards, alerts, info, callout (players: then roll popups, FR-SHELL-49). **Max** 3 cards / alerts / info visible; more → "+N more" (`note-toast-more`, opens `note.history`); info overflows before cards. Callouts and popups don't count. Toasts are never windows. | #333 |
| FR-NOTE-51 | **The stack returns home** (BL-59). `ToastRuntime` re-places on every input change: window rects and `data-placed`, hard keep-outs, first-row reports (subscribed, not read once), stack height, viewport. The hover freeze lasts only while hovered. Root cause first (code read: `firstRows()` not reactive; `tick` frozen on hover; unreturned pushes). Outcome: the tool closes → windows return → the stack is home (560, 100 at 1440×900) within one frame. | BL-59 |
| FR-NOTE-52 | **Toast class for kinds** (S3–S5, S13): a `kinds.ts` entry names its class (pending → card, else info). Callouts use one shared `showCallout({id, content, ms?})`: the overkill toast (FR-NOTE-49) and SB's kill feed. TT `roll-request` = card; SB `stats-fight-summary` = info. | Seams |
| FR-NOTE-53 | **"Pushed" from the plan** (amends FR-NOTE-44): a window whose `data-placed` is `pushed`, or `displaced` with a `toolbar` cause. | FR-NOTE-44 |
| FR-NOTE-58 | *(Sprint 8)* **Kind `roll-request`** (owner DICEX; `kinds.ts` append; toast class card): audience `player` = the PC's owner, action "Roll" owned by that player. Payload `{requestId, characterId, characterName, roll, label, dc \| null, mode}` (≤ 1 KB; `dc` null unless shown); text "DM: ‹label› · ‹PC name›" (+ "· DC n" iff shown; the PC named so a player with two PCs can tell prompts apart, integrator, TT2). Resolution `{outcome: rolled \| declined \| missed, total?}`. `genericResolve: false` (`note.resolve` → `forbidden`); no end rule. Test `FR-NOTE-58 roll-request kind`. | ADR-0016 |
| FR-NOTE-59 | *(Sprint 8)* **Player view** (append): the prompt renderer ([FR-DICEX-83](dice-extras.md#6-functional-requirements): Roll roll-control + Decline) in the toast and the history row while pending; resolved rows read "Rolled 17" / "Declined" / "Closed". Test `FR-NOTE-59 prompt view`. | |
| FR-NOTE-60 | *(Sprint 8)* **`restoreToast`** (optional view flag; amends FR-NOTE-13, -15; in WF4's `ToastRuntime.tsx`, after WF4): after the first snapshot of a load or reconnect, each pending row of such a kind owned by this client re-toasts, **silent, no cue**, and is left out of the "N pending" summary. Only `roll-request` sets it. Test `FR-NOTE-60 restore toast`. | OQ-NOTE-34 |
| FR-NOTE-61 | *(Sprint 8)* **DM view** (append): history row "‹PC› · ‹label›" + "Open requests"; no DM toast, no action cue (`cueTokens: false`); the bell counts open prompts (FR-NOTE-27). Test `FR-NOTE-61 DM view`. | OQ-NOTE-33 |
| FR-NOTE-62 | *(Sprint 8)* **Closing**: answer / decline → resolved by the closer; DM Close → by rule ("Closed"); never dismissed by End. Test `FR-NOTE-62 prompt closes`. | |
| FR-NOTE-63 | *(Sprint 8)* **Paused** (seams S10): prompts and other card toasts arrive under the pause card and are restored at resume; info toasts go to history only; callouts are dropped, not replayed. Test `FR-NOTE-63 prompt while paused`. | |
| FR-NOTE-64 | *(Sprint 8)* **Leak rules**: no DC unless shown, never `success`; `resolution.total` only to the roller. Test `FR-NOTE-64 roll-request leak`. | |
| FR-NOTE-68 | **Kind `stats-fight-summary`** (owner stats; one line in `kinds.ts`, append). No action, so state `info`; its kind def names toast class **info** (FR-NOTE-50, seam S13): a 6 s toast per FR-NOTE-13 / -14 plus a history row. Audience **`all`** when the ended fight has a counted public fact, else **`dm`** ([FR-STATS-33](stats.md#6-functional-requirements)). Payload zod `{encounterId}` (player-safe: the id is already on public lines, #327); text **"Fight summary"** (no encounter name, no numbers). Made only by stats' `ended` rule hook through `notify` inside `cbt.end` (system actor: no stripe, FR-NOTE-38). Client views (both `notification-views.ts`, append): icon lucide `Swords`; renderer "Fight summary" + **Open** (`stats-summary-open`), which opens Stats on that fight with Highlights ([FR-STATS-34](stats.md#6-functional-requirements)); the DM's row adds the encounter name from its store. No end rule (an info row). | OQ-STATS-27 |
| FR-NOTE-69 | **Kill-feed toasts are not notifications** ([FR-STATS-28](stats.md#6-functional-requirements); amends FR-NOTE-49). `stats-feed-toast` takes the overkill toast's place in the **callout** toast class (FR-NOTE-50, seam S4): no row, bell or history, at most one (a newer one replaces it), live frames only, never pushes windows, ignored by Fit and the pending-toast rules. 4 s; the timer pauses on hover. Off with the viewer's "Kill feed" preference; dropped for players while paused (seam S10). | OQ-STATS-21 |
| **Sprint 9** (track FX, fix pack) | | |
| FR-NOTE-70 | **The stack never leaves its column** (BL-83, sim-12 FAIL c). Restores FR-NOTE-42 and removes walkthrough WF4's "beside a window over the home column".<br>• The DM stack's candidate lefts are its **home** (centred) and FR-NOTE-32's **left-of shift** for a window that counts like Initiative (Initiative; an open Notifications window, FR-NOTE-72), nothing else.<br>• The shift counts only if it leaves ≥ 12 px to the rail (left ≥ 80), so the stack is never at x 68 and never beside any other window.<br>• No spot in the column clears every window body → WF4's fold stays (the runtime shows fewer toasts, then "+N more"; alerts never fold, #336).<br>• The drawn rect is the computed one: `data-left` / `data-top`, the FR-SHELL-59 report and `getBoundingClientRect()` agree within 1 px.<br>• Outcome, sim-12 c01 (1280×720, Scenes at 400, 112): left 480.<br>• Outcome, sim-12 c03 (1440×900, Fog bar shown, Scenes pushed): left 560 or the shift, below the bar (FR-NOTE-43); never 68, never 276. | sim-12 c01, c03 |
| FR-NOTE-71 | **Nearest home, not the least body** (BL-75; amends FR-NOTE-42's "then the least window body").<br>• Of the clear spots (Initiative, title bars, hard keep-outs, FR-NOTE-44 strips), one that covers **no window body** wins, nearest the home row first.<br>• None does → the clear spot **nearest the home row** (smallest top), folded per FR-NOTE-70. It no longer slides down to a thin overlap at a low window's bottom edge.<br>• `avoidTokens` still ranks first among body-clear spots.<br>• Outcome (WF4 re-test: home band and both sides taken, Game log 1150×240 at the bottom): `elementFromPoint` at the centre of the Game log's Roll button hits it. | WF4 re-test |
| FR-NOTE-72 | **Cards fold into an open Notifications window** (BL-88, sim-12 glitch 7; amends FR-NOTE-13 / -15, both clients). The window lists the same rows with their actions, so while this client's `note.history` window is open and not minimised:<br>• The stack shows **no card toasts and no "N pending" summary**. Alerts, info and the callout still show.<br>• DM: the open window counts like Initiative (FR-NOTE-32: shift left of it if FR-NOTE-70 allows, else below it).<br>• Players: their stack keeps its corner; only the fold applies.<br>• The window closes or minimises → pending cards the user hadn't closed re-toast **silent, no cue** (like FR-NOTE-60), under the max of 3, and the summary comes back.<br>• Outcome (r03: Notifications at 592, 60 on the DM at 1440×900, Brakka's card pending): no toast overlaps the window, and `elementFromPoint` at its first row's Apply hits it. | sim-12 r03 |
| FR-NOTE-73 | **One callout node per show** (BL-84; amends FR-NOTE-50's "a new one replaces it").<br>• Each `showCallout` mounts a fresh `note-callout` element: React key and `data-callout-seq` = a page-wide show counter.<br>• So a replacement re-announces (`role=status`), restarts its 4 s, and a recorder that notes each node once still sees it.<br>• Outcome: two kill-feed callouts 1 s apart → two nodes, seq n and n + 1; the second shows the newer line. | sim-12 h |
| FR-NOTE-74 | **`updateNotification` can fold into the caller's event** (BL-63; protocol gate I15 already says that only `notify`, resolve and reopen emit their own event).<br>• Option `{emit: false}` returns the row's `RecordChange` instead of emitting `NotificationUpdated`. The caller puts it in its own event's `changes`.<br>• Default unchanged: every other caller still emits.<br>• Visibility, `seq` and unread are unchanged (an update never toasts or bumps unread, FR-NOTE-25).<br>• First user: `gem.spend` ([FR-GEM-42](gems.md#6-functional-requirements)). | BL-63 |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md): shadcn Toast (shell's toast region, [FR-SHELL-01](play-shell.md#6-functional-requirements): bottom-right for players, top-centre below the top bar for the DM so toasts clear the Initiative rows, #153), Badge, Button, ScrollArea, Separator; dark only; semantic tokens.

- **Screens:** toasts; `note.history` window (default bottom-right above the toast region, 360×480, min 280×240). Pending rows on top with accent border token; closed rows muted with state badge. A toast whose notification leaves `pending` disappears.
- **States:** empty "No notifications yet"; loading = shell skeleton; disconnected = last list + banner, action and Dismiss disabled; reject → FR-NOTE-20.
- **DM view:** toasts for info aimed at DM/all and every pending action the DM owns (damage cards). Window shows everything with audience tags; action on any pending row; Dismiss.
- **Player view:** toasts for info aimed at them or all and for pending actions they own. Window shows their own and `all` notifications, incl. their damage cards' state and resolution (#138); no Dismiss.
- **Sprint 2:** an updated pending row re-renders in place (no new toast). DM: pending rows owned by a player (audience tag "‹player›") count on the bell (FR-NOTE-27); rule-closed rows show a neutral "Closed" badge (FR-NOTE-28). Action cue: accent ring pulse + small bell above the token for 4 s, DM map only (FR-NOTE-30).
- **Test IDs** (AGENTS §9.5): `note-toast` + `data-record-id`, `note-toast-action`, `note-toast-close`, `note-toast-more`, `note-toast-pending-summary`, `note-history`, `note-history-row` + `data-record-id` + `data-state`, `note-history-action`, `note-history-dismiss`, `note-history-empty`, `note-launcher-badge`, *(sprint 2)* `note-history-closed` (the "Closed" badge); Konva `note-token-cue` (id = token id, attr `label`); test mode: `note-test-text`, `note-test-audience`, `note-test-owner`, `note-test-label`, `note-test-send`. *(Sprint 5)* `note-toast` and `note-history-row` gain `data-by` (player id \| `dm` \| absent) and `data-color` (the stripe's key, absent = none); the "Resolved by" name span `note-history-closed-by` (`data-color`); Konva `note-token-cue` gains attr `color`.
- *(Sprint 5, K)* *(OQ-NOTE-22, -24, decided #256)* A thin colour stripe on the left edge of each toast and history row: whose action raised it (a player's damage card in their colour, the DM's loot / handout in the DM colour). *(OQ-CAMP-27, cut list, decided #256)* "Resolved by **Player 1**" with the name in their colour; the DM's token cue ring in the action owner's colour. **DM view:** stripes on every row. **Player view:** stripes on the rows they receive.
- *(Sprint 6, WF)* **DM view:** the toast stack sits top-centre (its home, below the top bar) and only slides **down** to clear windows or a card's targets, or left of Initiative when they'd overlap; it never covers the active tool bar (Fog bar, AoE panel, structure / props panels). No new styling or test ID; walkthroughs read `note-toast` / `note-toast-pending-summary` rects. **Player view:** unchanged (bottom-right corner).

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
| | byRole, byPlayerId *(sprint 5)* | `dm` \| `player` \| null, ID → Player \| null | Who caused it: `notify` from `env.actor` (FR-NOTE-38); immutable; null on rows before sprint 5 |
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

- *(Sprint 5)* The `notification` record gains `byRole`, `byPlayerId` (FR-NOTE-38); same visibility rule, same events and payloads; no intent change (`note.testSend` gains no field: the stamp comes from the sender).
- Helpers emit their own event (protocol rule I15) via `env.emit`, after the kind owner's event. Each goes out as its own `event` frame, all before the sender's `ack` ([FR-SYNC-14](live-sync.md#6-functional-requirements)). No listeners, no signals.

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Create | via feature commands | via feature commands (e.g. own attack) | Kind owner's command; no generic create intent |
| See | all | audience `all` or self | FR-NOTE-06 |
| Resolve | any pending | if action owner (never damage cards: owner `dm`) | FR-NOTE-08/09 |
| Dismiss | any pending | no (close toast locally) | FR-NOTE-11 |
| Reopen | via kind owner (undo) | no | FR-NOTE-10 |
| *(Sprint 5)* Set `byRole` / `byPlayerId` | never (server stamps it) | never | Not in any helper argument or intent schema (FR-NOTE-38) |

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
- *(Sprint 5)* **Colours:** the stamp is part of the insert: it commits with the notification or not at all (crash-safe, nothing new to lose); disconnect → stripes keep their last colours; reconnect / restart → the snapshot brings rows and colours. A player sending `byPlayerId` in `note.testSend` → `invalid` (strict schema). The creator's colour changes → existing rows restripe (derived). A row created by one DM tab shows the DM colour in every tab.
- *(Sprint 6)* **Stack placement:** client-only; disconnect / reconnect / restart re-place the stack from what is on screen (the reconnect summary toast lands at the home, FR-NOTE-42); a tool bar shown after a reload re-reports and the stack re-places (FR-NOTE-43). A sticky stack taller than the band above the launcher → "+N more" as built. The DM moves Initiative onto the home band → the stack shifts left of it, and drops below a tool bar it would meet.
- *(Sprint 9)* **Notifications window open** (FR-NOTE-72): a reload or reconnect with it open keeps the cards folded (the window comes back from shell storage first). A card that resolves while folded never re-toasts. Window memory ([play-shell](play-shell.md), track PM) may leave any window on the home band: the stack still keeps to its column (FR-NOTE-70) and folds.
- **Invalid / malicious input:** players create only via feature commands and test mode; text per FR-NOTE-21, never HTML; frames > 64 KB closed by live-sync.
- **Sprint 8 (toast policy):** snapshots never toast, so the policy covers live frames only; a reconnect snapshot re-places the stack like any input change (also after a server crash). Reload: the stack starts home; callouts are transient. A burst: info overflows first, callouts replace each other.

## 12. Performance & bandwidth

- ~50–150 notifications per evening (one per player attack). Record ~300 B typical, ≤ ~1.9 KB max (text + 1 KB payload + 256 B resolution).
- Snapshot: pending + 100 → typical ≤ 40 KB, worst ~190 KB plus pending. Pending > 100 → server warning. Budget line for the protocol table (I17).
- One `event` frame per create, resolve, dismiss, reopen. Nothing on the token-move hot path.
- *(Sprint 5, measured by spec-colours 2026-10-18 on the realistic-heavy harness, [CAMP §12](campaign-management.md#12-performance--bandwidth))* `byRole` + `byPlayerId` with **every** row caused by a player (worst case): **+8,400 B** on the DM snapshot (120 rows: 100 + 20 pending), **+7,210–7,280 B** per player (103–104 rows); ≈ +70 B per `notification` upsert. With CAMP's colour fields: DM ≈ 680.9 KB of 1.5 MiB (#256), players ≤ 289.6 KB of 512 KiB. A `byPlayerId`-only variant (null = DM) measured +6,240 B DM, but can't tell the DM from a system row (OQ-NOTE-22).
- *(Sprint 8, SB; measured 2026-10-21, [stats §12](stats.md#12-performance--bandwidth))* A `stats-fight-summary` row is 536 B. It lives inside the 100-closed window: adding one measured −202 B on the heavy snapshot (it displaced a larger row), so the snapshot doesn't grow with fights. One `NotificationCreated` frame per End. Feed toasts: 0 B (client only).
- *(Sprint 6, WF)* **CON-44: 0 B** (stack placement is client-only; no record, field or frame). `dmStackPlacement` gets fewer candidates (2 lefts instead of 3 + 2 per window + 2 per token), one more overlap test per hard region (≤ 1 tool bar).

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
| Integration (sprint 5) | `FR-NOTE-38 notify stamps by` (a test command as DM → `byRole dm`, `byPlayerId` null; as `player-1` → `player` / their id; as system → null / null; `updateNotification`, resolve, dismiss, reopen keep it; `note.testSend` from a player stamps them; `note.testSend {byPlayerId}` → `invalid`). `FR-NOTE-38 visibility` (`player-1` / `player-2` frames: the stamp only on rows they may see; DM all; no row hidden from a player becomes visible) | `player-colours` |
| Unit (sprint 5, client) | `FR-NOTE-39 accent stripe` (toast + row: `player-1`'s row → jade stripe `data-color="jade"`; DM's → amber; `byRole` null → none; pending border kept). `FR-NOTE-40 names and cue` ("Resolved by Player 1" name span in their colour; "Closed" unchanged; the cue decoration's `color` = the action owner's). `FR-NOTE-41 old rows` (null stamp → no stripe; unknown player → none; a `player` upsert restripes) | In-code |
| Integration (sprint 5, K0) | `FR-NOTE-38 system actor` (a test command run as the system actor: `notify` → `byRole` / `byPlayerId` null; `resolveNotification` → `closedByRole` / `closedByPlayerId` null, badge "Closed") | In-code |
| Unit (sprint 6, `keep-out.test.ts`, pure) | `FR-NOTE-42 stack stays home`: the sim-9 a01 input (1440×900; Initiative 1028, 60; Compendium 164, 172; Party 576, 60 440 × 512; summary stack 320 × 57; Dragon box at the top-left) → left = 560 (home) or the left-of-Initiative shift, never 68; the stack moves down below Party's title bar / body instead of sideways; FR-NOTE-32's cases unchanged (shift left of Initiative, below it when no room); `avoidTokens` still ranks target-token cover first; every candidate left ∈ {home, shift} at the four sizes. `FR-NOTE-43 never over a tool bar`: a hard region at the fog bar's wrapped rect (62, 56, 472 × 92 at 1440×900) + Initiative moved to x 600 → the shifted stack drops below the bar (top = bar bottom + 8), no overlap; the sim-9 b01 input (Scenes pushed to 546, Fog tool) → no overlap; a keep-out change re-places (the runtime test: `ToastRuntime` with a stubbed `useKeepOuts` → new spot on change); players unaffected | In-code |
| E2E (sprint 6) | In play-shell's `window-fixes.e2e.ts` (`session-sim-9`): DM with the "1 pending action" summary showing, Scenes open, Fog tool → every fog control's centre hits itself (`elementFromPoint`) | `session-sim-9` |

**Browser walkthrough** — `PP_TEST_MODE=1`; `bun run build`; `fixtures:reset-load notifications --profile verify`; `start --profile verify` in the test agent's pane; evidence per [AGENTS §9.6](../../AGENTS.md#96-browser-verification-test-agents). Contexts **A** DM, **B** `player-1`, **C** `player-2`, **D** DM second tab. Changes show ≤ 1 s.

| # | DM | Players | Expected |
|---|---|---|---|
| 1 | A logs in, opens Notifications | — | Summary toast "1 pending action". Pending: `pending-dm`, `pending-p1`; History: 5 rows with audience tags. No per-item toasts. *(Sprint 2)* The window is 360×480 at 1440×900 (FR-NOTE-31) |
| 2 | — | B, C open links, open Notifications | B: summary "1 pending action"; 4 rows, `pending-p1` with Done. C: no summary; 2 rows. No `SECRET-NOTE` in B or C |
| 3 | A sends info to All "Torches gutter" | — | Toast in A, B, C; hides after ~6 s; History row in all three |
| 4 | A sends pending to Player 1, owner Player 1, "Done", "Roll DEX save" | — | B: sticky toast with Done. C: nothing. A: no toast; row Pending "Player 1"; *(sprint 2)* A closes (or minimises) Notifications after sending: A's bell badge +1 (FR-NOTE-27; while the window is shown, FR-NOTE-18 marks rows seen), back after step 5 |
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

**Sprint 5 walkthrough:** [CAMP §13](campaign-management.md#13-test-plan) K7 (a player's test card striped in their colour on the DM's toast and row; "Resolved by DM" name in the DM colour; the DM's info to Player 2 striped amber), K10 (DM colour change restripes), K12 (reload, crash: stripes unchanged).

**Sprint 6 walkthrough:** [play-shell §13](play-shell.md#13-test-plan) F0 (summary toast at its home after Reset layout), F5 (Fog / AoE / Structure bars fully reachable with the summary showing, at 1440×900 and 1280×720; the stack never at x 68), F6 (Initiative moved to x 600: the stack shifts left and clears the tool bar), F13 (reload, crash). Bundle `session-sim-9` (its "late-hit-ruled" card gives the DM's summary toast); no new fixture.

**Sprint 7 (track FU):** bundle `fu-s7` (session-sim-10's "1 pending action" toast + Mira's late-hit card); walkthrough U4, U17 in [play-shell §13](play-shell.md#13-test-plan). Unit (`keep-out.test.ts`): `FR-NOTE-44 toast clear of a pushed window` (1440×900: Scenes `pushed` at 546, 60 in the band, Initiative at 1028 → the stack never overlaps Scenes' title bar or first 40 px; with no room in the band it drops below that strip). Client (`logic.test.ts`): `FR-NOTE-45 summary counts waiting` (DM with 1 own pending card + 1 player-owned concentration save in the started encounter → "1 pending action · 1 waiting for a player", `data-waiting="1"`; none waiting → today's text; 0 own + 1 waiting → "1 waiting for a player" alone; players unchanged). Edge cases: the summary is computed at load / reconnect from the store (FR-NOTE-15), so a reconnect recounts; disconnect and crash: unchanged. CON-44: 0 B.

**Sprint 8 (track WF):** `FR-NOTE-50 toast policy` (order, max 3, info before cards, one callout); `FR-NOTE-51 stack returns home (BL-59)` (pure + `ToastRuntime` DOM: bar gone and windows returned → home within one frame; hover released; a first-row change re-places); `FR-NOTE-52 toast classes`; `FR-NOTE-53 stack reads the plan`. Walkthrough F8, bundle `wf-frame`.

**Sprint 9 (track FX, fix pack).** Tests:
- **Unit, `keep-out.test.ts` (pure).**
  - `FR-NOTE-70 stack never leaves its column`:
    - sim-12 c01 input (1280×720; Game log + Initiative as in a01; Scenes at 400, 112; Mira's box) → left 480.
    - c03 input (1440×900; Fog bar rect; Scenes `pushed`) → left 560 or the shift, top below the bar.
    - Property, 500 seeded random window sets at the four sizes → every left ∈ {home, shift ≥ 80}.
    - WF4's "home band" cases rewritten: no body-clear spot → `covers` > 0 at home, never beside.
  - `FR-NOTE-71 nearest home, not the least body`: the WF4 re-test input (Notifications left of home, Initiative right, Game log at the bottom) → the chosen top is the smallest clear one, and the Game log's bottom 48 px are not under the stack.
- **Client DOM, `toast-runtime.test.tsx`.**
  - `FR-NOTE-70`: `data-left` / `data-top` = the style = the FR-SHELL-59 report.
  - `FR-NOTE-72 cards fold into an open Notifications window`:
    - Open `note.history` → card and summary toasts gone; an alert and the callout stay.
    - Minimise or close it → the card is back, no cue, no sound; a card the user closed stays closed.
    - DM: the stack's rect is clear of the window's rect.
  - `FR-NOTE-73 callout node per show`: two `showCallout` 1 s apart → two node identities, `data-callout-seq` n and n + 1.
- **Integration, `helpers.test.ts`.** `FR-NOTE-74 update folds into the caller's event`: `{emit: false}` returns one `notification` change and emits nothing; the default still emits `NotificationUpdated`; the player view of the change equals today's.
- **E2E (thin)**, `e2e/fx-toasts.e2e.ts`, bundle **`fx-toasts-e2e`** (alias of `session-sim-12`; the spec changes state):
  - DM 1280×720: drag Scenes to 400, 112 → `note-toasts` left 480.
  - Open Notifications at the home → no `note-toast` box intersects it.

**Walkthrough FX1** (test agent; bundle `session-sim-12`, profile `verify`, DM + `player-1` + `player-2`). Each sim-12 repro is re-checked at the same size; the toast recorder reads the content of `note-toasts` / `note-callout` / `stats-feed-line` every 50 ms, not "each node once".

| # | Do | Expect |
|---|---|---|
| 1 | DM 1280×720, Game log + Initiative open, 4 pending cards; drag Scenes to 400, 112 (c01) | Stack left 480 (never 68); `data-left` = drawn left; folds to fewer toasts + "+N more" if it would cover Scenes' body; no window put under it |
| 2 | DM 1440×900, Fog on, Scenes pushed (c03) | Stack at 560 or left of Initiative, below the Fog bar; 16 / 16 Fog controls hit-testable; never at 276, 218 |
| 3 | WF4 re-test layout: home band and both sides taken, Game log 1150×240 | Game log Roll button hit-testable; the stack sits nearest its home row |
| 4 | Notifications at the home (r03), Brakka's card pending | No card or summary toast; Apply hit-testable; Apply works. Close Notifications → the card toasts back silently, no cue |
| 5 | DM 1440×900: DM damage kills the hidden Wolf; then Thorn's card kills the hidden Elite (overkill 15) (h) | DM: "Wolf falls (hidden)", then "Overkill! Elite Goblin Warrior 2 falls, overkill 15 (hidden)", each within 1 s (screenshot), each a new `data-callout-seq`; players: none (leak scan clean) |
| 6 | DM in two tabs: switch the Stats fight picker fast in both (≥ 6 queries in 1 s) ([FR-STATS-69](stats.md#6-functional-requirements)) | No "Too many stats queries"; both tabs show the answer within 1.5 s |
| 7 | Players: End a fight in which only DM damage killed a monster (f09) ([FR-STATS-70](stats.md#6-functional-requirements)) | Players' summary shows the kill in Highlights and no "No damage yet this fight" |
| 8 | Stats on the fixture-started fight, after `fixtures:reset-load` ([FR-FIX-29](fixtures-adapters.md#6-functional-requirements), BL-69) | Label "Fight 3 · ‹load day›" (e.g. "Thu 22 Oct"); duration = minutes since the load, never thousands of hours |
| 9 | DM reload with Notifications open; then Probes → Drop | Cards still folded after the reload; the stack re-places at its home after the reconnect |

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md), [ADR-0027](../architecture/adr/0027-notification-creation.md), [ADR-0029](../architecture/adr/0029-windowed-record-types.md) | Concept, event log; in-transaction creation; windowed snapshot with `pin` | accepted |
| [live-sync](live-sync.md) | Record-type registry + `window`, visibility fn, test-mode signal, "drop connection" | complete; `window` is a shared change |
| [play-shell](play-shell.md) | Toast region, window registry; `badge?(store)` on window types | complete; badge is a shared change (OQ-NOTE-13) |
| [campaign-management](campaign-management.md) | Player names for "Resolved by ‹name›", campaign scope | complete |
| [combat-tracker](combat-tracker.md) | Kind `damage-card` (audience = rolling player, owner `dm`; resolution incl. damage applied, #138), DM `onAction`, `cbt.applyCard` → `resolveNotification`, undo → `reopenNotification` | in-review |
| [dice-roll-log](dice-roll-log.md) | None: game log and notifications stay separate (I6) | in-review |
| *(Sprint 5)* [campaign-management](campaign-management.md) (K) | `colorOf` + palette (FR-CAMP-28); the K0 schema batch; bundle `player-colours` | revised with this spec |
| *(Sprint 5)* [scenes-map](scenes-map.md) (K) | `cue.color?` on the token decoration (FR-MAP-72) for the cue ring | revised with this spec |
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

**Shared changes — sprint 5** (track K; full split [CAMP §14](campaign-management.md#sprint-5-build-split-track-k)):
- **K0** (*seams S1:* schema lane 2 after R0; merges after P0 → R0 → C5 core; grants per S15): ★ `src/server/db/` columns `notification.by_role`, `by_player_id` (nullable, no backfill); notifications-owned `helpers.ts` (`notify` stamps from `env.actor`), `@shared/notifications/schemas.ts` (`NotificationRecord` fields); `note.testSend` unchanged. Docs (assigned): data model (notification columns), protocol (record fields, CON-44 figure).
- **K4** (after K0; toast components **after W1**, which edits the same toast stack (`ToastRuntime.tsx`, `keep-out.ts`, FR-NOTE-32's retirement): seams S15 as amended by review-a #21, K ↔ W = these toast files, W1 first; ∥ K2, K3): notifications-owned client toast + history row components (stripe, `data-by`, `data-color`, the "Resolved by" name colour, OQ-CAMP-27). P's `handout-shared` kind gets the stamp for free; P needs nothing (seams S15). No other shared file with K4 beyond the append-only view registries, which K4 doesn't touch.
- *(Sprint 6, track WF; full split [play-shell §14](play-shell.md#14-dependencies))* **WF2** `fix/pending-toast-home` (FR-NOTE-42, -43): notifications-owned `keep-out.ts` (`dmStackPlacement` candidates and hard regions), `ToastRuntime.tsx` (`useKeepOuts("dm")`, re-place on keep-out change; under [OQ-MAP-57](scenes-map.md#15-open-questions) D or C also `reportShownStack`), `keep-out.test.ts`. Reads play-shell's existing `keep-outs.ts` (no frame edit); the reporter export comes from WF1 (stack on it with `--base`, or add that line after WF1 merges). Starts at once otherwise; no schema, event, record or visibility change. *(Settled by seams S10, S8)* WF2 owns `keep-out.ts` and `ToastRuntime.tsx` this sprint; CP3's one appended DM kind (`cbt-summon-concentration`) and PF0's type-only lines in `parts.tsx` / `HistoryWindow.tsx` touch other files; sound settings stay out of this spec. [dice-extras](dice-extras.md) FR-DICEX-55 does the same for the DM roll-popup stack (WF3's assigned line).
- **K3** (last canvas holder, seams S10; `cue.color?` contract change granted to K3, S15; OQ-CAMP-27 decided in): the cue ring colour through scenes-map's `cue.color?` (FR-MAP-72) and notifications' own `tokenOverlays` line passing the action owner's colour.

**Shared changes — sprint 7** (track ST): `src/server/features/notifications/kinds.ts` gets one `stats-awards` line (append, slice ST0). `src/client/{dm,player}/notification-views.ts` get one line each (append, slice ST2). Nothing else in this spec's code.

**Sprint 7 tests** (track ST, bundle `stats`): integration `FR-NOTE-48 awards notification` (DM-only command; the row goes to every player and the DM; payload schema has no DM data; history row with Open; info toast 6 s), client `FR-NOTE-49 callout toast is not a notification` (a live `cbt.attack` frame with `callout` → toast, no store row, bell count unchanged, goes in the info-toast stack, pushes no window, Fit ignores it; a snapshot holding the same line → no toast). Walkthrough [stats §13](stats.md#13-test-plan) steps 2 and 6.

**Shared changes — sprint 8** (track SB): `kinds.ts` gets one `stats-fight-summary` line (append, SB0); `notification-views.ts` ×2 one line each (append, SB1). Nothing else in this spec's code; the feed toast lives in `@ui/features/stats/`.

**Sprint 8 tests** (track SB, bundle `stats-b`):
- Integration `FR-NOTE-68 fight summary notification`: End with a public fact → audience `all`; hidden-only fight → `dm`; no fact → none. The payload schema has no DM data (leak scan). History row with Open; info toast 6 s; the row survives a reload and a hard kill.
- Client `FR-NOTE-69 feed toast is not a notification`: a live kill line → toast, no store row, bell unchanged, a newer one replaces it; a snapshot with the same line → none; preference off → none.
- Walkthrough [stats §13.1](stats.md#131-sprint-8-tier-b) steps 2, 6, 9, 10.

**Sprint 9 (track FX).** No schema and no new dependency.
- **FX1** `fix/fx-toasts-feed` (FR-NOTE-70–73, with [stats](stats.md#14-dependencies) FR-STATS-68–70). FX holds the toast runtime this sprint (sprint-9 hotspots); PM doesn't touch it.
  - Notifications-owned files: `keep-out.ts`, `ToastRuntime.tsx`, `toasts.ts` (callout seq), `stack-inputs.ts` (the `note.history` rect), their tests.
  - Shared files: none. It reads play-shell's `useShellState` (`windows`, `placed`, `memory`) and `useKeepOuts`, with no frame edit.
  - Order (seams S5, S6, S10): wave 3; FX1 builds and merges **after PM1** (`fix/window-memory`). Window memory may change `placed` / `memory`, which `stack-inputs.ts` reads. FX1 holds the toast runtime all sprint; SP3's `session-recap` kind only appends to `kinds.ts` and the views.
- **FX2** owns FR-NOTE-74: notifications-owned `src/server/features/notifications/helpers.ts` (the `emit` option) with [gems](gems.md#14-dependencies) FR-GEM-42.

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

**Sprint 5** (track K). Decided by the DM before the spec: the colour shows in notifications (BL-17). Every row below **decided at sprint-5 DM gate 1 (#256, 2026-10-19) as picked**; rejected options struck.

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-NOTE-22 | **Whose colour** marks a notification? | **Decided (#256): who caused it (`byRole` / `byPlayerId` stamped by `notify`).** Pick as proposed: A. Who caused it: `notify` stamps `byRole` + `byPlayerId` from the command's actor (a player's damage card or draft in their colour, the DM's loot / handout in the DM colour; +8.4 KB DM worst, +7.3 KB per player, measured; one schema batch with CAMP's K0). Rejected: ~~B. Who it's for: the audience or action-owner player, 0 B, no schema; but a DM-audience row a player caused (a draft card) gets no colour, and DM-made rows to a player show the receiver's colour~~, ~~C. Per kind: each view declares `accentOf(n)` from its payload: 0 B, but every kind owner writes a line and most payloads don't name the actor~~ | — · decided | combat-tracker, party-loot, party-board, character-sheet-full (their rows get stamped; no change asked) |
| OQ-NOTE-23 | Rows created before sprint 5 | **Decided (#256): no stripe.** Pick as proposed: A. No stripe (the actor isn't recorded; harmless). Rejected: ~~B. Infer from the kind (damage cards: the audience player): a per-kind backfill for a cosmetic stripe~~ | — · decided | — |
| OQ-NOTE-24 | Toast colour beyond the stripe | **Decided (#256): stripe only (3 px).** Pick as proposed: A. Stripe only (3 px): the toast stays shadcn-neutral, the UI sprint (BL-29) may restyle. Rejected: ~~B. Tinted toast background: louder, fights the pending accent border~~ | — · decided | play-shell (toast region unchanged) |

**Sprint 6** (track WF). Decided before the spec: the DM's toast never covers the Fog bar or the map's top-left (BL-40, #286).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-NOTE-25 | **How the DM's toast stack keeps off the tool bar and the map's top-left** (sim-9 b01, a01) | **Decided (#288): A** (the stack stays in its top-centre band; the tool bar blocks it). Options: **A. Move the toast: it stays in its top-centre band and slides down past windows (never to the left edge); hard keep-outs (the tool bar) block it like Initiative** (FR-NOTE-42, -43): predictable spot; may sit on a window body in the middle (e.g. Party at 576) more often than today. / B. Keep-out for the bar only: today's sideways search plus the bar as a blocker: fewer window-body overlaps, but the stack still wanders to the map's top-left (over the Dragon) when windows fill the middle. / C. Collapse: the summary becomes a one-line pill pinned at the home top (≈ 200 × 32), cards open from it: least footprint, one more click for the DM on every card | — · decided (#288) | FR-NOTE-42, -43, -32; play-shell §7 |

**Sprint 8** (track SB). Decided at DM gate 1 (#335): every bold pick accepted.

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| ~~OQ-NOTE-36~~ | Seam **WF**: the feed and summary toasts in WF's toast policy | **Resolved (integrator, sprint-8 seams / rulings)** (S4, S5): the feed is the **callout** class (FR-NOTE-50), the summary's toast is **info** class; no new region or keep-out | — | NOTE, SHELL, STATS |
| OQ-NOTE-37 | Summary: toast **and** the window opening? | **Decided (#335): A** · **A. Both** (as OQ-NOTE-28: the toast says why Stats opened; with the "open at End" preference off it is the only signal) · B. Window only (a per-kind "no toast" flag, new to the registry) | no (DM pick) | NOTE, STATS |

**Sprint 7** (track ST).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-NOTE-28 | Show awards: info toast **and** the window opening, or only the window? | **Decided (#315): A** · **A. Both** (FR-NOTE-13's rule unchanged; the toast says why the window opened) · B. Window only (a per-kind "no toast" flag, new to the registry) | — | NOTE, STATS |
| ~~OQ-NOTE-29~~ | SB seam: kill-feed toast class | **Resolved (integrator, sprint-8 seams / rulings)**: seams S4: callout (FR-NOTE-50), not a notification kind | — | FR-NOTE-50, -52 |

**Sprint 8** (track TT). Decided at DM gate 1 ([#335](../decisions-log.md)): every pick accepted.

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-NOTE-32 | Prompt shape | **Decided (#335): A.** Options: **A. Pending card toast with Roll + Decline (+ history row)**: the existing pattern / B. A centred dialog: unmissable, blocks the map | no (decided) | FR-NOTE-59 |
| OQ-NOTE-33 | A DM toast per answer? | **Decided (#335): A.** Options: **A. No: the Requests window updates, the bell counts** / B. Yes: six toasts for six PCs | no (decided) | FR-NOTE-61 |
| OQ-NOTE-34 | Re-show a prompt after reload? | **Decided (#335): A.** Options: **A. Yes, silent (`restoreToast`)** / B. Only the "N pending" summary | no (decided) | FR-NOTE-60 |

- *(Sprint 8)* Edges: [dice-extras §11](dice-extras.md#11-edge-cases--failure-modes). Slices: kind TT0; views, `restoreToast` TT1+TT2 (after WF4).

## 16. Out of scope

- *(Sprint 6)* Moving the DM's toasts out of the top-centre (decided #256, OQ-SHELL-32 C); the players' toast corner (unchanged).
- Concentration, duration and turn reminders; rule listeners → [combat-extras](combat-extras.md), ADR-0027 C.
- Roll requests → [dice-extras](dice-extras.md). Kill-feed toasts → [stats](stats.md) *(sprint 8: FR-NOTE-69, a toast, not a kind)*. `loot-received` → [party-loot](party-loot.md) (#146).
- [Gems](gems.md) (#140): modifying a pending damage card's dice is combat-tracker's command; if card text must change then, ~~a post-MVP `updateNotification` helper (pending only)~~ *(sprint 2: exists, FR-NOTE-25)*. No MVP change.
- Load older history, server read state, cross-browser seen marker.
