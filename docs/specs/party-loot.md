---
title: Party loot
prefix: LOOT
status: in-review
owner: spec-party-loot
wave: 3
---

# Party loot

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md).

## 1. Summary

- The DM gives the party a reward; every player sees it in a shared **party loot** log ([ADR-0014](../architecture/adr/0014-mvp-scope.md), vision step 4).
- A **loot entry** = free text plus optional coins (cp / sp / ep / gp / pp) (#146). A **party coin** total per denomination, derived from the entries, shows above the log (#146).
- The DM corrects a wrong entry by **editing** it; the edit is logged and marked "Edited" for everyone (#146).
- Smallest slice of the [party board](post-mvp/party-board.md). Tier S: DM adds and edits, all see, persisted, crash-safe.

## 2. Scope

- Record type `loot-entry` (campaign scope, windowed per [ADR-0029](../architecture/adr/0029-windowed-record-types.md)); derived record type `loot-total` (one per campaign, no table). Intents `loot.add`, `loot.edit` (DM only); no REST.
- Spending: signed coin amounts, so the total is the party's purse *(pick; OQ-LOOT-10 open)*.
- Notification kind `loot-received` (info to all), created in the add's transaction ([ADR-0027](../architecture/adr/0027-notification-creation.md); #146 answers [OQ-NOTE-08](notifications.md#15-open-questions)).
- Window `loot.log` "Party loot", both clients ([OQ-SHELL-06](play-shell.md#15-open-questions)). Fixtures + bundle `party-loot`.

## 3. Goals

- The DM awards loot in one short form, mid-session, in under 10 s; fixes a typo in under 10 s.
- Connected players see a new entry, an edit and the new total ≤ 1 s after commit, with a toast for new entries; an offline player sees all of it on rejoin.
- The total is always exactly the sum of all the campaign's entries, including entries older than the window.
- Crash-safe: an add or edit commits with its event-log row (and notification) or not at all.
- The shape grows into a gold ledger and party inventory (tier A) without rework.

## 4. Non-goals

- Party inventory, transfer to characters, handouts, gold split (→ [party-board](post-mvp/party-board.md)); per-character currency (→ [character-sheet-full](post-mvp/character-sheet-full.md)); gems (→ [gems](post-mvp/gems.md), OQ-LOOT-08).
- Hidden / pre-staged loot, deleting entries, edit history in the UI (OQ-LOOT-11), coin conversion / making change, player-added entries (OQ-LOOT-03), load older.
- Loot lines in the game log (separate windows, as notifications I6). Undo is combat-only ([ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)); edit is the correction.

## 5. User stories

**DM**
- As the DM, I want to type "Goblin chief's pouch" + 50 gp after the fight and press Enter, so the party has a record without Miro.
- As the DM, I want to fix an entry I got wrong (500 gp → 50 gp), so the log and the total are right.
- As the DM, I want to record "Paid the ferryman −2 gp", so the party coin shows what the party actually holds.

**Player**
- As a player, I want a toast and a log I can reopen, so I know what the party got without asking — including while I was dropped.
- As a player, I want to see the party's coin at a glance, so we can plan purchases.

## 6. Functional requirements

`env` = `CommandEnv`; campaign from `env.actor.campaignId`; IDs and time from `env.ctx` ([ADR-0022](../architecture/adr/0022-deterministic-seams.md)). "Coins" = the five fields `cp, sp, ep, gp, pp`.

| ID | Requirement | Notes |
|---|---|---|
| FR-LOOT-01 | Record type `loot-entry`, scope `campaign`, fields per §8. Persisted. Ordered by row `seq` (DB insertion order, CON-20). | ADR-0006 |
| FR-LOOT-02 | Entry input (strict zod, shared by add and edit): `text` trimmed, control chars removed, 0–200 chars; each coin an integer −999 999…999 999, default 0. Needs non-empty `text` **or** a non-zero coin, else `invalid`. | #146 (01); sign per OQ-LOOT-10 |
| FR-LOOT-03 | `loot.add {text?, cp?, sp?, ep?, gp?, pp?}` (DM). Runs as internal helper `partyLoot.add(env, input) → {entryId}` **in the caller's transaction**: insert row, check FR-LOOT-06, emit `LootAdded` (changes: entry + `loot-total`), then `notify` `loot-received` (FR-LOOT-11). Any failure rolls back all of it. Result `{entryId}`. Later features (gems, party-board) may call the helper. | ADR-0027, protocol I15 order |
| FR-LOOT-04 | `loot.edit {entryId, text, cp, sp, ep, gp, pp}` (DM): full replacement, FR-LOOT-02 rules. Entry not in the campaign → `not_found`. Same values as stored → `ack`, no write, no event. Else update, set `editedAt`, check FR-LOOT-06, emit `LootEdited {entryId, before, after}` (changes: entry + `loot-total`). No notification. Logged in the event log. | #146 (02) |
| FR-LOOT-05 | A player sending `loot.add` or `loot.edit` → `forbidden` (role check); no change, no event. No delete or void command exists. | ADR-0004 |
| FR-LOOT-06 | After an add or edit, every denomination of the campaign total must be ≥ 0, else `conflict` "The party has only ‹n› ‹coin›" and the command writes nothing. | OQ-LOOT-10 pick |
| FR-LOOT-07 | Derived record type `loot-total`, scope `campaign`, `id` = campaign id: `{id, campaignId, cp, sp, ep, gp, pp}` = per-denomination `SUM` over **all** the campaign's entries. Not stored: the snapshot provider and `partyLoot.total(env)` run the same query. Never windowed. Every add or edit lists a `loot-total` upsert (before / after) in its event. | #146 (05); §8 why |
| FR-LOOT-08 | Visibility `loot-entry` and `loot-total`: DM **full**; player **full** for its own campaign (scope gate). No DM-only field exists. | [ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md) |
| FR-LOOT-09 | `loot-entry` snapshot per ADR-0029: `window {orderBy: seq, size: 100}`, no pin; cut before the filter. An edit below the floor is delivered live; a fresh snapshot omits that row (the total still counts it). | #137 |
| FR-LOOT-10 | Pure fns in `@shared/party-loot`: `formatCoins(coins)` = non-zero coins in order pp, gp, ep, sp, cp, negatives with "−", e.g. "50 gp, 30 sp", "−2 gp"; all zero → "". `gpValue(coins)` = pp×10 + gp + ep/2 + sp/10 + cp/100, shown to 2 decimals. | |
| FR-LOOT-11 | Notification kind `loot-received` (server kind registry): owner LOOT, audience `all`, no action (state `info`), payload `{entryId}`, no resolution, `genericResolve` false. Text from the values at add time: "Party loot: ‹text› (‹coins›)", "Party loot: ‹text›" or "Party loot: ‹coins›"; over 280 chars → cut to 279 + "…". Toasts per [FR-NOTE-13/14](notifications.md#6-functional-requirements) (event frames only; DM included). Edits create no notification and leave the existing one unchanged. | #146 (06) |
| FR-LOOT-12 | Client notification view `loot-received` (both clients): coins icon; renderer = generic row plus an "Open" link that opens `loot.log` via `useOpenWindow`. No `onAction`. | [FR-NOTE-19](notifications.md#6-functional-requirements) |
| FR-LOOT-13 | Window `loot.log` "Party loot", both clients, closed by default, `center` 400×480, min 300×260, launcher "Loot". Top: **Party coin** strip = one Badge per non-zero denomination of `loot-total` (pp → cp), Tooltip "≈ ‹gpValue› gp"; all zero → "No coin yet". Below: list newest first; row = text, coin Badges (FR-LOOT-10), time (local hh:mm, Tooltip full date); edited rows add an "Edited" Badge (Tooltip edit time), both clients. Changes show ≤ 1 s after commit. | [FR-SHELL-07](play-shell.md#6-functional-requirements) |
| FR-LOOT-14 | DM add form under the strip: text Input, five coin Inputs (pp, gp, ep, sp, cp; a leading "-" allowed), "Add" Button; Enter submits. Add is disabled while invalid (FR-LOOT-02 mirrored client-side), while not `live` and while its intent is in flight. `ack` → form clears; `reject` → inline message, values kept. Intent lost to a disconnect (never resent, [FR-SYNC-05](live-sync.md#6-functional-requirements)) → Toast "Connection lost — check the loot log before adding again". | Same pattern as FR-CHAR-12 |
| FR-LOOT-15 | DM "Edit" on each row → the row becomes the same inputs, prefilled, with "Save" / "Cancel"; Enter saves, Esc cancels; one row in edit at a time. Save disabled while invalid, unchanged, not `live` or in flight. `ack` → row returns to view; `reject` → inline message, values kept. Lost intent → Toast "Connection lost — check the entry before saving again". | |
| FR-LOOT-16 | Player `loot.log`: strip + list only; no form, no Edit. | |
| FR-LOOT-17 | Fixtures `loot-1`, `loot-second` and bundle `party-loot` (§13); `fixtures:reset-load party-loot` works from empty and is deterministic ([FR-FIX-08](fixtures-adapters.md#6-functional-requirements)). | ADR-0017 |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md): shadcn Input, Button, Badge, Tooltip, ScrollArea, Toast; dark only; semantic tokens (`text.muted` for "Edited" and negative amounts). No custom styling.

- **Screens:** `loot.log` (FR-LOOT-13); notifications' toasts and rows (FR-LOOT-11/12). **States:** empty "No loot yet" + "No coin yet"; loading = shell skeleton; disconnected = last strip and list + reconnect banner, form, Edit and Save disabled; reject = inline error under the form or the edited row.
- **DM view:** strip, add form, list with Edit per row. Sees own add as a toast (audience `all`; accepted).
- **Player view:** strip + list; toast per new entry; unread badge on the bell (notifications). Sees "Edited" and the new total; no toast for edits.
- **Test IDs** (AGENTS §9.5): `loot-log`, `loot-log-empty`, `loot-total`, `loot-total-coin` + `data-value=pp|gp|ep|sp|cp`, `loot-total-empty`, `loot-entry` + `data-record-id` + `data-edited`, `loot-entry-edit`, `loot-edit-save`, `loot-edit-cancel`, `loot-edit-error`, `loot-add-text`, `loot-add-coin` + `data-value`, `loot-add-submit`, `loot-add-error`, `loot-note-open` (the "Open" link). Edit inputs reuse `loot-add-text` / `loot-add-coin` inside the row (scoped by `data-record-id`).

## 8. Data model

| Entity | Field | Type | Notes |
|---|---|---|---|
| Loot entry (`loot-entry`) | id, campaignId | ID, ID → Campaign | `env.ctx.ids`; `env.actor.campaignId` |
| | seq | int | DB insertion order (CON-20); order + window key |
| | text | text 0–200 | Plain text, rendered as text (never HTML) |
| | cp, sp, ep, gp, pp | int −999 999…999 999 each | Default 0; columns, not JSON (summed for the total) |
| | createdAt, editedAt | timestamp, timestamp \| null | `env.ctx.clock`; `editedAt` set by each changing edit |
| Party coin (`loot-total`) | id (= campaignId), campaignId, cp, sp, ep, gp, pp | derived, **not stored** | `SUM` per denomination over all the campaign's entries |

- **Relations:** campaign 1–n loot entry; campaign 1–1 loot total (derived). Notification payload holds `entryId` as a plain id (no FK). Creator is always the DM in MVP; the event log keeps the actor and each edit's before / after.
- **Derived:** `loot-total` (server); coin string, gp value (FR-LOOT-10), display order, notification text.
- **Why the total is derived, not stored:** one source of truth, so an edit can't leave the total out of step and a crash has nothing to repair; it counts entries older than the window, which a client can't sum (snapshot holds the newest 100 only); cost is one indexed `SUM` per add, edit and snapshot (≈ hundreds of rows per campaign). A stored counter would need the same in-transaction update from every future caller of `partyLoot.add` (gems, party-board).
- **Persisted runtime state:** entries; nothing in memory matters. Index (campaignId, seq).
- **Later (additive, no MVP column):** `addedByPlayerId` (OQ-LOOT-03), `itemEntityId` (OQ-LOOT-04).

## 9. API & events

**REST:** none.

**WS intents** (none optimistic)

| Intent | Who | Validation / ownership | Result |
|---|---|---|---|
| `loot.add {text?, cp?, sp?, ep?, gp?, pp?}` | DM | FR-LOOT-02; total ≥ 0 (`conflict`); player → `forbidden` | `{entryId}` |
| `loot.edit {entryId, text, cp, sp, ep, gp, pp}` | DM | FR-LOOT-02; in campaign (`not_found`); total ≥ 0 (`conflict`); player → `forbidden` | — |

**Record types:** `loot-entry` — scope `campaign`; DM full, player full (own campaign); provider = the campaign's entries, `window {orderBy: seq, size: 100}`. `loot-total` — scope `campaign`; DM full, player full (own campaign); provider = one computed row per campaign (zeros if no entries); no window (FR-LOOT-07–09).

**WS events (domain events; generic record changes; all logged; none undoable or transient)**

| Event | Emitted by | Payload | Changes | Visibility rule |
|---|---|---|---|---|
| `LootAdded` | `partyLoot.add` (`loot.add`) | `{entryId, text, cp, sp, ep, gp, pp}` | `loot-entry` upsert (before null); `loot-total` upsert | Record fns: DM + every player of the campaign |
| `NotificationCreated` | `notify` (after `LootAdded`) | per NOTE | `notification` upsert | FR-NOTE-06: audience `all` → everyone |
| `LootEdited` | `loot.edit` | `{entryId, before {text, cp, sp, ep, gp, pp}, after {…}}` | `loot-entry` upsert; `loot-total` upsert | Record fns: DM + every player of the campaign |

- Each event is its own `event` frame, all before the sender's `ack` ([FR-SYNC-14](live-sync.md#6-functional-requirements)). No listeners, no signals. **Internal API:** `partyLoot.add(env, input)` (FR-LOOT-03), `partyLoot.total(env)` (FR-LOOT-07); `formatCoins`, `gpValue` in `@shared/party-loot`.

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Add entry | ✓ | ✗ | role (`forbidden`); total ≥ 0 |
| Edit entry | ✓ | ✗ | role; campaign (`not_found`); total ≥ 0 |
| Read log and party coin | all | all of own campaign | FR-LOOT-08, scope gate |
| Delete / void | ✗ | ✗ | no command exists |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** snapshot restores the newest 100 entries and the full total (older entries not resent; no "load older" in MVP, ~10 sessions of loot); no per-item toasts; the bell's unread badge shows missed adds (FR-NOTE-18). Edits made while away show as "Edited".
- **DM disconnect / reconnect:** players unaffected. Form, Edit and Save disabled; in-flight intent lost → FR-LOOT-14/15 toast; the reconnect snapshot shows whether it committed. An open edit keeps its typed values. Campaign switch closes the DM connection (`4409`); the next snapshot shows only the new campaign's log and total.
- **Server crash mid-action:** row + event-log row (+ notification for add) commit together or not at all. The total is recomputed from entries, so it can't drift. After restart, snapshots equal pre-crash state.
- **Concurrent edits:** commands serialise. Double click → one intent (button locked in flight). Two DM tabs add the same loot → two entries (no dedupe; the DM edits one to "Duplicate", zero coins). Two tabs edit the same entry → last commit wins; both edits logged; the other tab's row updates live (an open edit form keeps its values). A spend and an edit racing for the same coins → the second fails FR-LOOT-06 `conflict`.
- **Invalid / malicious input:** empty text and all coins zero, fractional or out-of-range coins, text > 200, unknown or missing fields (edit) → `invalid`. Total below 0 → `conflict`. HTML / markdown in text rendered as plain text. Frames > 64 KB closed by live-sync. **Secrets typed into loot:** every entry is public by design; editing removes the text from the record but the event log keeps the before value. Accepted (trusted table); DM-only notes belong elsewhere.

## 12. Performance & bandwidth

- ~5–15 entries per session; human-paced. Entry ≈ 250 B on the wire, ≤ ~400 B max; `loot-total` ≈ 120 B. Snapshot: ≤ 100 × 400 B + 120 B ≈ 40 KB worst, same for DM and players. Fits CON-44 ceilings (DM worst ≈ 680 + 40 KB < 768 KB; players < 512 KB). Budget lines for the protocol per-type table. Per add: two `event` frames (`LootAdded` with two changes, `NotificationCreated`); per edit: one; × ≤ 7 connections. `SUM` over the (campaignId) index per add / edit / snapshot: sub-ms at expected sizes. Nothing on the token-move hot path.

## 13. Test plan

Isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)); loop per [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md); `bun test` on `:memory:`, port 0; tests named after FRs.

**Fixtures** (`fixtures/units/party-loot/`, setups run as DM via `loot.add` / `loot.edit`, FR-FIX-13; fixed clock)

| Key | Requires | Contents | In `session-sim` |
|---|---|---|---|
| `loot-1` | `campaign` | e1 "Goblin chief's pouch" 12 gp 30 sp; e2 "Potion of healing ×2"; e3 "Silver idol" 500 gp, then **edited** to 50 gp; e4 coins only 5 pp; e5 "Paid the ferryman" −2 gp. Total: 5 pp, 60 gp, 30 sp | no (the demo awards loot live) |
| `loot-second` | `campaign-second` | Activate Second Campaign; add "SECOND-CAMPAIGN-LOOT" 1 gp; re-activate Fixture Campaign | no |

- **Bundle `party-loot`** = `base` + `player-2` + `campaign-second` + `loot-1` + `loot-second`.

| Level | What | Fixtures |
|---|---|---|
| Unit | zod: text trim / control chars / 200, coin bounds and sign, "text or non-zero coin" rule, strict fields, edit needs all fields. `formatCoins` order, zeros, "−". `gpValue`. Notification text variants + 280 cut. Visibility fns (DM / player full, both types). Client: newest-first order, "Edited" Badge, strip from `loot-total`, form validity mirror, Add / Save locked while not `live`, in flight or unchanged, lost-intent toasts | In-code |
| Integration | `loot.add`: row + log row + `LootAdded` (entry + total changes) then `NotificationCreated`, both before `ack`; `notify` forced to throw → no row, event, log entry or notification. `loot.edit`: one `LootEdited` with before / after, log row, total updated, no notification; unchanged → `ack`, no event; Second Campaign's entry → `not_found`. Player `loot.add` / `loot.edit` → `forbidden`. Invalid inputs → `invalid`; spend beyond total (add or edit) → `conflict`, nothing written. Total = sum of all entries incl. below the window (105 entries). Window: newest 100, edit below the floor delivered live; convergence per ADR-0029 helper incl. `loot-total`. Scope leak scan: "SECOND-CAMPAIGN-LOOT" and its 1 gp never in a Fixture Campaign frame. Restart on same DB → identical snapshots. Determinism: two loads → identical IDs | `party-loot` |
| E2E (thin) | DM adds "50 gp" → `player-1` sees the row, the toast and party coin +50 gp | `party-loot` |

**Browser walkthrough** — `PP_TEST_MODE=1` (for "drop connection"); `bun run build`; `fixtures:reset-load party-loot --profile verify`; `start --profile verify` in the test agent's pane; evidence per [AGENTS §9.6](../../AGENTS.md#96-browser-verification-test-agents). Contexts (Playwright MCP) **A** DM (`pw-dm`), **B** `player-1` (`pw-player-1`), **C** `player-2` (`pw-player-2`). Changes show ≤ 1 s.

| # | DM (A) | Players (B, C) | Expected |
|---|---|---|---|
| 1 | Log in, open Loot | — | Strip 5 pp, 60 gp, 30 sp; rows e5, e4, e3, e2, e1 newest first; e3 shows 50 gp + "Edited"; no per-item toasts |
| 2 | — | B, C open links, open Loot | Same strip and rows, no form, no Edit; no "SECOND-CAMPAIGN-LOOT" in DOM or frames |
| 3 | Add "Silver dagger" + 50 gp, Enter | — | Row on top in A, B, C; strip 110 gp; toast "Party loot: Silver dagger (50 gp)" in all three; row in `note.history` |
| 4 | — | B closes Loot, opens Notifications, clicks "Open" on the loot row | `loot.log` opens |
| 5 | Try Add with empty text and no coins; then 1.5 gp | — | Add disabled / inline error; no entry anywhere |
| 6 | Edit "Silver dagger" to 5 gp, Save | — | Row shows 5 gp + "Edited" in A, B, C; strip 65 gp; no toast; no new `note.history` row |
| 7 | Add "Bribe" −100 gp | — | Inline error "The party has only 65 gp"; nothing changes anywhere |
| 8 | Add "Ruby" while C is dropped | C: "drop connection" (Probes window) | C: banner, then "Ruby" without reload; no per-item toast; bell badge ≥ 1 |
| 9 | Hard-kill + restart server | — | All rejoin; rows and strip identical to step 8; no console errors |
| 10 | Switch to Second Campaign, then back | B, C wait, then rejoin | A: only "SECOND-CAMPAIGN-LOOT", strip 1 gp; then the Fixture Campaign list and strip again; B, C unchanged |

Teardown: stop the server, `fixtures:reset --profile verify`.

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [live-sync](live-sync.md), [protocol](../protocol/README.md) | Record-type registry with `window` (ADR-0029) and computed providers (as `presence`), scope gate, intents, test-mode "drop connection" | complete; `window` built by `fix/combat-core` |
| [notifications](notifications.md) | `notify`, server kind registry, client view registries, toasts, `note.history` | complete |
| [play-shell](play-shell.md), [campaign-management](campaign-management.md), [fixtures-adapters](fixtures-adapters.md) | Window registry, `useOpenWindow` (confirms `loot.log`, both, for OQ-SHELL-06); campaign scope + switch; `base`, `player-2`, `campaign-second`, bundle registry | complete |

**Shared changes needed** (AGENTS §9.9; orchestrator routes)
- `src/server/db/` — table `loot_entry`, index (campaignId, seq). `src/shared/events/party-loot.ts` — `LootAdded`, `LootEdited`.
- Append-only lines: `partyLoot` in `src/server/features/index.ts`; record types `loot-entry` (with window) and `loot-total`; `loot-received` in `src/server/features/notifications/kinds.ts` and both `notification-views.ts`; `loot.log` in both `windows.ts`; `party-loot` in `fixtures/bundles/index.ts`.
- Docs at merge (integrator): protocol rows (types, intents, events, kind, window, budget), data-model rows, FIX §8 fixture rows, notifications OQ-NOTE-08 → decided by #146 (OQ-LOOT-12), glossary (OQ-LOOT-09).

## 15. Open questions

**Bold** option = suggested pick unless the row says Decided.

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| ~~OQ-LOOT-01~~ | ~~Entry shape~~ | **Decided (#146):** free text + optional coins cp / sp / ep / gp / pp (int columns; text or a coin required) | — | post-mvp/party-board |
| ~~OQ-LOOT-02~~ | ~~Correcting a wrong entry?~~ | **Decided (#146):** DM **edits** the entry; the edit is logged (`LootEdited` before / after) and marked "Edited"; no void | — | — |
| OQ-LOOT-03, 04 | 03: Can players add entries? 04: Reference an item entity? | 03: **No in MVP** (tier S = DM awards; later additive `addedByPlayerId`) / yes. 04: **No MVP column; nullable `itemEntityId` later** (additive migration, nothing to sync now) / reserve the column now | no · owner: spec-party-loot | post-mvp/party-board, post-mvp/world-builder |
| ~~OQ-LOOT-05~~ | ~~Running coin total?~~ | **Decided (#146):** yes, party coin tracker in MVP, total derived from entries. Spec pick: server-derived `loot-total`, not stored (§8 why) | — | post-mvp/party-board |
| ~~OQ-LOOT-06~~, OQ-LOOT-07 | ~~06: `loot-received` notification?~~ 07: `loot.log` open by default? | 06 **Decided (#146):** info, audience `all`, toast + history. 07: **Closed; toast + launcher open it** (canvas stays clear) / open for players | no · owner: spec-party-loot | notifications, play-shell |
| OQ-LOOT-08 | Gems (DM award, per character) and the loot log? | **Gems own their counters; a gem award may also log here by calling `partyLoot.add` in its command; no MVP field or UI** / gems as loot entries | no · owner: gems | post-mvp/gems |
| OQ-LOOT-09 | Glossary: add **Loot entry** ("one line of party loot: text + optional coins, added and edited by the DM") and **Party coin** ("the party's coin per denomination, derived from loot entries") | **Add both** / reuse "party loot" only | no · owner: integrator | glossary |
| OQ-LOOT-10 | Does the tracker record spending (#146 says "running currency tracker")? | **Yes: signed coins; a spend is an entry with negative coins; each denomination total stays ≥ 0 (`conflict`)** (total = party purse) / positive only (total = total awarded; spending not tracked until party-board) | no · owner: DM | post-mvp/party-board |
| OQ-LOOT-11 | Edit details: notify on edit? show what changed? delete? | **No notification; "Edited" Badge for all; before / after only in the event log; no delete (edit to "Duplicate", zero coins)** / info notification "Party loot corrected: …" / Tooltip with the previous values (needs a stored `previous`) / logged delete | no · owner: DM | notifications |
| OQ-LOOT-12 | [OQ-NOTE-08](notifications.md#15-open-questions) and notifications §2 still read "deferred to the Reward gate (#139 P28)"; so does [protocol §23](../protocol/README.md#23-combat-notification-kinds) | **Integrator marks OQ-NOTE-08 decided by #146 and adds the `loot-received` row at merge** / notifications spec revision | no · owner: integrator | notifications, protocol |

## 16. Out of scope

- See §4. Owners: [party-board](post-mvp/party-board.md) (inventory, ledger, split, handouts, notes), [character-sheet-full](post-mvp/character-sheet-full.md) (currency), [gems](post-mvp/gems.md); load older, edit history UI, item refs, player adds (OQ-LOOT-03, 04, 11).
