---
title: Party loot
prefix: LOOT
status: in-review
owner: spec-followups, spec-rs
wave: 3
phase: post-mvp-9
---

# Party loot

> **Sprint 3 revision (DM gate 1, #207; owned by [party-board](party-board.md), seams S8):** loot entries gain kind `item` and a `qty` column (party inventory moves are logged here), a DM `loot.split` (⌊coin / n⌋ per denomination, remainder stays in the pot), item rows in `loot.log`, and `loot-received` also from `party.addItem` (amends FR-LOOT-13). Party-board builders edit this feature's folders by orchestrator assignment. The rest of this spec is unchanged.
>
> **Sprint 5 revision (track P, DM [#250](../decisions-log.md) [4]; owned by [party-board](party-board.md)):** the loot view moves into a **Loot** tab of the Party window, right of Inventory ([FR-PARTY-29](party-board.md#66-sprint-5-loot-tab-present-uploads)); the "Coin: open Party loot" button goes; the `loot.log` window retires (decided #256, OQ-LOOT-17). New FR-LOOT-21–24; amended FR-LOOT-14, -15, OQ-LOOT-07. Records, intents, events and the snapshot are unchanged (0 B, [PARTY §12](party-board.md#12-performance--bandwidth)).

> **Sprint 6 revision (track PF, DM [#285](../decisions-log.md) [3]):** decided by the DM (not open): a **negative amount stays the way to subtract**; with a negative value the add button reads **Subtract** and the form's label updates; a hint says "Enter a negative amount to subtract."; the button is **disabled for empty or zero**. New FR-LOOT-25–28 (client only, slice PF3); FR-LOOT-16 amended. Records, intents, events, notifications and the snapshot are unchanged (0 B). Walkthrough: [play-shell §13](play-shell.md#13-test-plan) P13.

> **Sprint 7 revision (track FU, BL-48, DM [#311](../decisions-log.md)):** decided, not open: a half-typed Move form is no longer lost on a tab switch. New **FR-LOOT-29** (outcome; the means is party-board's [FR-PARTY-50](party-board.md#69-sprint-7-bl-48-copy-and-tabs-track-fu), tabs stay mounted). Loot's "Party loot: …" notification text stays (FR-LOOT-13); only the **inventory** toast changes ([FR-PARTY-49](party-board.md#69-sprint-7-bl-48-copy-and-tabs-track-fu)). Test `FR-LOOT-29 move draft kept` (DOM: 5 gp Mira → Party typed, tab to Inventory and back → kept; close → gone); walkthrough U17 in [play-shell §13](play-shell.md#13-test-plan); slice FU4. Client only, 0 B. No open question.

> **Sprint 9 revision (track RS, BL-73, DM [#338](../decisions-log.md); owner spec-rs).** Decided, not open: each [stronghold](strongholds.md)'s **Stores** is a holder in the loot / inventory ledger, "so Move to party is the existing form". New **FR-LOOT-30–39** ([§6](#6-functional-requirements), sprint 9 rows): endpoint kind `stores` for coin and items, derived `stores-coin`, redaction of DM-only Stores, player rights, the Move form's Stores options, Stores on a deleted stronghold, conservation. Amends FR-LOOT-06, -07, -18 and party-board FR-PARTY-17–23. DM questions [OQ-LOOT-21, -22](#15-open-questions) (and [OQ-HOLD-12](strongholds.md#15-open-questions): DM-only Stores items). Review-a rulings applied: `outside` end for redacted rows, no `seq` to players, window-only flip changes, split big auto-moves, names from `stronghold-index`, per-item DM-only Stores rows. CON-44 measured: DM ≤ +11.5 KB, players ≤ +9.2 KB worst ([§12](#12-performance--bandwidth)). Design: [proposed ADR Stores holder](../architecture/adr/proposed-s9-rs-stores-holder.md). Slices RS0 (server) and RS3 (UI) ([HOLD §14](strongholds.md#14-dependencies)).

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md).

## 1. Summary

- The DM gives the party a reward. Every player sees it in a shared **party loot** log ([ADR-0014](../architecture/adr/0014-mvp-scope.md), vision step 4).
- A **loot entry** = free text plus optional signed coins (cp / sp / ep / gp / pp) going to or from the **party pot** (#146, #150). A negative entry records a spend. There is no below-zero guard (#150).
- Each PC has a **wallet** (cp–pp). **Coin moves** between the pot and wallets, and from PC to PC, are rows in the same log (#150). The DM can move any coin. A player can give from their own wallet and take from the pot.
- The pot and the wallets are derived from the log. Nothing is stored that could drift.
- The DM corrects a loot entry by **editing** it. The row then shows "Edited" (#146, #150). Smallest slice of the [party board](post-mvp/party-board.md).

## 2. Scope

- Record type `loot-entry` (campaign scope, windowed per [ADR-0029](../architecture/adr/0029-windowed-record-types.md)), kind `loot` or `move`. Derived record types `party-pot` (one per campaign) and `wallet` (one per character), with no table.
- Intents `loot.add`, `loot.edit` (DM only) and `loot.move` (DM; player with ownership checks). No REST.
- Notification kind `loot-received` (info to all) for non-spend loot only, created in the add's transaction ([ADR-0027](../architecture/adr/0027-notification-creation.md); #146 answers [OQ-NOTE-08](notifications.md#15-open-questions)).
- Window `loot.log` "Party loot", both clients ([OQ-SHELL-06](play-shell.md#15-open-questions)). Fixtures + bundle `party-loot`.

## 3. Goals

- The DM awards loot or records a spend in one short form, mid-session, in under 10 s. A player moves coin in under 10 s.
- Connected clients see each change and the new pot and wallets ≤ 1 s after commit. An offline player sees all of it on rejoin.
- The pot and the wallets always equal the sums over **all** the campaign's entries, including entries older than the window. Coin is conserved: pot + Σ wallets = Σ loot coins + net coin moved in from outside the party (`world` moves).
- Crash-safe: each command commits with its event-log row (and notification) or not at all.
- The shape grows into the tier-A gold ledger and party inventory without rework.

## 4. Non-goals

- Party inventory, item transfer, handouts, gold split (→ [party-board](post-mvp/party-board.md)); gems (→ [gems](gems.md), OQ-LOOT-08); wallet on the character sheet (OQ-LOOT-16).
- Below-zero guard (#150), coin conversion / making change, hidden or pre-staged loot, deleting entries, editing moves (OQ-LOOT-15), edit history in the UI, player-added loot (OQ-LOOT-03), load older.
- Loot lines in the game log (they are separate windows, as notifications I6). Undo is combat-only ([ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)): an edit or a reverse move is the correction.

## 5. User stories

**DM**
- As the DM, I want to type "Goblin chief's pouch" + 50 gp after the fight and press Enter, so the party has a record without Miro.
- As the DM, I want to fix a wrong entry (500 gp → 50 gp) and record "Paid the ferryman −2 gp", so the pot shows what the party actually holds.
- As the DM, I want to hand 20 gp from the pot to Mira, so each PC's purse is tracked.

**Player**
- As a player, I want a toast and a log I can reopen, so I know what the party got, even if I was disconnected at the time.
- As a player, I want to see the pot and my wallet at a glance, give coin to a friend or the pot, and take my share from the pot, without asking the DM.

## 6. Functional requirements

`env` = `CommandEnv`. The campaign comes from `env.actor.campaignId`. IDs and time come from `env.ctx` ([ADR-0022](../architecture/adr/0022-deterministic-seams.md)). "Coins" = the five fields `cp, sp, ep, gp, pp`. An "endpoint" is `{kind: party | world | character, characterId?}`, with `characterId` present iff `kind = character`.

| ID | Requirement | Notes |
|---|---|---|
| FR-LOOT-01 | Record type `loot-entry`, scope `campaign`, fields per §8, persisted, ordered by row `seq` (CON-20). `kind: loot` = DM loot or spend, stored as `world → party`. `kind: move` = a coin move. | ADR-0006 |
| FR-LOOT-02 | Loot input (strict zod, shared by add and edit): `text` is trimmed, control characters are removed, 0–200 chars. Each coin is an integer −999 999…999 999, default 0. Needs non-empty `text` **or** a non-zero coin, else `invalid`. | #146, #150 |
| FR-LOOT-03 | `loot.add {text?, cp?, sp?, ep?, gp?, pp?}` (DM) runs the internal helper `partyLoot.add(env, input) → {entryId}` **in the caller's transaction**. It inserts the row, emits `LootAdded` (changes: entry + `party-pot` iff the pot changed), then calls `notify` with `loot-received` **iff no coin < 0** (FR-LOOT-13). Any failure rolls all of it back. Later features (gems, party-board) may call the helper. | ADR-0027, I15 order |
| FR-LOOT-04 | `loot.edit {entryId, text, cp, sp, ep, gp, pp}` (DM): a full replacement under FR-LOOT-02 rules. Entry not in the campaign → `not_found`. Entry of kind `move` → `conflict` "Moves can't be edited — move the coin back". Same values as stored → `ack`, no write, no event. Otherwise update, set `editedAt`, and emit `LootEdited {entryId, before, after}` (changes: entry, plus `party-pot` **only if its value changed**). No notification. | #146, #150 |
| FR-LOOT-05 | A player sending `loot.add` or `loot.edit` → `forbidden`: no change, no event. No delete or void command exists. | ADR-0004, #150 |
| FR-LOOT-06 | `loot.move {from, to, cp?, sp?, ep?, gp?, pp?, text?}` (strict). Each coin is an integer 0…999 999 and at least one is > 0. `text` is 0–100 chars, cleaned as in FR-LOOT-02. `from ≠ to`. `world` is allowed only with a `character` at the other end. Any violation → `invalid`. Every `characterId` must be a `character` entity of the campaign, else `not_found`. | `world` per OQ-LOOT-14 |
| FR-LOOT-07 | Move authorization: the DM may make any move. A player may make (a) own character → `party` or another character, or (b) `party` → own character. Own = the character's `ownerPlayerId` = `env.actor.playerId` at commit. Anything else (including any `world` end) → `forbidden`. **No balance check**: the pot and wallets may go negative (#150). | #150 |
| FR-LOOT-08 | A move inserts a `kind: move` row and emits `CoinMoved {entryId, from, to, cp, sp, ep, gp, pp, text}`. Changes: the entry, `party-pot` iff an end is `party`, and one `wallet` per character end (before = null on that character's first move). The event-log row commits in the same transaction. No notification (OQ-LOOT-15). Result `{entryId}`. | |
| FR-LOOT-09 | Derived `party-pot` `{id = campaignId, campaignId, cp, sp, ep, gp, pp}` = per coin, Σ over entries with `to = party` − Σ over entries with `from = party`, over **all** the campaign's entries. Derived `wallet` `{id = characterId, campaignId, characterId, cp…pp}` = Σ `to = character` − Σ `from = character`. The wallet provider returns one row per character with ≥ 1 move. A client treats a missing wallet as all zeros. Neither type is stored or windowed. Their zod coins are **unbounded signed safe integers**, not the entry bounds. | §8 why |
| FR-LOOT-10 | Visibility of `loot-entry`, `party-pot` and `wallet`: DM **full**. Player **full** for their own campaign (scope gate), so other PCs' wallets are included (OQ-LOOT-13). No DM-only field exists. | [ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md) |
| FR-LOOT-11 | `loot-entry` snapshot per ADR-0029: `window {orderBy: seq, size: 100}`, no pin, cut before the filter. An edit below the floor is delivered live. A fresh snapshot omits that row, but the pot and wallets still count it. | #137 |
| FR-LOOT-12 | Pure fns in `@shared/party-loot`. `formatCoins(coins)` = the non-zero coins in order pp, gp, ep, sp, cp, negatives with "−" (e.g. "50 gp, 30 sp", "−2 gp"); all zero → "". `gpValue(coins)` = pp×10 + gp + ep/2 + sp/10 + cp/100, shown to 2 decimals. | |
| FR-LOOT-13 | Notification kind `loot-received` (server kind registry): owner LOOT, audience `all`, no action (state `info`), payload `{entryId}`, `genericResolve` false. Created only by `partyLoot.add` when no coin < 0, so spends, change-making entries and moves create none. Text uses the values at add time: "Party loot: ‹text› (‹coins›)", "Party loot: ‹text›" or "Party loot: ‹coins›". Over 280 chars → cut to 279 + "…". Toasts follow [FR-NOTE-13/14](notifications.md#6-functional-requirements), DM included. An edit leaves the notification row unchanged. | #146, review 1 |
| FR-LOOT-14 | Client notification view `loot-received` (both clients): coins icon. The renderer = the generic row, plus the suffix " (edited)" when the entry is in the store with `editedAt` set, plus an "Open" link that opens `loot.log` via `useOpenWindow` *(S5: opens the Party window on its Loot tab, FR-LOOT-22)*. No `onAction`. Entry outside the window → no suffix (accepted). | [FR-NOTE-19](notifications.md#6-functional-requirements) |
| FR-LOOT-15 | Window `loot.log` "Party loot", both clients, closed by default, `center` 440×560, min 320×320. Launcher "Loot"; icon and order are the builder's pick. *(S5: the window retires; the same body is the Party window's Loot tab, FR-LOOT-21.)* Top to bottom: **Party pot** strip; **Wallets**; DM add form (FR-LOOT-16); Move form (FR-LOOT-18); log. Strip = one Badge per non-zero coin (pp → cp), negatives with "−" in `text.muted`, Tooltip "≈ ‹gpValue› gp"; all zero → "No coin". Wallets = one row per `character` entity in the store, sorted by name: name + coin Badges, the same way. The viewer's own characters come first, marked "You". No characters → "No characters". Log is newest first. A loot row = text, coin Badges, time (local hh:mm, Tooltip full date), and an "Edited" Badge (Tooltip edit time) if edited. A move row = "‹from› → ‹to›" (names; "Party pot", "Outside the party"), coins, text, time. Changes show ≤ 1 s after commit. | [FR-SHELL-07](play-shell.md#6-functional-requirements) |
| FR-LOOT-16 | DM add form: text Input, five coin Inputs (pp, gp, ep, sp, cp; a leading "-" allowed), "Add" Button; Enter submits. Add is disabled while the input is invalid (FR-LOOT-02, mirrored client-side), while the client is not `live` and while its intent is in flight. `ack` → the form clears. `reject` → inline message, values kept. Intent lost to a disconnect (never resent, [FR-SYNC-05](live-sync.md#6-functional-requirements)) → Toast "Connection lost — check the loot log before adding again". *(Sprint 6: label, title, hint and the disabled rule per FR-LOOT-25–27.)* | as FR-CHAR-12 |
| FR-LOOT-17 | DM "Edit" on each loot row (not on moves) turns the row into the same inputs, prefilled, with "Save" / "Cancel". Enter saves, Esc cancels. One row can be in edit at a time. Save is disabled while the input is invalid or unchanged, while not `live` and while in flight. `ack` → the row returns to view. `reject` → inline message, values kept. Lost intent → Toast "Connection lost — check the entry before saving again". On a campaign switch the open edit is discarded. | review 9 |
| FR-LOOT-18 | Move form (both clients): "From" and "To" Selects, five coin Inputs (non-negative), optional note, "Move" Button. Options: DM = Party pot, every character, Outside the party (with the FR-LOOT-06 pairing). Player: From = own characters + Party pot. To = Party pot + other characters when From is an own character, or own characters only when From = Party pot. Move is disabled while the input is invalid (FR-LOOT-06/07 mirrored), not `live` or in flight. `ack` → coins and note clear, Selects kept. `reject` → inline message. Lost intent → Toast "Connection lost — check the loot log before moving again". Player with no character → the form is hidden. | #150 |
| FR-LOOT-19 | Player `loot.log`: no add form and no Edit. Otherwise the same as the DM's view. | |
| FR-LOOT-20 | Fixtures `loot-1`, `loot-wallets`, `loot-second` and bundle `party-loot` (§13). `fixtures:reset-load party-loot` works from empty and is deterministic ([FR-FIX-08](fixtures-adapters.md#6-functional-requirements)). | ADR-0017 |
| **Sprint 5** (track P) | | |
| FR-LOOT-21 | **Loot tab** [4]: the FR-LOOT-15 body (pot strip, wallets, DM add form, Move form, DM Split…, log) renders as the Party window's **Loot** tab, right of Inventory ([FR-PARTY-29](party-board.md#66-sprint-5-loot-tab-present-uploads)), in one scroll area; content, order, forms and test IDs unchanged. Window type `loot.log` and its launcher entry (whatever its label) are **removed** from both clients' registries (OQ-LOOT-17; P3 deletes LOOT's own lines, seams S4). A stored layout that still lists `loot.log` drops it as an unknown kind (play-shell's layout parse; no migration, no warning toast). | Amends FR-LOOT-15, OQ-LOOT-07 |
| FR-LOOT-22 | The `loot-received` view's "Open" (`loot-note-open`) calls `openPartyTab("loot")` ([FR-PARTY-30](party-board.md#66-sprint-5-loot-tab-present-uploads)). | Amends FR-LOOT-14 |
| FR-LOOT-23 | The character sheet's wallet link (`charx-wallet-open`, "Move coin in Party loot") calls `openPartyTab("loot")` instead of opening `loot.log`. One call in CHARX's `MoreTabs.tsx`, by assignment. | |
| FR-LOOT-24 | No other change: records, intents, events, notifications, permissions, snapshot window and figures as §8–§12. Test IDs inside the tab as §7; `loot-log` now sits inside `party-board`. | |
| **Sprint 6** (track PF; DM #285 [3]) | | |
| FR-LOOT-25 | **Subtract label:** while any coin Input of the DM add form holds a negative integer, the button reads **"Subtract"** and the form title **"Subtract from the pot"**; otherwise "Add" and "Add loot". Mixed signs (e.g. −2 gp, +15 sp: making change) read "Subtract" (OQ-LOOT-20 A): the same "any coin < 0" test as the server's spend rule, so "Subtract" always means "no toast for players" (FR-LOOT-13). Updates on every keystroke. The intent is unchanged (`loot.add` with signed coins). | #285 [3] |
| FR-LOOT-26 | **Hint:** a muted line under the coin Inputs, always shown: "Enter a negative amount to subtract." | #285 [3] |
| FR-LOOT-27 | **Disabled for empty or zero** (OQ-LOOT-19 A): Add / Subtract is disabled while every coin Input is empty or 0, **even with text filled**, in addition to FR-LOOT-16's reasons (invalid, not `live`, in flight). The server rule (FR-LOOT-02: text or a non-zero coin) is unchanged, so fixtures and existing text-only entries stay valid; items go to the party Inventory ([party-board](party-board.md)). | #285 [3] |
| FR-LOOT-28 | **Edit form:** a loot row's Edit (FR-LOOT-17) shows the same hint; its button stays "Save" and keeps FR-LOOT-17's rule (a text-only entry stays editable). Move and Split forms unchanged (non-negative coins). | |
| FR-LOOT-29 | **Drafts survive a tab switch** (sprint 7, track FU; BL-48: a half-typed Move form was lost when switching the Party window's tab): the Loot tab's add form, Move form and Split dialog draft keep their typed values while the Party window stays open and the user switches to another tab and back (the tab stays mounted, [FR-PARTY-50](party-board.md#69-sprint-7-bl-48-copy-and-tabs-track-fu)); closing the window or a reload drops them (as today); a submitted form clears as today. No LOOT code beyond keeping state in the form components (no lifting to a store needed). | BL-48 |
| **Sprint 9** (track RS; BL-73) | | |
| FR-LOOT-30 | **Stores holder**: an endpoint may be `{kind: stores, strongholdId}`, one Stores per [stronghold](strongholds.md) ([FR-HOLD-21](strongholds.md#6-functional-requirements)). `loot.move` (coin) and the item commands (FR-LOOT-37) accept it. Pairing (amends FR-LOOT-06): `world` pairs with a `character` **or a `stores`** end; `from ≠ to`. `strongholdId` must be a stronghold of the campaign, else `not_found` "Stores are gone". | Amends FR-LOOT-06 |
| FR-LOOT-31 | Derived **`stores-coin`** `{id = strongholdId, campaignId, strongholdId, cp…pp, hidden?}` = Σ `to = stores` − Σ `from = stores` over **all** entries (as FR-LOOT-09); one row per stronghold with ≥ 1 entry; **in the snapshot** (≤ 8 rows, not windowed). `hidden` (DM-only key, on the wire only when true) = the stronghold's `dmOnly` when the row is built. Visibility: DM full; player hidden if `hidden`, else full minus `hidden`. Changes ride on every coin move with a Stores end, on `hold.update`'s `dmOnly` flip ([FR-HOLD-12](strongholds.md#6-functional-requirements)) and on `hold.delete` (→ null). | §12 |
| FR-LOOT-32 | **DM-only Stores in the ledger** (OQ-LOOT-22 **A**): `loot_entry.stores_hidden` (server-written copy; DM-only key, on the wire only when true) = some `stores` end belongs to a DM-only stronghold; a `dmOnly` flip rewrites it on every entry of that stronghold in the same transaction, but the event's changes carry **only the entries inside the current window** (newest 100; review ruling 8; measured: 55,927 B DM / 52,627 B player for 100 worst-width rows vs 279,127 / 262,627 B for 500). **Player redaction** of such a row (review ruling 3b): each hidden `stores` end → **`{kind: outside}`** (a wire-only end, shown "Outside the party"; never accepted in an intent), so a redacted row never takes the `world ↔ party` move shape FR-LOOT-06 forbids; a row with no end left but `world` / `outside` is **hidden**. So a player never gets a hidden stronghold's id or name from the ledger, while the pot's changes stay explained. `party-item` rows of a hidden Stores carry the same copy and are **hidden** from players. **Every player `loot-entry` drops `seq`** (review ruling 7: hidden rows would leave gaps); players order the log by `createdAt`, then id, and new entries get a `createdAt` strictly increasing per campaign (≥ the previous + 1 ms from `ctx.clock`; amends FR-LOOT-15's order for players; the DM keeps `seq`). | No leak; review 3, 7, 8 |
| FR-LOOT-33 | **Who moves with Stores** (OQ-LOOT-21 **A**): the DM any move. A player, with a **visible** Stores only: Stores ↔ Party pot (both ways), Stores → own character, own character → Stores; coin and items alike. A hidden Stores → `not_found` (never revealing it); other ends as FR-LOOT-07 (`forbidden`). Checked at commit (owner, stronghold `dmOnly`). No balance check (#150), as the pot. | Amends FR-LOOT-07, [FR-PARTY-23](party-board.md#63-party-inventory) |
| FR-LOOT-34 | **Move to party is the existing form** (BL-73): the Move form's From / To options (FR-LOOT-18) gain "‹Stronghold› Stores" for each Stores the viewer may use (DM: all, DM-only ones with eye-off; players per FR-LOOT-33). The Stronghold window's **Stores** tab ([FR-HOLD-28](strongholds.md#6-functional-requirements)) shows this Stores' coin strip and items, and hosts the same Move form preset From = this Stores, To = Party pot, labelled **"Move to party"**, plus FR-PARTY-24's Take / Give… with this Stores as source / target and the DM's Add to Stores. | BL-73 |
| FR-LOOT-35 | **Log rendering**: "Greystone Keep Stores → Party pot: 50 gp", "Greystone Keep Stores → Mira: Arrows ×20"; a deleted stronghold's end reads "Stores (removed)"; a redacted (`outside`) end reads "Outside the party" (FR-LOOT-32). Names come from the snapshot's **`stronghold-index`** ([FR-HOLD-01](strongholds.md#6-functional-requirements); review ruling 6), so the Loot tab needs no load: an id with an index row → its name; an id without one → "Stores (removed)" (deleted; a hidden one never reaches a player as an id). The Move form's Stores options read the same index. The Loot tab's pot / wallets strip does not list Stores (they live in the Stronghold window). | review 6 |
| FR-LOOT-36 | **Items in Stores** (amends [FR-PARTY-17, -18](party-board.md#63-party-inventory)): `party_item.stronghold_id` (null = party inventory) and `stores_hidden` (FR-LOOT-32); record `party-item` gains `strongholdId` (on the wire only when set). Caps and merge key are **per holder** (party 60 rows, each Stores 60; key = name + notes within the holder). The Inventory tab lists rows without `strongholdId` only. Still lazy `"all"` (one load brings party and Stores rows). **DM-only Stores items** (OQ-HOLD-12 **A**; review ruling 1): `party_item.dm_only` (Stores rows only; DM sets it on add / edit; part of the merge key within the holder); players never receive such a row (hidden, like `stores_hidden`); a player's Take / move of it → `not_found`. Entries that add or remove a DM-only item (`world ↔ stores`) carry the copy `loot_entry.item_hidden` (DM-only key) and are **hidden** from players; an entry that moves it **out** to the party or a character is visible (the item now shows there). Changing an item's `dm_only` later doesn't rewrite older entries. Under OQ-HOLD-12 B the column and copy don't exist (items follow the stronghold). | Amends FR-PARTY-17, -18; review 1 |
| FR-LOOT-37 | **Item commands with Stores** (amends [FR-PARTY-19–22](party-board.md#63-party-inventory)): `party.moveItem` ends gain `stores` (rights FR-LOOT-33); `party.addItem` gains optional `holder: {kind: stores, strongholdId}` and `dmOnly?` (DM; Stores only; entry `world → stores`; **no** `loot-received` notification: Stores aren't in the party's hands); `party.editItem` (gains `dmOnly?` on Stores rows) / `party.removeItem` work on Stores rows (DM; remove writes `stores → world`). Existing events (`PartyItemAdded`, `ItemMoved`, …) carry the Stores rows in their changes. | |
| FR-LOOT-38 | **Stronghold deleted** ([FR-HOLD-19](strongholds.md#6-functional-requirements), OQ-HOLD-06 **B**): in `hold.delete`'s transaction every Stores item moves to the party inventory (FR-PARTY-22's merge; party full → the whole delete is `conflict`, nothing written) and the Stores coin balance goes to 0: positive coins in Stores → Party pot `move` entries, negative ones (no balance check; **the pot pays them**, and FR-HOLD-19's confirm says so) in Party pot → Stores entries. Each entry stays within the move bound (0…999 999 per coin, FR-LOOT-06): a larger balance is **split into as many entries as needed** (review ruling 9). Text "Stronghold deleted", **empty when the Stores was hidden** (review ruling 3a: players never read about a stronghold they didn't see). Old entries keep their `stores` end ("Stores (removed)"); `stores-coin` and `stronghold-index` → null. | review 3, 9 |
| FR-LOOT-39 | **Conservation** (amends §3's rule): pot + Σ wallets + Σ Stores = Σ loot coins + net coin from outside (`world` ends, incl. `world ↔ stores`); items likewise across party, Stores and sheets. Asserted after every command in the RS tests. Fixtures `hold-greystone-stores`, `hold-tower-secret`, `hold-tower-move` ([FR-HOLD-35](strongholds.md#6-functional-requirements)). Tests: `FR-LOOT-34 Move to party from Stores`, `FR-LOOT-32 hidden Stores redaction`, `FR-LOOT-33 player Stores rights`, `FR-LOOT-38 delete moves Stores`, `FR-LOOT-39 conservation`, `FR-LOOT-31 stores-coin per viewer`. | |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md): shadcn Input, Button, Badge, Tooltip, Select, ScrollArea, Toast. Dark only. Semantic tokens (`text.muted` for "Edited" and negatives). No custom styling.

- **States:** empty log "No loot yet"; pot "No coin". Loading = shell skeleton. Disconnected = the last view + reconnect banner, with every form, Edit and Save disabled. Reject = inline error under the form or the edited row.
- **DM view:** pot, all wallets, add form, Move form (any ends), log with Edit on loot rows. The DM sees their own add as a toast (audience `all`).
- **Player view:** pot, wallets (own first, "You"), Move form limited per FR-LOOT-18, log. A toast for each non-spend loot entry and an unread badge on the bell (notifications). No toast for edits, spends or moves.
- *(S5)* **Where:** Party window → Loot tab (both clients). No separate window or launcher button. The DM's Split… stays where it is in the body.
- **Test IDs** (AGENTS §9.5): `loot-log`, `loot-log-empty`, `loot-pot`, `loot-pot-coin` + `data-value=pp|gp|ep|sp|cp`, `loot-pot-empty`, `loot-wallet` + `data-record-id` (character id) + `data-own`, `loot-wallet-coin` + `data-value`, `loot-entry` + `data-record-id` + `data-kind` + `data-edited`, `loot-entry-edit`, `loot-edit-save`, `loot-edit-cancel`, `loot-edit-error`, `loot-add-text`, `loot-add-coin` + `data-value`, `loot-add-submit`, `loot-add-error`, `loot-move-from`, `loot-move-to`, `loot-move-coin` + `data-value`, `loot-move-text`, `loot-move-submit`, `loot-move-error`, `loot-note-open` (the "Open" link), `loot-add` and `loot-move` (form wrappers), `loot-move-option` + `data-value` (each From / To option), `loot-entry-coin`, `loot-entry-edited`, `loot-entry-route` (log rows). Edit inputs reuse `loot-add-*` inside the row, scoped by `data-record-id`.
- *(Sprint 6)* **Subtract** (FR-LOOT-25–27): the add form's title becomes **"Subtract from the pot"** and its Button **"Subtract"** (same primary style; no destructive colour: a spend is normal play) while any coin is negative; the hint "Enter a negative amount to subtract." sits under the coin Inputs in `text.muted`. Test IDs: **new** `loot-add-title` (the form's title, today a bare `SectionTitle`; `data-mode` = `add` \| `subtract`); `loot-add-submit` gains `data-mode` = `add` \| `subtract`; **new** `loot-add-hint` (also inside an edited row, scoped by `data-record-id`).
- *(S9)* **Stores** (FR-LOOT-34, -35): Move options "‹Stronghold› Stores" (`loot-move-option` `data-value="stores:<strongholdId>"`, eye-off for the DM's hidden ones); log routes name the Stores. Inside the Stronghold window: `hold-stores` wraps `loot-stores-coin` + `data-value`, the Move form (`loot-move` with `data-preset="stores"`, title "Move to party"), and the item list (`party-item-*` IDs, `data-holder="stores"`); DM `loot-stores-add` (items) and the DM's Outside the party ↔ Stores options. **DM view:** every Stores; **player view:** shown strongholds' Stores only, per OQ-LOOT-21.

## 8. Data model

| Entity | Field | Type | Notes |
|---|---|---|---|
| Loot entry (`loot-entry`) | id, campaignId | ID, ID → Campaign | `env.ctx.ids`; `env.actor.campaignId` |
| | seq | int | DB insertion order (CON-20); order + window key |
| | kind | `loot` \| `move` | |
| | fromKind, fromCharacterId, toKind, toCharacterId | `party` \| `world` \| `character`, ID \| null | `loot` = `world → party`. On the wire: `from`, `to` endpoints |
| | text | text 0–200 (move 0–100) | Plain text, rendered as text (never HTML) |
| | cp, sp, ep, gp, pp | int; `loot` ±999 999, `move` 0…999 999 | Columns, not JSON (summed) |
| | createdAt, editedAt | timestamp, timestamp \| null | `env.ctx.clock`; `editedAt` is for `loot` only |
| Party pot (`party-pot`) | id (= campaignId), campaignId, cp…pp | derived, **not stored**, signed, unbounded | FR-LOOT-09 |
| Wallet (`wallet`) | id (= characterId), campaignId, characterId, cp…pp | derived, **not stored**, signed, unbounded | FR-LOOT-09 |

- **Relations:** campaign 1–n loot entry; campaign 1–1 party pot; character 1–1 wallet (both derived). `characterId` columns and the notification payload's `entryId` are plain ids (no FK; entities has no delete, FR-ENT-14). The event log keeps the actor and each edit's before / after.
- **Derived:** pot, wallets (server); coin string, gp value, display order, notification text, "(edited)" suffix (client / `@shared`).
- **Why derived, not stored:** one source of truth, so an edit or a crash can't leave a balance out of step, and conservation holds by construction. The sums count entries older than the window, which a client can't (its snapshot holds 100 rows). Cost: one indexed grouped `SUM` per command and per snapshot (hundreds of rows). Stored balances would need an in-transaction update from every writer, including future `partyLoot.add` callers.
- **Persisted runtime state:** entries only. Index (campaignId, seq).
- **Later (additive):** `addedByPlayerId` (OQ-LOOT-03), `itemEntityId` (OQ-LOOT-04).
- *(S9)* **Stores** (FR-LOOT-30–38): `fromKind` / `toKind` gain `stores` with `fromStrongholdId` / `toStrongholdId` (ID \| null, no FK: a deleted stronghold's rows stay); `stores_hidden`, `item_hidden` bools (copies, FR-LOOT-32, -36); derived `stores-coin` (not stored, signed, unbounded, id = strongholdId); `party_item.stronghold_id` (ID \| null) + `stores_hidden` + `dm_only` (Stores rows only, OQ-HOLD-12 A). Wire-only end kind `outside` (player redaction, never stored). `createdAt` strictly increasing per campaign for new entries (players' order; `seq` DM-only on the wire). Index `loot_entry (campaignId, fromStrongholdId)`, `(campaignId, toStrongholdId)` for the `stores-coin` sums and the flip rewrite.

## 9. API & events

**REST:** none. **Internal API:** `partyLoot.add(env, input)` (FR-LOOT-03); `formatCoins`, `gpValue` in `@shared/party-loot`.

**WS intents** (none optimistic)

| Intent | Who | Validation / ownership | Result |
|---|---|---|---|
| `loot.add {text?, cp?…pp?}` | DM | FR-LOOT-02; player → `forbidden` | `{entryId}` |
| `loot.edit {entryId, text, cp…pp}` | DM | FR-LOOT-02; in campaign (`not_found`); kind `loot` (`conflict`); player → `forbidden` | — |
| `loot.move {from, to, cp?…pp?, text?}` | DM, player | FR-LOOT-06 (`invalid`, `not_found`); FR-LOOT-07 (`forbidden`) | `{entryId}` |

**Record types** (scope `campaign`; DM full, player full for their own campaign): `loot-entry` (provider = the campaign's entries, `window {orderBy: seq, size: 100}`); `party-pot` (one computed row, zeros if no entries); `wallet` (one computed row per character with a move). No window on the last two.

**WS events** (domain events; generic record changes; all logged; none undoable or transient)

| Event | Emitted by | Payload | Changes | Visibility rule |
|---|---|---|---|---|
| `LootAdded` | `partyLoot.add` | `{entryId, text, cp…pp}` | `loot-entry` (before null); `party-pot` | Record fns: DM + every player of the campaign |
| `NotificationCreated` | `notify`, after `LootAdded`, only if no coin < 0 | per NOTE | `notification` | FR-NOTE-06: audience `all` → everyone |
| `LootEdited` | `loot.edit` | `{entryId, before {text, cp…pp}, after {…}}` | `loot-entry`; `party-pot` if changed | Record fns: DM + every player of the campaign |
| `CoinMoved` | `loot.move` | `{entryId, from, to, cp…pp, text}` | `loot-entry` (before null); `party-pot` iff an end is party; `wallet` per character end | Record fns: DM + every player of the campaign |

- Each event is its own `event` frame, all before the sender's `ack` ([FR-SYNC-14](live-sync.md#6-functional-requirements)). No listeners, no signals.
- *(S9)* **Stores** (FR-LOOT-30–38): `Endpoint` gains `{kind: stores, strongholdId}` (`@shared/events/party-loot`, shared file); new derived record type `stores-coin` (snapshot; DM full, player hidden while `hidden`); `loot-entry` redaction per FR-LOOT-32 (`storesHidden` DM-only). `CoinMoved` / `ItemMoved` changes gain `stores-coin` iff an end is `stores`; `StrongholdUpdated` (`dmOnly` flip) and `StrongholdDeleted` ([HOLD §9](strongholds.md#9-api--events)) carry entry / item / `stores-coin` changes. Intents unchanged in name; `party.addItem` gains `holder?`. No new event type.

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Add / edit loot entry | ✓ | ✗ | role (`forbidden`); campaign (`not_found`); kind (`conflict`) |
| Move: own character → pot or another character | ✓ | ✓ | FR-LOOT-07 ownership at commit |
| Move: pot → own character | ✓ | ✓ | FR-LOOT-07 |
| Move: any other (other PC's coin, `world`) | ✓ | ✗ | `forbidden` |
| Read log, pot, all wallets | all | all of own campaign | FR-LOOT-10, scope gate |
| Delete / void / edit a move | ✗ | ✗ | no command exists / `conflict` |
| *(S9)* Move with a visible Stores: Stores ↔ pot, Stores → own character, own character → Stores | ✓ | ✓ (OQ-LOOT-21 A) | FR-LOOT-33 at commit |
| *(S9)* Move with a DM-only Stores; `world ↔ stores`; add / remove Stores items | ✓ | ✗ | `not_found` (hidden) / `forbidden` |
| *(S9)* See Stores coin, items, ledger names | all | shown strongholds only (redacted otherwise) | FR-LOOT-31, -32 |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** the snapshot restores the newest 100 entries, plus the full pot and every wallet. Older entries are not resent (no "load older"). No per-item toasts; the bell's unread badge shows missed adds (FR-NOTE-18). Edits made while away show "Edited".
- **DM disconnect / reconnect:** players are unaffected and can keep moving coin. On the DM side, forms, Edit and Save are disabled. An in-flight intent is lost → FR-LOOT-16/17/18 toast; the reconnect snapshot shows whether it committed. On a campaign switch the server closes the DM connection (`4409`), the open edit is discarded, and the next snapshot shows only the new campaign.
- *(S5)* **Loot tab:** disconnect / reconnect / crash behave as above inside the tab (the records are in the snapshot, so the tab needs no reload); a stored layout from before S5 that has `loot.log` open opens without it (FR-LOOT-21).
- **Server crash mid-action:** the row, its event-log row and the notification (adds) commit together or not at all. Balances are recomputed from entries, so they can't drift. After a restart, snapshots equal the pre-crash state.
- **Concurrency:** commands serialise. A double click sends one intent (the button locks while in flight). Two players taking from the pot at once → both commit, and the pot may show negative; the DM moves coin back. Two DM tabs edit one entry → last commit wins, both are logged, and the other tab's row updates live (an open edit keeps its typed values). An owner change between click and commit → FR-LOOT-07 checks at commit (`forbidden`).
- **Mistakes:** a typo such as −100 instead of −10 isn't blocked (#150). The DM sees the negative pot and edits it. A wrong move is corrected by a reverse move; both rows stay.
- **Subtract (sprint 6):** client-only labels; nothing new on the wire. A "−" alone or "−0" counts as zero (disabled, `add` mode). Disconnect / reconnect / crash: as FR-LOOT-16 (the label follows the values kept in the form). An old row edited to negative coins: Save keeps its label (FR-LOOT-28).
- *(S9)* **Stores:** *reconnect:* `stores-coin` and the loot window come with the snapshot; Stores items with the next `party-item` load. *Show / hide a stronghold:* one event flips its entries, items and `stores-coin` for players (gain = upserts with the name, loss = redacted upserts / deletes). *Delete vs a player's move:* serialised; the loser gets `not_found` "Stores are gone". *Crash:* `hold.delete`'s Stores moves commit with the delete or not at all (FR-HOLD-39). *DM text:* an entry's `text` is not redacted (the DM's own words, as "Secrets typed into loot" below); fixtures never put a hidden stronghold's name in text.
- **Stale text:** the notification row keeps its add-time text. The renderer marks it " (edited)" while the entry is in the store (FR-LOOT-14).
- **Invalid / malicious input:** empty input, fractional or out-of-range coins, over-long text, unknown or missing fields, a bad endpoint pairing → `invalid`. HTML / markdown is rendered as plain text. Frames > 64 KB are closed by live-sync. **Secrets typed into loot:** every entry is public by design, and the event log keeps an edit's before value. Accepted (trusted table).

## 12. Performance & bandwidth

- ~5–20 entries per session, human-paced. Entry ≈ 250 B on the wire (≤ ~400 B); pot ≈ 120 B; wallet ≈ 150 B × ≤ 10 characters.
- Snapshot ≤ 100 × 400 B + 1.6 KB ≈ 42 KB worst, the same for DM and players. Within CON-44 (DM worst ≈ 680 + 42 KB < 768 KB; players < 512 KB).
- Frames: an add sends ≤ 2 `event` frames; an edit or a move sends 1 (≤ 3 changes); each goes to ≤ 7 connections.
- The grouped `SUM` over the (campaignId) index runs per command and snapshot and is sub-ms. Nothing is on the token-move hot path.
- *(S9, measured: throwaway probe on `session-sim` + `buildRealisticHeavy`, frames as `snapshotSizes`, 36-char ids, worst-width coins; probe deleted; base DM 691,581 B, players 286,190–289,445 B)* **`stores-coin`**: 2 rows DM +508 B / player +480 B; 10 rows DM +2,476 B / player +2,336 B (cap is 8). **Stores ends in the loot window**: all 100 rows with a `stores` end (worst) DM +7,500 B (incl. `"storesHidden":true`), player +5,500 B. **Worst together:** DM ≤ +10.0 KB (≈ 1.15 MB → ≈ 1.16 MB of 1.5 MiB), players ≤ +7.9 KB. Stores items are `party-item` rows (lazy, 0 B in snapshots): one row 449 B; the `party-item` load grows from 23,912 B (party 60) to 37,472 B (+ 2 Stores × 15) and 295,112 B at every cap (+ 8 × 60 rows of the 10 measured). Tests assert both ceilings and the `stores-coin` ≤ 2.5 KB bound. *(Review rulings, measured the same way)* `stronghold-index` (names for the log and Move options): 8 rows DM +1,477 B / player +1,365 B; a show / hide flip sends only the window's entries: 100 worst-width rows 55,927 B DM / 52,627 B player (500 rows would be 279,127 / 262,627 B). Dropping `seq` from player entries saves ≈ 13 B per row. New worst: DM ≤ +11.5 KB, players ≤ +9.2 KB.

## 13. Test plan

Isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)). Loop per [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md). `bun test` runs on `:memory:` with port 0. Tests are named after FRs.

**Fixtures** (`fixtures/units/party-loot/`). Setups run as DM via `loot.add` / `loot.edit` / `loot.move` (FR-FIX-13) with the fixed clock. None of them are in `session-sim` (the demo awards loot live).

| Key | Requires | Contents | Side effects |
|---|---|---|---|
| `loot-1` | `campaign` | e1 "Goblin chief's pouch" 12 gp 30 sp; e2 "Potion of healing ×2"; e3 "Silver idol" 500 gp, then **edited** to 50 gp; e4 coins only 5 pp; e5 "Paid the ferryman" −2 gp. Pot after `loot-1`: 5 pp, 60 gp, 30 sp | 4 `loot-received` notifications (e1–e4; e5 is a spend). e3's text still says 500 gp |
| `loot-wallets` | `loot-1`, `char-mira`, `char-thorn` | m1 pot → Mira 20 gp; m2 pot → Thorn 10 gp 30 sp; m3 Thorn → Mira 2 gp "Rations"; m4 Mira → Outside 1 gp "Rope". Pot 5 pp, 30 gp; Mira 21 gp; Thorn 8 gp 30 sp | none |
| `loot-second` | `campaign-second` | Activate Second Campaign; add "SECOND-CAMPAIGN-LOOT" 1 gp; re-activate Fixture Campaign | 1 notification in the Second Campaign |

- **Bundle `party-loot`** = `base` + `player-2` + `char-mira` + `char-thorn` + `campaign-second` + `loot-1` + `loot-wallets` + `loot-second`.

| Level | What | Fixtures |
|---|---|---|
| Unit | zod: text clean / bounds; loot coin bounds and sign; move coins ≥ 0 and at least one > 0; endpoint pairing; strict fields; edit needs all fields; pot / wallet schema accepts 2 000 000 and −5. `formatCoins` order, zeros, "−". `gpValue`. Notification text variants + 280 cut. The notify decision (spend / change-making → none). Visibility fns (3 types). Client: newest-first order, "Edited", the "(edited)" suffix, strip and wallets incl. negatives and missing wallet = 0, Move form options per role, form locks (invalid / not `live` / in flight / unchanged), lost-intent toasts | In-code |
| Integration | `loot.add`: row + log row + `LootAdded` then `NotificationCreated`, both before `ack`. A spend → `LootAdded` only. `notify` forced to throw → nothing is written. `loot.edit`: `LootEdited` before / after, `party-pot` change only when coins change, no notification; unchanged → `ack` with no event; a move id → `conflict`; a Second Campaign id → `not_found`. `loot.move`: the role matrix (DM any; player own → pot / other PC, pot → own ✓; other's wallet, pot → other PC, `world` ✗ `forbidden`); `invalid` pairings; unknown / other-campaign character → `not_found`; changes list pot / wallets per ends; a negative result is allowed. Conservation invariant after the bundle and after 105 random entries (incl. below the window). Window: newest 100; an edit below the floor is delivered live; convergence per the ADR-0029 helper incl. pot and wallets. Scope leak scan: "SECOND-CAMPAIGN-LOOT" (entry and notification text) and its 1 gp never appear in a Fixture Campaign frame. Restart on the same DB → identical snapshots. Two loads → identical IDs | `party-loot` |
| E2E (thin) | DM adds 50 gp → `player-1` sees the row, the toast and the pot +50 gp; `player-1` takes 10 gp → the DM sees Mira +10 gp | `party-loot` |

**Browser walkthrough** — set `PP_TEST_MODE=1` (for "drop connection"). Run `bun run build`, then `fixtures:reset-load party-loot --profile verify`, then `start --profile verify` in the test agent's pane. Evidence per [AGENTS §9.6](../../AGENTS.md#96-browser-verification-test-agents). Contexts: **A** DM (`pw-dm`), **B** `player-1` / Mira (`pw-player-1`), **C** `player-2` / Thorn (`pw-player-2`). Every change shows ≤ 1 s in A, B and C. Record B's and C's bell badge counts in step 2.

| # | DM (A) | Players (B, C) | Expected |
|---|---|---|---|
| 1 | Log in, open Loot | — | Pot 5 pp, 30 gp. Wallets Mira 21 gp, Thorn 8 gp 30 sp. Log m4…m1, e5…e1 newest first. e3 shows 50 gp + "Edited". No per-item toasts |
| 2 | — | B, C open links, open Loot | Same pot, wallets and log. B's own wallet is Mira ("You", first); C's is Thorn. Move form shown; no add form, no Edit. "SECOND-CAMPAIGN-LOOT" not in the DOM |
| 3 | Add "Silver dagger" + 50 gp, Enter | — | Row on top; pot 5 pp, 80 gp. Toast "Party loot: Silver dagger (50 gp)" in A, B, C. New row in `note.history` |
| 4 | — | B closes Loot, opens Notifications, clicks "Open" on the dagger row | `loot.log` opens *(S5: the Party window opens on its Loot tab, FR-LOOT-22)* |
| 5 | Try Add with empty text and no coins, then with 1.5 gp | — | Add disabled / inline error; no entry anywhere |
| 6 | Edit "Silver dagger" to 5 gp, Save | — | Row shows 5 gp + "Edited"; pot 5 pp, 35 gp. No toast. B's `note.history` row reads "Party loot: Silver dagger (50 gp) (edited)" with no new row |
| 7 | Move Party pot → Thorn 5 pp | — | Row "Party pot → Thorn 5 pp". Pot 35 gp; Thorn 5 pp, 8 gp, 30 sp. No toast |
| 8 | — | C: From options are only Thorn and Party pot. Move Thorn → Mira 3 gp, note "Thanks" | Thorn 5 pp, 5 gp, 30 sp; Mira 24 gp. No toast |
| 9 | — | B: From Party pot; To lists only Mira. Move 10 gp | Pot 25 gp; Mira 34 gp |
| 10 | Add "Paid the ferryman" −40 gp | — | Pot shows "−15 gp" (muted). No toast in A, B, C; `note.history` counts unchanged |
| 11 | Add "Ruby" while C is dropped | C: "drop connection" (Probes window) | C shows the banner, then "Ruby" without a reload. No per-item toast. C's badge = step-2 count + 2 (dagger, Ruby) |
| 12 | Hard-kill + restart the server | — | All rejoin. Log, pot and wallets identical to step 11. No console errors |
| 13 | Switch to Second Campaign, then back | B, C wait, then rejoin | A first shows only "SECOND-CAMPAIGN-LOOT", pot 1 gp, "No characters"; then the Fixture Campaign state again. B and C unchanged |

Teardown: stop the server, then `fixtures:reset --profile verify`.

*(S5)* "Open Loot" in the steps above = Party → Loot tab. Sprint-5 tests (fixtures `party-loot`, `party-s5`): `FR-LOOT-21 no loot.log window` (both registries hold no window kind `loot.log` and both launchers no entry for that kind, asserted by kind, not by label, review #21; a stored layout with `loot.log` parses, the kind is dropped, other windows keep their geometry); `FR-LOOT-22 Open goes to the Loot tab` (Party closed / minimised / on Handouts → open on Loot); `FR-LOOT-23 sheet wallet link`; every existing `loot-*` client test passes with the body mounted in the tab. Walkthrough: [PARTY §13.1](party-board.md#131-sprint-5-track-p-party-loot-asset-cmp) step S5-8; the thin `party-loot` e2e opens Loot through Party.

*(Sprint 6, PF3)* Client tests on the add form (fixtures `party-loot`; walkthrough [play-shell §13](play-shell.md#13-test-plan) P13 on `prefs-s6`; the thin e2e has its own bundle `loot-subtract-e2e` (= `party-loot`; seams S12), so PF3 needs nothing from PF0): `FR-LOOT-25 subtract label` (gp −5 → "Subtract" / "Subtract from the pot", `data-mode="subtract"`; −2 gp + 15 sp → subtract; 3 gp → "Add" / "Add loot"; changes per keystroke); `FR-LOOT-26 hint` (`loot-add-hint` text in both modes; inside an edited row too); `FR-LOOT-27 disabled` (all coins empty → disabled; 0 → disabled; "−" → disabled; text "Rope" with no coins → disabled; text + 1 gp → enabled; not live / in flight → disabled as before); `FR-LOOT-28 edit form` (a text-only row's Save stays enabled after a text change; its button never reads "Subtract"). Step 5 of the walkthrough above now also expects "Rope" with no coins → disabled.

*(S9, track RS)* Bundle `reminders-strongholds` ([REM §13](reminders.md#13-test-plan)); units `hold-greystone-stores`, `hold-tower-secret`, `hold-tower-move` ([FR-HOLD-35](strongholds.md#6-functional-requirements)). Named tests (RS0 server, RS3 client): `FR-LOOT-30 stores pairing` (unit: `world ↔ stores` ok, `world ↔ party` still `invalid`); `FR-LOOT-31 stores-coin per viewer` (DM both rows, players Greystone only; flip on show / hide); `FR-LOOT-32 hidden Stores redaction` (Tower → pot reads `outside → party` for players, never `world → party`; `world → Tower` hidden; no tower id in any player frame or `party-item` load; no player entry carries `seq`; a 500-entry flip sends ≤ 100 entry changes; players' log order by `createdAt` matches the DM's `seq` order under the fixed clock); `FR-LOOT-36 DM-only Stores item` (HOLD-SECRET-GEM: no player row, frame, load or ledger row; Take → `not_found`; DM moves it to the party → visible from then on); `FR-LOOT-33 player Stores rights` (player-1: Greystone → pot ✓, Greystone → Mira ✓, Mira → Greystone ✓, Greystone → Thorn `forbidden`, Tower → pot `not_found`); **`FR-LOOT-34 Move to party from Stores`** (DOM: the Stores tab's "Move to party" preset; 50 gp commits as `CoinMoved`, pot + `stores-coin` change; items Take to Mira via `party.moveItem`); `FR-LOOT-36 per-holder caps and merge`; `FR-LOOT-38 delete moves Stores` (positive and negative coins; 2,500,000 gp → 3 entries ≤ 999,999; hidden Stores → empty text; party full → `conflict`, nothing written); `FR-LOOT-39 conservation` (after every command of the RS tests). Walkthrough: [HOLD §13](strongholds.md#13-test-plan) H7, H10, H13.

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [live-sync](live-sync.md), [protocol](../protocol/README.md) | Record-type registry with `window` (ADR-0029) and DB-computed providers (`SnapshotSource.db`), scope gate, intents, test-mode "drop connection" | complete; `window` built by `fix/combat-core` |
| [entities](entities.md) | `character` entities with `ownerPlayerId`; other characters redacted but named (FR-ENT-15); no delete (FR-ENT-14); fixtures `char-mira`, `char-thorn` | complete |
| [notifications](notifications.md) | `notify`, server kind registry, client view registries with a custom renderer, toasts, `note.history` | complete |
| [play-shell](play-shell.md), [campaign-management](campaign-management.md), [fixtures-adapters](fixtures-adapters.md) | Window registry, `useOpenWindow` (confirms `loot.log`, both, for OQ-SHELL-06); campaign scope + switch; `base`, `player-2`, `campaign-second`, bundle registry | complete |
| *(S5)* [party-board](party-board.md) | Loot tab, `openPartyTab` (FR-PARTY-29, -30); built in slice P3 `build/party-loot-tab` ([PARTY §14.2](party-board.md#142-sprint-5-build-split)): both `windows.ts` (delete LOOT's own `loot.log` line, seams S4), LOOT client folder, CHARX `MoreTabs.tsx` one call. No schema, no dependency | this track |

*(Sprint 9)* Slices **RS0** `fix/rs-core` (server: `Endpoint` in `src/shared/events/party-loot.ts` (shared file), `loot_entry` / `party_item` columns in `src/server/db/` (schema lane first), `stores-coin` record type registration, LOOT / PARTY commands, by assignment) and **RS3** `build/hold-stores` (client: `LootLog.tsx` Move options and log text, party-board `Inventory.tsx` filter, the Stores tab) per [HOLD §14](strongholds.md#14-dependencies). Seams S8: no FX item touches party-loot; SP3's recap read helper lands here after RS0 (Stores ends = moves). No dependency.

*(Sprint 6)* Slice **PF3** `fix/loot-subtract` ([play-shell §14](play-shell.md#14-dependencies)): `src/client/common/features/party-loot/LootLog.tsx` + its tests, one e2e on bundle `loot-subtract-e2e` (one append line in `fixtures/bundles/index.ts`, seams S12); no other shared file, no server change; runs at once, parallel to every other slice.

**Shared changes needed** (AGENTS §9.9; the orchestrator routes them)
- `src/server/db/`: table `loot_entry` (§8), index (campaignId, seq). `src/shared/events/party-loot.ts`: `LootAdded`, `LootEdited`, `CoinMoved`.
- Append-only lines: `partyLoot` in `src/server/features/index.ts`; record types `loot-entry` (with window), `party-pot`, `wallet`; `loot-received` in `kinds.ts` and in both `notification-views.ts`; `loot.log` in both `windows.ts`; `party-loot` in `fixtures/bundles/index.ts`.
- New shadcn file `scroll-area.tsx` in `src/client/common/components/ui/` (allowed as a new file; listed for visibility).
- Docs at merge (integrator): protocol rows (types, intents, events, kind, window, budget), data-model rows, FIX §8 fixture rows with their side effects, notifications OQ-NOTE-08 → decided by #146 (OQ-LOOT-12), glossary (OQ-LOOT-09).

## 15. Open questions

A **bold** option is the suggested pick unless the row says Decided.

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| ~~OQ-LOOT-01, 02, 05, 06~~ | ~~Entry shape; correction; coin total; loot notification~~ | **Decided (#146):** text + optional coins; DM **edits** (logged, "Edited"), no void; running total in MVP (spec: derived); `loot-received` info to all, toast + history | — | post-mvp/party-board, notifications |
| OQ-LOOT-03, 04 | 03: Can players add loot entries? 04: Should an entry reference an item entity? | 03: **No in MVP** (additive `addedByPlayerId` later) / yes. 04: **No MVP column; nullable `itemEntityId` later** / reserve the column now | no · owner: spec-party-loot | post-mvp/party-board, post-mvp/world-builder |
| OQ-LOOT-07 | Is `loot.log` open by default? | **Closed; the toast and the launcher open it** / open for players *(S5: superseded by FR-LOOT-21, #256: the Party window's rules apply)* | no · owner: spec-party-loot | play-shell |
| OQ-LOOT-08 | Gems (DM award, per character) and the loot log? | **Gems own their counters; a gem award may also call `partyLoot.add`; no MVP field** / gems as loot entries | no · owner: gems | post-mvp/gems |
| ~~OQ-LOOT-09~~ | ~~Glossary terms~~ | **Decided (#152):** glossary amends **Party loot** and adds **Loot entry**, **Party pot**, **Wallet**, **Coin move** | — | glossary |
| ~~OQ-LOOT-10~~ | ~~Does the tracker record spending, and is there a guard?~~ | **Decided (#150):** signed coins; no below-zero guard; negatives shown with "−"; the DM edits typos | — | post-mvp/party-board |
| ~~OQ-LOOT-11~~ | ~~Edit details~~ | **Decided (#150):** no notification on edit; "Edited" Badge for all; no delete. Spec adds the "(edited)" suffix on the notification row (FR-LOOT-14) | — | notifications |
| ~~OQ-LOOT-12~~ | ~~Stale "deferred" text in notifications / protocol~~ | **Decided (#152):** integrator marked OQ-NOTE-08 decided by #146; the build adds the `loot-received` row to protocol §23 | — | notifications, protocol |
| ~~OQ-LOOT-13~~ | ~~Do players see other PCs' wallets?~~ | **Decided (#152):** yes, every wallet (trusted table; moves already name both ends) | — | — |
| ~~OQ-LOOT-14~~ | ~~Coin from / to outside the party~~ | **Decided (#152):** DM only, via a move with a `world` end ("Outside the party") | — | — |
| ~~OQ-LOOT-15~~ | ~~Moves: notify? editable?~~ | **Decided (#152):** no notification; not editable, corrected by a reverse move | — | — |
| ~~OQ-LOOT-16~~ | ~~Wallet on `char.sheet`?~~ | **Decided (#152):** not in MVP; the loot window shows wallets | — | character-sheet |
| OQ-LOOT-17 | *(S5)* After the Loot tab [4], does the separate "Party loot" window stay? | **Decided (#256): no, it retires (window and launcher entry); every "open loot" link opens Party on Loot** (FR-LOOT-21–23). Rejected: ~~B keep both~~. *How (settled by seams S4):* P3 deletes LOOT's own `loot.log` line from both `windows.ts` (the owning feature may delete its own line from an append-only registry) | — | play-shell |
| OQ-LOOT-18 | *(S5)* **character-sheet-full**: the wallet link (FR-LOOT-23) is a CHARX file | **Settled by seams S4:** P3 changes the one call (`openPartyTab("loot")`), granted; no sheet UI change | no · settled | character-sheet-full |
| OQ-LOOT-19 | *(S6)* "Disabled for empty or zero" (#285 [3]) with **text but no coins** (e.g. "Rope") | **Decided (#288): A (disabled without a coin).** Options as framed: **A. Disabled: coins decide, as the DM said; items go to the party Inventory; the server still accepts text-only entries (fixtures, old rows)**: one clear rule / B. Text alone still enables Add (today's FR-LOOT-02 rule): keeps loot notes without coin, but "disabled for empty or zero" then only applies to the coins | — · decided | FR-LOOT-27 |
| OQ-LOOT-20 | *(S6)* Mixed signs (−2 gp, +15 sp: making change): which label? | **Decided (#288): A ("Subtract" when any coin is negative).** Options as framed: **A. "Subtract" whenever any coin is negative**: matches the server's spend rule (no toast), one test / B. "Add / subtract": exact, but a third label for a rare case | — · decided | FR-LOOT-25 |
| OQ-LOOT-21 | *(S9)* **DM:** what may players do with a stronghold's Stores? | **A. As with the party pot: Stores ↔ party, Stores → own character, own character → Stores (coin and items), for shown strongholds** / B. DM only; players just see them. *Tradeoff:* A makes "take the arrows from the stores" self-service like the pot; B keeps the DM as gatekeeper | yes | FR-LOOT-33 |
| OQ-LOOT-22 | *(S9)* **DM:** ledger rows that touch a **DM-only** Stores (e.g. the DM moves 5 gp from a hidden vault to the party) | **A. Players see the hidden end as "Outside the party" (an `outside` end, never the forbidden `world ↔ party` move shape); a row with nothing party-side is hidden; a deleted hidden stronghold's moves carry no text** / A′. As A, but a party ↔ hidden-Stores coin move is shown to players as an ordinary loot / spend row (indistinguishable from the DM's awards) / B. Hide every such row (the pot changes without a visible row) / C. Show the row with the stronghold's name (leaks the hidden stronghold; rejected). *Tradeoff:* A keeps the pot explained without naming the secret, but an `outside` end tells players "some hidden holder exists"; A′ hides even that, at the cost of rewriting the row's kind for players | yes | FR-LOOT-32 |
| OQ-LOOT-23 | *(S9)* **FX / SP (seams):** other tracks in party-loot | **Closed per seams S8:** RS0 owns the ledger change (`stores` end, `party_item.stronghold_id`, `stores_hidden`); no FX item touches party-loot; SP3's loot read helper (in this folder, by assignment) lands after RS0 and counts any Stores end as a **move** (left out of the recap), so a DM-only Stores never reaches a player's recap (SP's leak test) | — · closed (S8) | FX, SP |

## 16. Out of scope

- See §4. Owners: [party-board](post-mvp/party-board.md) (inventory, gold split, handouts, notes), [gems](gems.md), [character-sheet](character-sheet.md) (wallet on the sheet, OQ-LOOT-16). Also out: load older, edit history UI, item refs, player-added loot (OQ-LOOT-03, 04).
- *(S9)* Stores automation (upkeep / wages paid from Stores, income into Stores: BL-73 "not in"), Stores in the Loot tab's strip. (Per-item DM-only Stores rows moved in: OQ-HOLD-12.)
