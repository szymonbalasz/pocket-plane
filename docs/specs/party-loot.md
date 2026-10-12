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
- A **loot entry** = free text plus optional coins *(proposed, OQ-LOOT-01)*. The point is a visible, persisted record that the party received something, not a ledger.
- Smallest slice of the [party board](post-mvp/party-board.md). Tier S only: DM adds, all see, persisted, crash-safe.

## 2. Scope

- Record type `loot-entry` (campaign scope, append-only, windowed per [ADR-0029](../architecture/adr/0029-windowed-record-types.md)); intents `loot.add`, `loot.void` (DM only); no REST.
- Notification kind `loot-received` (info to all; *proposed*), created in the add's transaction ([ADR-0027](../architecture/adr/0027-notification-creation.md); OQ-LOOT-06 pick for [OQ-NOTE-08](notifications.md#15-open-questions), Reward gate #139 P28).
- Window `loot.log` "Party loot", both clients ([OQ-SHELL-06](play-shell.md#15-open-questions)). Fixtures + bundle `party-loot`.

## 3. Goals

- The DM awards loot in one short form, mid-session, in under 10 s.
- Connected players see it ≤ 1 s after commit, with a toast; an offline player sees it on rejoin.
- Crash-safe: an entry commits with its event-log row and notification, or not at all.
- The shape grows into a gold ledger and party inventory (tier A) without rework.

## 4. Non-goals

- Party inventory, transfer to characters, handouts, gold split (→ [party-board](post-mvp/party-board.md)); per-character currency (→ [character-sheet-full](post-mvp/character-sheet-full.md)); gems (→ [gems](post-mvp/gems.md), OQ-LOOT-08).
- Running coin total (OQ-LOOT-05), hidden / pre-staged loot, editing or deleting entries, player-added entries (OQ-LOOT-03), load older.
- Loot lines in the game log (separate windows, as notifications I6). Undo is combat-only ([ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)); void is the correction.

## 5. User stories

**DM**
- As the DM, I want to type "Goblin chief's pouch" + 50 gp after the fight and press Enter, so the party has a record without Miro.
- As the DM, I want to void an entry I got wrong, so the log stays honest without rewriting history.

**Player**
- As a player, I want a toast and a log I can reopen, so I know what the party got without asking — including while I was dropped.

## 6. Functional requirements

`env` = `CommandEnv`; campaign from `env.actor.campaignId`; IDs and time from `env.ctx` ([ADR-0022](../architecture/adr/0022-deterministic-seams.md)).

| ID | Requirement | Notes |
|---|---|---|
| FR-LOOT-01 | Record type `loot-entry`, scope `campaign`, fields per §8. Persisted. Ordered by row `seq` (DB insertion order, CON-20). | ADR-0006 |
| FR-LOOT-02 | *(proposed, OQ-LOOT-01)* `loot.add {text?, cp?, sp?, ep?, gp?, pp?}` (DM; strict zod). `text`: trimmed, control chars removed, 0–200 chars. Each coin: integer 0–999 999, default 0. Needs non-empty `text` **or** a coin > 0, else `invalid`. Result `{entryId}`. | OQ-LOOT-01 pick |
| FR-LOOT-03 | Add runs as internal helper `partyLoot.add(env, input) → {entryId}` **in the caller's transaction**: insert row, emit `LootAdded`, then `notify` `loot-received` (FR-LOOT-09; *proposed, OQ-LOOT-06*). Validates `input` with the FR-LOOT-02 schema (else `invalid`). Any failure rolls back the whole command (no row, event, log entry or notification). | ADR-0027, protocol I15 order; reusable by gems (OQ-LOOT-08) |
| FR-LOOT-04 | *(proposed, OQ-LOOT-02)* `loot.void {entryId}` (DM): entry not in the campaign → `not_found`; already voided → `conflict`. Sets `voided = true`, `voidedAt`; emits `LootVoided`. No un-void, edit or delete command exists. | OQ-LOOT-02 pick |
| FR-LOOT-05 | A player sending `loot.add` or `loot.void` → `forbidden` (role check); no change, no event. | ADR-0004 |
| FR-LOOT-06 | Visibility `loot-entry`: DM **full**; player **full** for its own campaign (scope gate). No DM-only field exists. Voided entries stay visible to everyone. | [ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md) |
| FR-LOOT-07 | Snapshot per ADR-0029: `window {orderBy: seq, size: 100}`, no pin; cut before the filter. A void below the floor is delivered live; a fresh snapshot omits that row. | #137 |
| FR-LOOT-08 | *(proposed, OQ-LOOT-01)* `formatCoins(entry)` (pure, `@shared/party-loot`): non-zero coins in order pp, gp, ep, sp, cp as plain integers (no locale separators; same on server and clients), e.g. "50 gp, 30 sp"; all zero → "". | |
| FR-LOOT-09 | *(proposed, OQ-LOOT-06)* Notification kind `loot-received` (server kind registry): owner LOOT, audience `all`, no action (state `info`), payload `{entryId}`, no resolution, `genericResolve` false. Text: "Party loot: ‹text› (‹coins›)", "Party loot: ‹text›" or "Party loot: ‹coins›"; max 268 chars (200 text + 53 coins), within FR-NOTE-21's 280: no cut. A void leaves the notification's text unchanged; the loot log is the truth. Toasts per [FR-NOTE-13/14](notifications.md#6-functional-requirements) (event frames only; DM included). Void creates no notification. | OQ-LOOT-06 pick (OQ-NOTE-08) |
| FR-LOOT-10 | *(proposed, OQ-LOOT-06)* Client notification view `loot-received` (both clients): coins icon; renderer = generic row plus an "Open" link that opens `loot.log` via `useOpenWindow`. No `onAction`. | [FR-NOTE-19](notifications.md#6-functional-requirements) |
| FR-LOOT-11 | Window `loot.log` "Party loot", both clients, closed by default, `center` 380×440, min 300×240, launcher "Loot". List newest first; row = text, coin Badges (FR-LOOT-08), time (local hh:mm, Tooltip full date). Voided rows (OQ-LOOT-02): struck through + "Voided" Badge, both clients. Changes show ≤ 1 s after commit. | [FR-SHELL-07](play-shell.md#6-functional-requirements); OQ-LOOT-07 |
| FR-LOOT-12 | *(proposed, OQ-LOOT-01)* DM add form at the top of `loot.log`: text Input, five coin Inputs (pp, gp, ep, sp, cp), "Add" Button; Enter submits. Add is disabled while invalid (FR-LOOT-02's zod schema from `@shared/party-loot`), while not `live` and while its intent is in flight. `ack` → form clears; `reject` → inline message, values kept. Intent lost to a disconnect (never resent, [FR-SYNC-05](live-sync.md#6-functional-requirements)) → Toast "Connection lost — check the loot log before adding again". | Same pattern as FR-CHAR-12 |
| FR-LOOT-13 | *(proposed, OQ-LOOT-02)* DM "Void" on each non-voided row → AlertDialog "Void this entry? Everyone will see it struck through." → `loot.void`. Disabled while not `live` or in flight. `conflict` → Toast "Already voided"; other reject → Toast with its message. | |
| FR-LOOT-14 | Player `loot.log`: list only; no form, no Void. | |
| FR-LOOT-15 | Fixtures `loot-1`, `loot-second` and bundle `party-loot` (§13); `fixtures:reset-load party-loot` works from empty and is deterministic ([FR-FIX-08](fixtures-adapters.md#6-functional-requirements)). | ADR-0017 |

## 7. UI/UX notes

- Per [visual-direction](../design/visual-direction.md): shadcn Input, Button, Badge, Tooltip, AlertDialog, ScrollArea, Toast; dark only; semantic tokens (`text.muted` for voided rows). No custom styling.
- **Screens:** `loot.log` (FR-LOOT-11); notifications' toasts and rows (FR-LOOT-09/10). **States:** empty "No loot yet"; loading = shell skeleton; disconnected = last list + reconnect banner, form and Void disabled; reject = inline error under the form.
- **DM view:** form on top, list below, Void per row. Sees own add as a toast (audience `all`; accepted).
- **Player view:** list only; toast per new entry; unread badge on the bell (notifications).
- **Test IDs** (AGENTS §9.5): `loot-log`, `loot-log-empty`, `loot-entry` + `data-record-id` + `data-voided`, `loot-entry-void`, `loot-void-confirm`, `loot-add-text`, `loot-add-coin` + `data-value=pp|gp|ep|sp|cp`, `loot-add-submit`, `loot-add-error`, `loot-note-open` (the "Open" link).

## 8. Data model

| Entity | Field | Type | Notes |
|---|---|---|---|
| Loot entry (`loot-entry`) | id, campaignId | ID, ID → Campaign | `env.ctx.ids`; `env.actor.campaignId` |
| | seq | int | DB insertion order (CON-20); order + window key |
| | text | text 0–200 | Plain text, rendered as text (never HTML) |
| | cp, sp, ep, gp, pp | int 0–999 999 each | Default 0; columns, not JSON (summable later for a ledger) |
| | voided, voidedAt | bool, timestamp \| null | Set once by `loot.void` |
| | createdAt | timestamp | `env.ctx.clock` |

- **Relations:** campaign 1–n loot entry. Notification payload holds `entryId` as a plain id (no FK). Creator is always the DM in MVP; the event log keeps the actor.
- **Derived:** coin string (FR-LOOT-08), display order, notification text. **No** stored or derived total in MVP (OQ-LOOT-05).
- **Persisted runtime state:** entries incl. `voided`; nothing in memory matters. Index (campaignId, seq).
- **Later (additive, no MVP column):** `addedByPlayerId` (OQ-LOOT-03), `itemEntityId` (OQ-LOOT-04).

## 9. API & events

**WS intents** (no REST; none optimistic)

| Intent | Who | Validation / ownership | Result |
|---|---|---|---|
| `loot.add {text?, cp?, sp?, ep?, gp?, pp?}` | DM | FR-LOOT-02; player → `forbidden` | `{entryId}` |
| `loot.void {entryId}` | DM | In campaign (`not_found`); not voided (`conflict`); player → `forbidden` | — |

**Domain events** (generic record changes; all logged; none undoable or transient)

| Event | Emitted by | Payload | Changes | Visibility rule |
|---|---|---|---|---|
| `LootAdded` | `partyLoot.add` (`loot.add`) | `{entryId, text, cp, sp, ep, gp, pp}` | `loot-entry` upsert (before null) | Record fn: DM + every player of the campaign |
| `NotificationCreated` | `notify` (after `LootAdded`) | per NOTE | `notification` upsert | FR-NOTE-06: audience `all` → everyone |
| `LootVoided` | `loot.void` | `{entryId}` | `loot-entry` upsert | Record fn: everyone |

- **Record type** `loot-entry`: scope `campaign`; visibility DM full, player full (own campaign only); provider `window {orderBy: seq, size: 100}` (FR-LOOT-06/07).
- Each event is its own `event` frame, all before the sender's `ack` ([FR-SYNC-14](live-sync.md#6-functional-requirements)). No listeners, no signals. **Internal API:** `partyLoot.add(env, input)` (FR-LOOT-03); `formatCoins` in `@shared/party-loot`.

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Add entry | ✓ | ✗ | role (`forbidden`) |
| Void entry | ✓ | ✗ | role; campaign; not voided |
| Read log | all | all of own campaign | FR-LOOT-06, scope gate |
| Edit / delete / un-void | ✗ | ✗ | no command exists |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** snapshot restores the newest 100 entries (older not resent; no "load older" in MVP, ~10 sessions of loot); no per-item toasts; the bell's unread badge shows what was missed (FR-NOTE-18).
- **DM disconnect / reconnect:** players unaffected. Form and Void disabled; in-flight intent lost → FR-LOOT-12 toast; the reconnect snapshot shows whether it committed. Campaign switch closes the DM connection (`4409`); the next snapshot shows only the new campaign's log.
- **Server crash mid-action:** row + `LootAdded` log row + notification commit together or not at all; same for a void. After restart snapshots equal pre-crash state.
- **Concurrent edits:** commands serialise. Double click → one intent (button locked in flight). Two DM tabs add the same loot → two entries (no dedupe; DM voids one). Two tabs void the same entry → first wins, second `conflict`.
- **Invalid / malicious input:** empty text and no coins, negative, fractional or > 999 999 coins, text > 200, unknown fields → `invalid`. HTML / markdown in text rendered as plain text. Frames > 64 KB closed by live-sync. **Secrets typed into loot:** every entry is public by design; voiding doesn't hide it. Accepted (trusted table); DM-only notes belong elsewhere.

## 12. Performance & bandwidth

- ~5–15 entries per session; human-paced. Row ≈ 250 B on the wire, ≤ ~850 B max (text ≤ 600 B UTF-8). Snapshot `loot-entry`: typical ≈ 25 KB, ≤ 100 × 850 B ≈ 85 KB worst, same for DM and players. Fits CON-44 ceilings (DM 768 KB, players 512 KB). Budget line for the protocol per-type table. Per add: two `event` frames (`LootAdded`, `NotificationCreated`) × ≤ 7 connections. Nothing on the token-move hot path.

## 13. Test plan

Isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)); loop per [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md); `bun test` on `:memory:`, port 0; tests named after FRs.

**Fixtures** (`fixtures/units/party-loot/`, setups run as DM via `loot.add` / `loot.void`, FR-FIX-13; fixed clock). **Bundle `party-loot`** = `base` + `player-2` + `campaign-second` + `loot-1` + `loot-second`.

| Key | Requires | Contents | In `session-sim` |
|---|---|---|---|
| `loot-1` | `campaign` | e1 "Goblin chief's pouch" 12 gp 30 sp; e2 "Potion of healing ×2"; e3 "Wrong chest" 500 gp, **voided**; e4 coins only 5 pp (+4 `loot-received` notifications) | no (the demo awards loot live) |
| `loot-second` | `campaign-second` | Activate Second Campaign; add "SECOND-CAMPAIGN-LOOT" 1 gp; re-activate Fixture Campaign | no |

| Level | What | Fixtures |
|---|---|---|
| Unit | zod: text trim / control chars / 200, coin bounds, "text or coin" rule, strict fields. `formatCoins` order + zeros. Notification text variants + max case (200-char text, all coins 999 999 → 268 chars). Visibility fn (DM / player full). Client: newest-first order, voided styling, form validity via the shared schema, Add locked while not `live` / in flight, lost-intent toast | In-code |
| Integration | `loot.add`: row + log row + `LootAdded` then `NotificationCreated`, both before `ack`; test command calling `partyLoot.add` then throwing → no row, event, log entry or notification; helper with invalid input → `invalid`. Player `loot.add` / `loot.void` → `forbidden`. Invalid inputs → `invalid`. `loot.void`: upsert to all; second → `conflict`; Second Campaign's entry → `not_found`. Window: 105 entries → newest 100, void below the floor delivered live; convergence per ADR-0029 helper. Scope leak scan: "SECOND-CAMPAIGN-LOOT" never in a Fixture Campaign frame. Restart on same DB → identical snapshots. Determinism: two loads → identical IDs | `party-loot` |
| E2E (thin) | DM adds "Silver dagger" + 50 gp → `player-1` sees the row + toast | `party-loot` (header `// e2e-bundle: party-loot`) |

**Browser walkthrough** — `PP_TEST_MODE=1` (for "drop connection"); `bun run build`; `fixtures:reset-load party-loot --profile verify`; `start --profile verify` in the test agent's pane; evidence per [AGENTS §9.6](../../AGENTS.md#96-browser-verification-test-agents). Contexts (Playwright MCP) **A** DM (`pw-dm`), **B** `player-1` (`pw-player-1`), **C** `player-2` (`pw-player-2`). Changes show ≤ 1 s.

| # | DM (A) | Players (B, C) | Expected |
|---|---|---|---|
| 1 | Log in, open Loot | — | e4, e3, e2, e1 newest first; e3 struck through "Voided"; no per-item toasts |
| 2 | — | B, C open links, open Loot | Same four rows, no form, no Void; no "SECOND-CAMPAIGN-LOOT" in DOM or frames |
| 3 | Add "Silver dagger" + 50 gp, Enter | — | Row on top in A, B, C; toast "Party loot: Silver dagger (50 gp)" in all three; row in `note.history` |
| 4 | — | B closes Loot, opens Notifications, clicks "Open" on the loot row | `loot.log` opens |
| 5 | Try Add with empty text and no coins; then 1.5 gp | — | Add disabled both times (Enter does nothing); no entry, toast or notification anywhere |
| 6 | Void "Silver dagger", confirm | — | Struck through + "Voided" in A, B, C; no toast |
| 7 | Add "Ruby" while C is dropped | C opens + closes Notifications, then "drop connection" (Probes window) | C: banner, then "Ruby" without reload; no per-item toast; bell badge 1 |
| 8 | Hard-kill + restart server | — | All rejoin; logs identical to step 7; no console errors |
| 9 | Switch to Second Campaign, open Loot; then back | B, C wait, then rejoin | A: only "SECOND-CAMPAIGN-LOOT"; then the full Fixture Campaign list; B, C list unchanged |

Teardown: stop the server, `fixtures:reset --profile verify`.

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [live-sync](live-sync.md), [protocol](../protocol/README.md) | Record-type registry with `window` (ADR-0029), scope gate, intents, test-mode "drop connection" | complete; `window` built by `fix/combat-core` |
| [notifications](notifications.md) | `notify`, server kind registry, client view registries, toasts, `note.history`, `badge?(store)` | complete; `build/notifications` merged first |
| [play-shell](play-shell.md), [campaign-management](campaign-management.md), [fixtures-adapters](fixtures-adapters.md) | Window registry, `useOpenWindow` (confirms `loot.log`, both, for OQ-SHELL-06); campaign scope + switch; `base`, `player-2`, `campaign-second`, bundle registry | complete |

**Shared changes the build needs** (AGENTS §9.9; orchestrator routes; registries per [protocol §26](../protocol/README.md#26-combat-registries-and-seams))

| Shared file | Change | Kind |
|---|---|---|
| `src/server/db/schema.ts`; `src/shared/events/` | Table `loot_entry` (§8), `seq` per CON-20, index (campaignId, seq); events `LootAdded`, `LootVoided` (§9 payloads) | sequence or `fix/*` first |
| `src/server/features/index.ts`; record-type registry; `src/client/{dm,player}/windows.ts`; `fixtures/bundles/index.ts` | `partyLoot`; `loot-entry` with `window {orderBy: seq, size: 100}`; `loot.log`; `party-loot` | append-only lines |
| `src/server/features/notifications/kinds.ts`; `src/client/{dm,player}/notification-views.ts` | `loot-received` (FR-LOOT-09/10; dropped if OQ-LOOT-06 = window only) | append-only lines |
| `fixtures/bundles/session-sim.ts` | **None**: `loot-1`, `loot-second` stay out (demo awards loot live; FIX §8 "no") | — |
| `docs/protocol/`, `docs/data-model/`, specs, glossary | Protocol: Reward §§ (type, intents, events, `partyLoot.add`, `formatCoins`), §23 kind, §24 window + launcher order, §26 lines, §20 budget row (DM worst ≈ 765 KB vs 768 KB; fallback window 50). Data model: `loot_entry` §, Reward phase, MVP kinds. FIX §8 rows + bundle; notifications OQ-NOTE-08; glossary (OQ-LOOT-09) | integrator at merge |

## 15. Open questions

**Bold** option = suggested pick (not decided).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-LOOT-01 | Entry shape (must grow into gold ledger + party inventory, tier A) | **Free text 0–200 + optional coins cp/sp/ep/gp/pp as int columns; one required** (coins summable later; items stay text until world-builder) / free text only (simplest; ledger must parse text later) / structured items (needs item entities, not MVP) | yes (DM) | post-mvp/party-board |
| OQ-LOOT-02 | Correcting a wrong entry? | **DM voids it: kept, struck through for all, no edit/delete** (honest, append-only, one click) / DM edits + deletes in place (cleaner log; players see entries change or vanish) / no corrections | no (DM) | — |
| OQ-LOOT-05 | Running coin total in the window? | **Not in MVP** (total awarded ≠ party purse after splits and spending; gold ledger is tier A) / computed `loot-total` record, sum of non-voided coins (no table; one extra record per add/void) | no (DM) | post-mvp/party-board |
| OQ-LOOT-06 | `loot-received` notification ([OQ-NOTE-08](notifications.md#15-open-questions))? | **Yes: info, audience `all` (DM toasts too), toast + history; void sends none** (offline players catch up via badge) / window only | no · DM (Reward gate, #139 P28) | notifications |
| ~~OQ-LOOT-03, 04, 07, 08~~ | ~~Player adds; item entity ref; `loot.log` open by default; gems~~ | Decided (integrator, as picked): 03 no player adds in MVP (later additive `addedByPlayerId`); 04 no `itemEntityId` now (nullable later); 07 closed by default, toast + launcher open it; 08 gems own their counters and may call `partyLoot.add` from their command | — | party-board, world-builder, play-shell, gems |
| OQ-LOOT-09 | Glossary: add **Loot entry** ("one line of party loot: text + optional coins, added by the DM") and **Void** ("DM marks a loot entry as a mistake; kept, struck through, not undo") | **Add both** / reuse "party loot" only | no · owner: integrator | glossary |

## 16. Out of scope

- See §4. Owners: [party-board](post-mvp/party-board.md) (inventory, ledger, handouts, notes), [character-sheet-full](post-mvp/character-sheet-full.md) (currency), [gems](post-mvp/gems.md); load older, totals, item refs, player adds (OQ-LOOT-03–05).
