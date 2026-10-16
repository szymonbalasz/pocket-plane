---
title: Party board
prefix: PARTY
status: in-review
owner: spec-party-board
phase: post-mvp-3
---

# Party board

> Five-minute read. Bullets over prose. See [AGENTS.md](../../AGENTS.md). Picks marked **bold** are suggestions for DM gate 1, not decisions ([§15](#15-open-questions)).

## 1. Summary

- A **Party** window, both clients, replacing Miro for the table: **handouts** the DM shares with everyone or chosen players, and a **party inventory** that items move in and out of (DM [#203](../decisions-log.md): "party board + handouts"; tier A in [feature tiers §4](../feature-tiers.md#4-notes-handouts-world-and-party)).
- A **handout** = title + plain text + 0–10 images (assets pipeline, capability IDs per [ADR-0023](../architecture/adr/0023-asset-access-by-capability-id.md)). The DM prepares it unshared, then shares it with everyone or chosen players, and can revoke. A player who isn't a recipient never receives its ID, title, text or image IDs.
- The **gold ledger** is [party-loot](party-loot.md) evolved, not replaced: item moves join the same log, plus a DM **split** of the party pot.
- Board data **loads when the window opens** (proposed [lazy record types](../architecture/adr/proposed-lazy-record-types.md)): measured +0 B on every snapshot ([§12](#12-performance--bandwidth)).

## 2. Scope

- Record types `handout` (header) and `handout-body`, one table; `party-item`. All campaign scope, **lazy** (OQ-PARTY-03).
- Intents `party.createHandout`, `party.updateHandout`, `party.shareHandout`, `party.deleteHandout` (DM); `party.addItem`, `party.editItem`, `party.removeItem` (DM); `party.moveItem` (DM, player); `loot.split` (DM).
- Notification kind `handout-shared` (info). Item adds reuse LOOT's `loot-received`.
- Party-loot evolves: `loot-entry` kind `item` (+ `qty`), `loot.split`, item rows in `loot.log` (OQ-PARTY-05, OQ-PARTY-16).
- Windows `party.board` "Party" (tabs Handouts, Inventory) and `party.handout` (viewer), both clients (OQ-PARTY-08).
- Fixtures + bundle `party-board`.

## 3. Goals

- The DM shares a prepared handout with one player in ≤ 3 clicks; the player sees a toast and can open it ≤ 1 s after commit.
- No leak: a non-recipient's socket never carries a handout's ID, title, text or image asset IDs: snapshot, events, load results, notifications; before and after reconnect.
- Items and coin move between the party and characters in ≤ 10 s, each move logged, conserved and crash-safe (one transaction).
- CON-44 unchanged: heavy DM headroom stays ≥ 100 KiB.

## 4. Non-goals

- PDF handouts (OQ-PARTY-02), rich text / markdown, handout folders, DM reordering, handouts authored by players.
- Player pins, annotations, comments; shared party notes (tier B, OQ-PARTY-07).
- Item entities / compendium links on items (OQ-PARTY-13), weight, item value, selling helpers.
- Coin conversion ("making change"), player-initiated splits (OQ-PARTY-06).
- Undo (combat only, [ADR-0016](../architecture/adr/0016-domain-events-pending-actions.md)): corrections are edits, revokes and reverse moves.

## 5. User stories

**DM**
- As the DM, I want to prepare the mayor's letter before the session and share it with everyone when they open it, so nobody waits for me to paste it into Miro.
- As the DM, I want to give the rogue alone a thieves'-guild map, and take it back if I shared it by mistake.
- As the DM, I want to put 10 torches and 2 potions into the party inventory and split 30 gp between the PCs in one step.

**Player**
- As a player, I want a toast and a list of every handout I've been given, marked New until I read it, and still there after a reload.
- As a player, I want to take a potion from the party stash onto my sheet, or give my spare bolts back, without asking the DM.

## 6. Functional requirements

`env` = `CommandEnv`; campaign = `env.actor.campaignId`; IDs and time from `env.ctx` ([ADR-0022](../architecture/adr/0022-deterministic-seams.md)). "Clean text" = trimmed, control characters removed (body keeps `\n` and `\t`; `\r\n` → `\n`). Every command is one transaction with its event-log row and notifications ([ADR-0027](../architecture/adr/0027-notification-creation.md)).

### 6.1 Handouts

| ID | Requirement | Notes |
|---|---|---|
| FR-PARTY-01 | Table `handout` (§8). Two record types read from it: `handout` (header: no body) and `handout-body` (`{id = handoutId, campaignId, body, rev, reveal}`). Both campaign scope, **lazy**: never in a snapshot, loaded with `sync.load` (proposed ADR). ≤ 200 handouts per campaign; the 201st create → `conflict` "Handout limit reached (200)". | OQ-PARTY-03 |
| FR-PARTY-02 | Handout input (strict zod, create and update): `title` clean, 1–80 chars; `body` clean, 0–10 000 chars; `imageAssetIds` 0–10, unique, each checked with `assets.require` (other campaign / unknown → `not_found`). | ADR-0023 |
| FR-PARTY-03 | `party.createHandout {title, body, imageAssetIds}` (DM): row with `reveal {mode: none, playerIds: []}`, `rev` 1, `sharedAt` null. Emits `HandoutCreated` (changes: header, body). Result `{handoutId}`. No notification. | |
| FR-PARTY-04 | `party.updateHandout {handoutId, title, body, imageAssetIds}` (DM): full replacement. Unknown / other campaign → `not_found`. Same values → `ack`, no write, no event. Else `rev` + 1, `updatedAt`; emits `HandoutUpdated` (changes: header; body only if `body` changed). No notification; clients mark it Updated (FR-PARTY-13). | |
| FR-PARTY-05 | `party.shareHandout {handoutId, reveal}` (DM). `reveal = {mode: none \| all \| players, playerIds}`; `players` needs 1–20 unique ids, each a player of the campaign (else `not_found`); `none` / `all` need `[]` (else `invalid`). Same as stored → `ack`, no event. Else update; `sharedAt` = now iff some player newly gains access (FR-PARTY-06); emits `HandoutShared {handoutId, before, after}` (changes: header, body). `all` covers players added later. | OQ-PARTY-01 |
| FR-PARTY-06 | Notification `handout-shared` (owner PARTY, info, no action, payload `{handoutId}`, text "New handout: ‹title›", cut to 280). Gainers G = players who see it after and not before (`all` = every player of the campaign at commit). `none` → `all`: one notification, audience `all`. Otherwise one per player in G, audience `player`. G empty → none. Revoke, update, delete → none. | [FR-NOTE-02/04](notifications.md#6-functional-requirements) |
| FR-PARTY-07 | Visibility `handout` and `handout-body`: DM full. Player **hidden** unless `reveal.mode = all` or their id ∈ `reveal.playerIds`. Visible header is **redacted**: `reveal` → `{mode: all \| players}` (no ids). Visible body drops `reveal`. So a reveal change is an upsert to gainers and a delete to losers (record-change rule). | [ADR-0021](../architecture/adr/0021-sync-protocol-conventions.md) B, OQ-PARTY-10 |
| FR-PARTY-08 | `party.deleteHandout {handoutId}` (DM): deletes the row; emits `HandoutDeleted` (changes: header, body → null). Its notifications stay. `not_found` as FR-PARTY-04. | |
| FR-PARTY-09 | Revoke / delete on an open view: the delete arrives, the row leaves the list, an open viewer shows "No longer shared" (`party-handout-gone`), no error toast. A notification's "Open" for a handout not in the store opens the viewer on the same message. Bytes already fetched stay cached (ADR-0023, accepted). | |
| FR-PARTY-10 | Client loading: opening `party.board` loads `handout` (all visible) via `useLazyRecords`; opening a handout loads its `handout-body` by id if not in the store. A load that comes back without the id → FR-PARTY-09's message. After any snapshot (reconnect, resync) an open board / viewer reloads. While loading: skeleton rows; load reject → inline "Couldn't load — Retry". | proposed ADR |

### 6.2 Party window and viewer

| ID | Requirement | Notes |
|---|---|---|
| FR-PARTY-11 | Window `party.board` "Party", both clients, closed by default, `center` 480×600, min 340×360, launcher "Party". Tabs **Handouts**, **Inventory**; tab choice per browser with the layout. A "Coin: open Party loot" link opens `loot.log`. Launcher `activity` dot ([FR-SHELL-38](play-shell.md#6-functional-requirements)) when a handout arrives or is updated while minimised. | OQ-PARTY-08 |
| FR-PARTY-12 | DM Handouts tab: "New handout" Button; list of every handout, newest `seq` first. Row: thumb of the first image (if any), title, share Badge ("Not shared" muted / "Everyone" / player names), Updated time. Click → opens `party.handout` on it. Row menu: Edit, Share…, Delete (inline confirm). Empty: "No handouts yet". | |
| FR-PARTY-13 | Player Handouts tab: visible handouts, newest `sharedAt` first. Row: thumb, title, "Shared with you" / "Everyone", **New** Badge while `rev` > the browser's seen rev. Opening it marks it seen. Seen map: `localStorage` `pp.party.v1.<campaignId>.<playerId>` = `{seen: {handoutId: rev}}` (zod, ≤ 500 entries, oldest dropped); invalid / unavailable → memory only, console warning (as FR-SHELL-17). Empty: "No handouts yet". | OQ-PARTY-09 |
| FR-PARTY-14 | Window `party.handout` "Handout", both clients, closed by default, `center` 720×640, min 360×320: the selected handout (client state, never sent). Title, images in order (`display` derivative, fit to width; click toggles 100 %), then the body as plain text with line breaks kept (never HTML). DM extras: share Badge, Edit, Share… Buttons. | |
| FR-PARTY-15 | DM editor (in `party.handout`, Edit or New): title Input, body Textarea with a counter, images strip (add via the asset picker, [FR-ASSET-17](assets-pipeline.md#6-functional-requirements); remove; move left / right), Save / Cancel. Save disabled while invalid (FR-PARTY-02 mirrored), unchanged, not `live` or in flight. `reject` → inline message, values kept. Lost intent → Toast "Connection lost — check the handout before saving again". A remote change to the open handout keeps the draft and shows "Changed in another tab". | as FR-LOOT-17 |
| FR-PARTY-16 | DM Share… dialog: radio **Not shared / Everyone / Chosen players**, a checkbox per player (name, online dot) under Chosen; "Share" disabled while Chosen has none ticked, unchanged, not `live` or in flight. A one-click **Share with everyone** Button sits next to it in the viewer. | |

### 6.3 Party inventory

| ID | Requirement | Notes |
|---|---|---|
| FR-PARTY-17 | Table `party-item` (§8), record type `party-item` campaign scope, **lazy**, visibility: DM full, player full (own campaign, scope gate), as LOOT-10. ≤ 60 rows per campaign. | OQ-PARTY-04 |
| FR-PARTY-18 | Item input (strict zod): `name` clean 1–60, `qty` int 1–9 999, `notes` clean 0–120 (same bounds as the sheet's `items`, [CHARX §8](character-sheet-full.md#8-data-model)). **Merge key** = (`name` trimmed, case-insensitive; `notes` exact). | |
| FR-PARTY-19 | `party.addItem {name, qty, notes}` (DM): merge into the party row with the same key (qty sum > 9 999 → `conflict`) or insert (61st row → `conflict` "Party inventory is full (60)"). Writes a `loot-entry` kind `item` `world → party` (FR-PARTY-23) and a `loot-received` notification "Party loot: ‹name› ×‹qty›" (all). Emits `PartyItemAdded` (changes: party-item, loot-entry). Result `{itemId}`. | amends FR-LOOT-13 |
| FR-PARTY-20 | `party.editItem {itemId, name, qty, notes}` (DM): full replacement, no log row, no notification; a key clash with another row → `conflict` "Same item exists — move or remove one". Same values → `ack`, no event. Emits `PartyItemEdited {itemId, before, after}`. | |
| FR-PARTY-21 | `party.removeItem {itemId, qty}` (DM; sold / used up): `qty` ≥ 1; more than the row holds → `conflict` "Only ‹n› left"; row qty − `qty`, row deleted at 0. Writes `loot-entry` kind `item` `party → world`. Emits `PartyItemRemoved`. | |
| FR-PARTY-22 | `party.moveItem {from, to, qty, itemId?, rowId?}` (strict). Ends `party` \| `character` (+ `characterId`, a character of the campaign, else `not_found`), `from ≠ to`. From `party` needs `itemId`; from a character needs `rowId` of that sheet's `items` (else `not_found` "Item is gone"). `qty` ≥ 1; more than the source holds at commit → `conflict` "Only ‹n› left". The source row is reduced (deleted at 0, incl. an equipped sheet row); the target merges by key or appends (sheet: `equipped: false`). Caps: party 60 rows, sheet 80 rows ([FR-CHARX-16](character-sheet-full.md#6-functional-requirements)), qty 9 999 → `conflict` naming the full side. Writes `loot-entry` kind `item`. Emits `ItemMoved {entryId, from, to, name, qty}` (changes: party-item, each changed `creature-sheet`, loot-entry). Sheet writes go through CHARX's helper (OQ-PARTY-17). | |
| FR-PARTY-23 | Authorization (as [FR-LOOT-07](party-loot.md#6-functional-requirements)): DM any move. Player: own character → `party` or another character; `party` → own character. Else `forbidden`. Own = `ownerPlayerId` at commit. **Sheet lock and draft status don't block** a move. | OQ-PARTY-11 |
| FR-PARTY-24 | Inventory tab: rows sorted by name: name, qty, notes. Everyone: **Take** (to one of the viewer's own characters; picker if > 1; qty Input) and **Give…** (source = one of the viewer's own characters' sheet items; target = Party or another character). DM: Add form (name, qty, notes; Enter submits), row Edit, Remove (qty), and Move to any character. Locks, reject and lost-intent rules as FR-LOOT-16. Player with no character → Take / Give hidden. Empty: "Party inventory is empty". | |

### 6.4 Gold ledger (party-loot evolved)

| ID | Requirement | Notes |
|---|---|---|
| FR-PARTY-25 | `loot-entry` gains kind `item`: `text` = item name (1–60), `qty` 1–9 999 (null on other kinds, on the wire only when set), coins all 0, ends as FR-PARTY-19/21/22. Pot and wallet sums are unaffected (coins 0). `loot.edit` on an item row → `conflict` "Item moves can't be edited — move it back". `loot.log` renders "‹from› → ‹to›: ‹name› ×‹qty›" ("Party", "Outside the party"). | OQ-PARTY-05 |
| FR-PARTY-26 | `loot.split {characterIds, cp?, sp?, ep?, gp?, pp?}` (DM; player → `forbidden`): 1–10 unique characters of the campaign (`not_found`); each coin int 0…999 999. Share per coin = ⌊coin / n⌋, the remainder stays in the pot; all shares 0 → `invalid` "Nothing to split". One `move` row `party → character` (text "Split") per character, in list order. No balance check (#150). Emits `CoinSplit {entryIds, characterIds, shares}` (changes: entries, `party-pot`, each `wallet`). No notification. | OQ-PARTY-06 |
| FR-PARTY-27 | `loot.log` DM "Split…" Button: coin Inputs prefilled with the pot's positive coins; a checkbox per character (approved characters ticked); preview "Each gets ‹coins›, ‹coins› stays in the pot"; Split disabled while invalid, not `live` or in flight. | |

### 6.5 Fixtures

| ID | Requirement | Notes |
|---|---|---|
| FR-PARTY-28 | Fixtures `handout-images`, `handouts-1`, `party-items-1`, `party-second` and bundle `party-board` (§13). `fixtures:reset-load party-board` works from empty and is deterministic ([FR-FIX-08](fixtures-adapters.md#6-functional-requirements)). | ADR-0017 |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md): shadcn Tabs, Input, Textarea, Button, Badge, Dialog, RadioGroup, Checkbox, ScrollArea, Toast, Skeleton. Dark only. No custom styling.

- **States:** empty texts per FR-PARTY-12/13/24; loading = Skeleton rows (FR-PARTY-10); load error = inline Retry; disconnected = last view + reconnect banner, every form and action disabled; revoked = "No longer shared".
- **DM view:** every handout incl. unshared prep; editor, Share…, Delete; inventory with Add / Edit / Remove / Move; `loot.log` gains Split… and item rows. The DM's own `all` notifications toast (as loot).
- **Player view:** only handouts shared with them, New / Updated marks, read-only viewer; inventory with Take / Give…; `loot.log` shows item rows. Toast per handout shared with them, none on revoke or edit.
- **Test IDs** (AGENTS §9.5, prefix `party-`): `party-board`, `party-tab` + `data-value`, `party-loot-link`, `party-handout-list`, `party-handout-empty`, `party-handout-row` + `data-record-id` + `data-shared` (`none|all|players`) + `data-new`, `party-handout-new`, `party-handout-menu`, `party-handout-delete`, `party-handout-delete-confirm`, `party-handout-view` + `data-record-id`, `party-handout-title`, `party-handout-body`, `party-handout-image` + `data-record-id` (asset id), `party-handout-gone`, `party-handout-loading`, `party-handout-retry`, `party-handout-edit`, `party-editor-title`, `party-editor-body`, `party-editor-add-image`, `party-editor-image` + `data-record-id`, `party-editor-save`, `party-editor-cancel`, `party-editor-error`, `party-share-open`, `party-share-everyone`, `party-share-mode` + `data-value`, `party-share-player` + `data-record-id`, `party-share-submit`, `party-share-error`, `party-item-list`, `party-item-empty`, `party-item-row` + `data-record-id`, `party-item-take`, `party-item-give`, `party-item-qty`, `party-item-target` + `data-value`, `party-item-source` + `data-record-id`, `party-item-submit`, `party-item-error`, `party-item-add-name`, `party-item-add-qty`, `party-item-add-notes`, `party-item-add-submit`, `party-item-edit`, `party-item-remove`; in `loot.log`: `loot-split-open`, `loot-split-coin` + `data-value`, `loot-split-character` + `data-record-id`, `loot-split-preview`, `loot-split-submit`, `loot-split-error`; `loot-entry` gains `data-kind="item"`.

## 8. Data model

| Entity | Field | Type | Notes |
|---|---|---|---|
| Handout (`handout`) | id, campaignId, seq | ID, ID → Campaign, int | `env.ctx.ids`; seq = DB order |
| | title | text 1–80 | Plain text |
| | body | text 0–10 000 | Only in `handout-body` |
| | imageAssetIds | **JSON leaf**, 0–10 asset IDs | Each via `assets.require` |
| | reveal | **JSON leaf** `{mode: none \| all \| players, playerIds: ID[] ≤ 20}` | The only visibility input (FR-PARTY-07) |
| | rev | int ≥ 1 | +1 per content update (New / Updated marks) |
| | createdAt, updatedAt, sharedAt | timestamp ×2, timestamp \| null | `sharedAt` set when someone gains access |
| Party item (`party-item`) | id, campaignId, seq | ID, ID, int | ≤ 60 per campaign |
| | name, qty, notes | text 1–60, int 1–9 999, text 0–120 | Merge key (name ci, notes) |
| | createdAt, updatedAt | timestamp ×2 | |
| Loot entry (`loot-entry`, LOOT-owned) | kind | + `item` | FR-PARTY-25 |
| | qty | int 1–9 999 \| null | New column; item rows only |

- **Relations:** campaign 1–n handout, 1–n party item. Handout → assets by ID (no FK, assets have no delete). `reveal.playerIds` → players (no delete in MVP, OQ-CAMP-08). A move's sheet side lives in CHARX's `creature-sheet.items` JSON leaf.
- **Derived values:** player share label, New / Updated marks (client, localStorage seen revs), split shares and preview, item-row text (`@shared/party-board`).
- **Persisted runtime state:** none beyond rows. Seen revs are browser-only (never sent). Indexes: `handout (campaignId, seq)`, `party_item (campaignId, seq)`.
- **Later (additive):** `party_item.itemRef` (OQ-PARTY-13), `handout.folder`, player pins.

## 9. API & events

**REST:** none (images upload through the existing DM asset upload).

**Record types** (campaign scope)

| Type | Data | DM | Player | Snapshot |
|---|---|---|---|---|
| `handout` | `{id, campaignId, seq, title, imageAssetIds, reveal, rev, createdAt, updatedAt, sharedAt}` | full | FR-PARTY-07: hidden, or redacted `reveal {mode}` | **lazy**; `sync.load` |
| `handout-body` | `{id, campaignId, body, rev, reveal}` | full | hidden, or full minus `reveal` | **lazy**; `sync.load {ids}` |
| `party-item` | `{id, campaignId, seq, name, qty, notes, createdAt, updatedAt}` | full | full | **lazy**; `sync.load` |
| `loot-entry` (LOOT) | + kind `item`, `qty` | full | full | unchanged window 100 |

**WS intents** (none optimistic)

| Intent | Who | Validation / ownership | Result |
|---|---|---|---|
| `party.createHandout {title, body, imageAssetIds}` | DM | FR-PARTY-02; cap → `conflict` | `{handoutId}` |
| `party.updateHandout {handoutId, title, body, imageAssetIds}` | DM | FR-PARTY-02; `not_found` | — |
| `party.shareHandout {handoutId, reveal}` | DM | FR-PARTY-05 | — |
| `party.deleteHandout {handoutId}` | DM | `not_found` | — |
| `party.addItem {name, qty, notes}` | DM | FR-PARTY-18; caps → `conflict` | `{itemId}` |
| `party.editItem {itemId, name, qty, notes}` | DM | FR-PARTY-18, 20 | — |
| `party.removeItem {itemId, qty}` | DM | FR-PARTY-21 | `{entryId}` |
| `party.moveItem {from, to, qty, itemId?, rowId?}` | DM, player | FR-PARTY-22, 23 | `{entryId}` |
| `loot.split {characterIds, cp?…pp?}` | DM | FR-PARTY-26 | `{entryIds}` |
| `sync.load {type, ids?}` (proposed ADR) | DM, player | lazy types only | `{records}` |

Players sending a DM-only intent → `forbidden`, no change.

**WS events** (domain events; generic record changes; all logged; none undoable or transient)

| Event | Payload | Changes | Visibility rule |
|---|---|---|---|
| `HandoutCreated` | `{handoutId}` | handout, handout-body | FR-PARTY-07: DM only (unshared) |
| `HandoutUpdated` | `{handoutId, rev}` | handout; handout-body if body changed | FR-PARTY-07: DM + current recipients |
| `HandoutShared` | `{handoutId, before, after}` (reveals) | handout, handout-body | FR-PARTY-07 per side: gainers upsert, losers delete, others nothing. Payload reaches clients only as filtered record changes |
| `HandoutDeleted` | `{handoutId}` | handout, handout-body → null | DM + recipients before (delete) |
| `NotificationCreated` (`handout-shared`) | per NOTE | notification | FR-NOTE-06: audience `all` or the gainer only |
| `PartyItemAdded` / `PartyItemEdited` / `PartyItemRemoved` | `{itemId, …}` | party-item; loot-entry (add, remove) | DM + every player of the campaign |
| `NotificationCreated` (`loot-received`, item add) | per NOTE | notification | all |
| `ItemMoved` | `{entryId, from, to, name, qty}` | party-item, creature-sheet(s), loot-entry | party-item, loot-entry: everyone; creature-sheet: CHARX's fn (owner + DM full; others summary) |
| `CoinSplit` | `{entryIds, characterIds, shares}` | loot-entries, party-pot, wallets | everyone (LOOT-10) |

- Each event is its own `event` frame, before the sender's `ack` ([FR-SYNC-14](live-sync.md#6-functional-requirements)). Notifications follow their command's event in the same transaction.

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Create / edit / share / revoke / delete handout | ✓ | ✗ | role (`forbidden`); campaign (`not_found`) |
| See a handout (list, body, images) | all | `all` or listed | FR-PARTY-07, every path |
| Add / edit / remove party item; split pot | ✓ | ✗ | role |
| Move item: own character → party / other character; party → own | ✓ | ✓ | FR-PARTY-23 at commit |
| Move item: any other | ✓ | ✗ | `forbidden` |
| See party inventory, item log | all | own campaign | scope gate |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** lazy rows aren't in the snapshot; an open board / viewer reloads (FR-PARTY-10) and gets only what is visible now: a handout revoked while away is simply absent (no delete needed). Missed shares show on the bell (`handout-shared`), no per-item toasts. Seen marks are local and survive.
- **DM disconnect / reconnect:** players unaffected, can keep moving items. DM forms disabled; a lost intent → toast (FR-PARTY-15/24); the reconnect load shows whether it committed.
- **Server crash mid-action:** each command commits with its event-log row, loot entry and notifications or not at all; a move's party row and sheet row change together. After a restart, loads equal the pre-crash state (digest identical).
- **Revoke while open:** delete arrives → "No longer shared" (FR-PARTY-09). Revoke racing a body load: the load runs in frame order, so it either predates the revoke (then the delete follows) or omits the id.
- **Concurrency:** commands serialise. Two players taking the last potion → the second gets `not_found` "Item is gone" (row deleted at 0), or `conflict` "Only ‹n› left" if some remain (FR-PARTY-22). DM edits a party row while a player takes from it → whichever commits first; the other rechecks at commit. A sheet row deleted by its owner before a give → `not_found` "Item is gone". Two DM tabs editing a handout → last write wins, the other tab's editor keeps its draft with a hint.
- **Share edge:** sharing with `players` that equals every current player is still `players` (a player added later doesn't get it); the dialog says so. Share to `all` from `players` notifies only the new gainers.
- **Notifications after revoke:** a recipient's history row keeps "New handout: ‹title›" (already seen; OQ-PARTY-15); its Open shows "No longer shared".
- **Campaign switch:** `4409`; the next snapshot and loads are the new campaign's only.
- **Invalid / malicious input:** over-long fields, control characters, foreign or unknown asset / player / character ids, `rowId` of another sheet, qty 0 / negative / fractional, strict-key violations → `invalid` / `not_found`. Body rendered as text, never HTML. Inbound frames > 64 KB closed by live-sync: a 10 000-char body is ≤ 30 KB even at 3 B per char.

## 12. Performance & bandwidth

**CON-44, measured** (throwaway probe on the realistic-heavy harness, `session-sim` + `buildRealisticHeavy`, max-length ASCII; frame bytes as `snapshotSizes`; probe deleted). Board: 30 handouts (20 text, 10 with 3 images; 20 shared with all, 5 with player-1, 5 unshared), 60–100 party items.

| Variant | Heavy DM (base 676,050 B) | Player-1 (25 visible) | Other players (20 visible) |
|---|---|---|---|
| **Lazy (pick)**: handout, handout-body, party-item off the snapshot; `loot-entry.qty` | **+1,100 B** (100 item rows, worst) → 677,150 B, 109,282 B left | +1,100 B | +1,100 B |
| Headers in snapshot (3 images) | +12,932 | +9,912 | +7,632 |
| Headers in snapshot (10 images) | +14,682 | +10,787 | +7,632 |
| + bodies inline at 2,000 / 4,000 / 10,000 chars | +73,322 / +133,322 / +313,352 | +60,237 / +110,237 / +260,262 | +47,892 / +87,892 / +207,912 |
| + 100 max party items in snapshot | +39,915 | +39,915 | +39,915 |

- Only the lazy variant keeps the fog CON-44 test's ≥ 100 KiB DM headroom (102,400 B; ~8 KB spare today). Putting `name` + `qty` in a nested object instead of reusing `text` cost +9,000 B; rejected.
- **Load results** (`sync.load` ack, DM view): 30 headers 16,712 B; 100 headers 55,562 B; 200 (cap) ≈ 111 KB; 60 items (cap) 24,005 B. One body ≤ 10,107 B ASCII, ≤ 30,107 B worst UTF-8. All far below the 4 MiB frame limit.
- Tunnel: a share sends one header (~450 B) + body (≤ 30 KB) per gainer; images are fetched by players as `display` derivatives (1–3 MB each, cached forever). 6 players × 3 images at 10 Mbit/s ≈ 5–15 s for the first view, as a map.
- Rates: human-paced (a few shares / moves per session). Grouped `SUM` for pot / wallets unchanged.

## 13. Test plan

Isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)); loop per [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md). `bun test` on `:memory:`, port 0. Tests named after FRs.

**Fixtures** (`fixtures/units/party-board/`; setups as DM through PARTY commands, fixed clock)

| Key | Requires | Contents | Side effects |
|---|---|---|---|
| `handout-images` | `campaign` | Ingests committed SVGs `fixtures/assets/handouts/thieves-map.svg`, `wanted-poster.svg` (assets used by no scene or token) | 2 assets |
| `handouts-1` | `handout-images`, `player-2`, `images` | h1 "Mayor's Letter" (text, 3 lines) → all. h2 "PARTY-P1-ONLY Thieves' Map" (thieves-map + text) → players [player-1]. h3 "Secret Orders" body "PARTY-SECRET-3" → unshared. h4 "Old Bounty" body "PARTY-REVOKED-4" → all, then none. h5 "Ship Manifest" body "PARTY-PREP-5" → unshared. `wanted-poster` stays unused (walkthrough step 3) | 3 `handout-shared`: h1 all, h2 player-1, h4 all (row and h4's id stay after the revoke, OQ-PARTY-15) |
| `party-items-1` | `char-mira-full`, `char-thorn`, `loot-wallets` | add Potion of healing ×2, Torch ×10, Rope (50 ft) ×1; move Torch ×2 party → Thorn | 3 `loot-received`; 4 item log rows |
| `party-second` | `campaign-second` | Activate Second; "SECOND-CAMPAIGN-HANDOUT" → all; item "SECOND-CAMPAIGN-ITEM"; re-activate Fixture Campaign | notifications in Second |

- **Bundle `party-board`** = `base` + `player-2` + `images` + `char-mira` + `char-thorn` + `char-mira-full` + `campaign-second` + `loot-1` + `loot-wallets` + `handout-images` + `handouts-1` + `party-items-1` + `party-second`. Pot 5 pp, 30 gp (LOOT).

| Level | What | Fixtures |
|---|---|---|
| Unit | zod: title / body clean + bounds, 10 001 chars, 11 images, duplicate ids, reveal shapes (`none` with ids, `players` empty, 21 ids) → `invalid`; item bounds, merge key (case, notes); split shares + remainder, "Nothing to split". Visibility fns: `FR-PARTY-07` DM full / gainer redacted / non-recipient hidden for both types, `all` covers a later player. Gainers set G for every transition (none→all, none→players, players→all, all→players, →none). Notification text cut. Client: list order DM / player, New / Updated from seen revs (bad storage → memory), share label, item-row text, split preview, Take / Give options per role, form locks, lost-intent toasts | in-code |
| Integration | Commands: each FR-PARTY-03…08, 19…23, 26 incl. no-op `ack`, `not_found` across campaigns, caps (`conflict`), events before `ack`, notification in the same tx (`notify` forced to throw → nothing written). **Leak tests** (`FR-PARTY-07 leak`): player-2's frames (snapshot, every event, `sync.load` acks for `handout`, `handout-body` by h2/h3 ids) never contain "PARTY-P1-ONLY", "PARTY-SECRET-3", "PARTY-REVOKED-4", "PARTY-PREP-5", h2 / h3 / h5 ids or the thieves-map / wanted-poster asset ids (h4's id and title do reach them, in the pre-revoke notification) — **before and after a reconnect**, and after share-to-player-1 → share-all → revoke (player-2 got upsert then delete; a fresh reconnect + load has nothing). Second-campaign strings never in Fixture Campaign frames. Revoke: player-1 receives deletes for header and body. Moves: authorization matrix, merge both ways, row deleted at 0 incl. equipped, caps per side, sheet + party + log in one tx (crash hook `party.moveItem:before-commit` → nothing changed), conservation of item qty (Σ party + Σ sheets + Σ world ends). Convergence with the loaded set (proposed ADR helper). Restart on the same DB → identical loads. Two loads → identical IDs | `party-board` |
| E2E (thin) | DM shares h5 "Ship Manifest" with player-1 → player-1 toast + opens it; player-2's board has no h5; player-1 takes a potion → Mira's Inventory tab shows it | `party-board` |

**Browser walkthrough** — `PP_TEST_MODE=1`; `bun run build`; `fixtures:reset-load party-board --profile verify`; `start --profile verify` in the test agent's pane. Contexts **A** DM (`pw-dm`), **B** `player-1` / Mira (`pw-player-1`), **C** `player-2` / Thorn (`pw-player-2`). Every change ≤ 1 s. Leak scan = search C's WS frames and DOM for the listed strings / ids.

| # | DM (A) | Players (B, C) | Expected |
|---|---|---|---|
| 1 | Open Party | — | Handouts h5, h4, h3, h2, h1 with shares Not shared, Not shared, Not shared, Player 1, Everyone. Inventory: Potion ×2, Rope ×1, Torch ×8 |
| 2 | — | B, C open Party | B: h2, h1 (New). C: h1 only. Leak scan C: "PARTY-P1-ONLY", "PARTY-SECRET-3", "PARTY-REVOKED-4", "PARTY-PREP-5", thieves-map and wanted-poster ids absent |
| 3 | New handout "Wanted Poster", add image wanted-poster, text "Reward 50 gp", Save | — | Row "Not shared" in A only; nothing in B, C (frames) |
| 4 | Share… → Chosen: Player 1 | B | B: toast "New handout: Wanted Poster", row New; open → viewer shows image + text. C: no toast, no row; leak scan C clean (title, id, asset id) |
| 5 | Share with everyone | C | C: toast + row. B: no second toast |
| 6 | Share… → Not shared (revoke) while B and C have the viewer open on it | B, C | Both viewers "No longer shared"; rows gone. Bell history rows stay. Their Open → "No longer shared" |
| 7 | Inventory: Add "Healer's kit" ×1 | — | Row in A, B, C; toast "Party loot: Healer's kit ×1"; `loot.log` row "Outside the party → Party: Healer's kit ×1" |
| 8 | — | B: Take Potion ×1 to Mira | Party Potion ×1; Mira's sheet Inventory shows Potion of healing ×1; log row |
| 9 | — | B: Give… Bolts ×5 from Mira → Party; C: Take shows Thorn only, Give lists only Thorn's items | Party gains Bolts ×5; Mira's Bolts ×15 |
| 10 | Party loot → Split… Mira + Thorn, prefilled 5 pp, 30 gp | — | Preview "Each gets 2 pp, 15 gp; 1 pp stays"; after Split: pot 1 pp; Mira +2 pp 15 gp; Thorn +2 pp 15 gp |
| 11 | — | B reloads with Party open | Skeleton, then the same lists; New marks as before reload |
| 12 | Hard-kill + restart the server | — | All rejoin; open boards reload; lists, inventory, log, pot identical to step 11; leak scan C again clean; no console errors |
| 13 | Switch to Second Campaign, then back | B, C rejoin | A: only "SECOND-CAMPAIGN-HANDOUT" / "SECOND-CAMPAIGN-ITEM"; then step-12 state |

Teardown: stop the server, then `fixtures:reset --profile verify`.

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [proposed lazy record types](../architecture/adr/proposed-lazy-record-types.md) | `lazy` flag, `sync.load`, `useLazyRecords`, loaded-set convergence + leak scan | proposed (OQ-PARTY-03) |
| [party-loot](party-loot.md) | kind `item` + `qty`, `loot.split`, item rows, `loot-received` from `party.addItem` | complete; evolved here (OQ-PARTY-16) |
| [character-sheet-full](character-sheet-full.md) | `creature-sheet.items` writes from moves, CHARX visibility on the sheet change | complete; helper needed (OQ-PARTY-17) |
| [assets-pipeline](assets-pipeline.md), [notifications](notifications.md), [play-shell](play-shell.md), [live-sync](live-sync.md), [fixtures-adapters](fixtures-adapters.md) | `assets.require`, picker, `display`/`thumb`; `notify`, kind + view registries; window registry, `activity`; record changes upsert/delete on visibility flips; bundles | complete |
| New npm dependency | none | — |

### 14.1 Build split (AGENTS §9.9 shared files per slice)

Sprint hotspots: schema cores V → R → **P** → C → D; character-sheet folder V → R → D → **P**.

| # | Branch | Contents | Shared files touched |
|---|---|---|---|
| 0 | `fix/lazy-records` (only if the ADR is accepted; after V's ws work) | `lazy` flag, `sync.load`, client loaded set + `useLazyRecords`, convergence / leak-scan helpers | `src/server/ws/`, `src/shared/protocol/`, existing `src/client/common/` store files, `src/server/ws/testing/`; protocol docs |
| 1 | `build/party-core` (schema lock after R core) | Tables `handout`, `party_item`; `loot_entry.qty` + kind `item`; events; `@shared/party-board` zod + pure fns; record-type registrations; fixtures units + bundle | `src/server/db/`, `src/shared/events/party-board.ts` + `party-loot.ts` (`CoinSplit`, kind), record-type registry lines, `src/server/features/index.ts` line, `fixtures/bundles/index.ts` line; data-model + protocol docs |
| 2 | `build/party-handouts` (∥ 3) | Handout commands, `handout-shared` kind + views, `party.board` (Handouts tab) + `party.handout` windows | `kinds.ts` line, both `notification-views.ts` lines, both `windows.ts` lines |
| 3 | `build/party-gold` (∥ 2) | `loot.split`, Split… dialog, item-row rendering in `loot.log`, `loot.edit` item `conflict` | party-loot server + client folders (LOOT-owned; orchestrator assigns) |
| 4 | `build/party-inventory` (after 3; char-sheet folder lock last) | Item commands, CHARX sheet-items helper, Inventory tab | new file in `src/server/features/character-sheet/` (CHARX-owned), party-loot `add` helper for item rows |

## 15. Open questions

**Bold** = suggested pick. "DM gate" = blocking until the DM picks at gate 1.

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-PARTY-01 | Handout reveal model vs entity visibility | **Handout-own `reveal` {none / all / chosen players} + its own visibility fn; shape exported from `@shared` for later reuse (world-builder NPCs)**: fits ADR-0021 (flag on the record), no entity change / reuse entity visibility (fixed per kind; needs a reveal field on entities and a handout entity kind) / `hidden` boolean like tokens (no chosen players) | yes · DM gate | entities, post-mvp/world-builder |
| OQ-PARTY-02 | Content types; where files live | **Text + 0–10 images via the assets pipeline (capability IDs, ADR-0023); PDF out (DM exports pages as images)**: no pipeline change / PDF served as an original with the browser viewer (breaks "originals never served", script risk) / PDF rasterised at ingest (new dependency, e.g. pdf.js / MuPDF) | yes · DM gate | assets-pipeline |
| OQ-PARTY-03 | Snapshot cost (CON-44, measured §12) | **Lazy types + `sync.load` (proposed ADR)**: +1.1 KB DM, reusable by compendium; needs a ws branch / headers + items in the snapshot, bodies on demand: +37–80 KB DM, needs a lower headroom / feature `party.load` command: no ws change, re-implements the filter | yes · DM gate | live-sync, compendium |
| OQ-PARTY-04 | Party inventory vs per-character inventory; transfer | **Own `party-item` rows; moves write the sheet's `items` in the same tx, merge by name + notes, logged as loot entries**: one source per side, conserved / items only as loot-log text (no stock list) / wait for item entities (compendium / world-builder) | yes · DM gate | character-sheet-full, party-loot |
| OQ-PARTY-05 | Gold ledger vs party-loot | **Evolve party-loot: same log + kind `item` + DM `loot.split`**: no second source of wallets / separate ledger table (two sources of truth) | yes · DM gate | party-loot |
| OQ-PARTY-06 | Split rules | **DM only; ⌊coin / n⌋ per denomination, remainder stays in the pot; no conversion**: simple, conserved / players may split (breaks FR-LOOT-07's "pot → own only") / convert to gp first (making change is a LOOT non-goal) | no · owner: DM | party-loot |
| OQ-PARTY-07 | Shared party notes (tier B) | **Out of sprint 3**: keeps 3 slices / in: one player-editable plain-text doc, last write wins (+1 slice, edit conflicts) | yes · DM gate | — |
| OQ-PARTY-08 | Where it opens | **`party.board` (Handouts, Inventory; 480×600) + viewer `party.handout` (720×640), both clients; `loot.log` stays**: big images get their own window / board absorbs loot as a third tab (retire `loot.log`) / one window per part (more launcher buttons) | yes · DM gate | play-shell, party-loot |
| OQ-PARTY-09 | What players can do | **Read only + per-browser New / Updated marks; DM order (newest shared first)**: no server state / per-player pins (server record) / annotations (→ party notes, tier B) | no · owner: DM | — |
| OQ-PARTY-10 | Do recipients of a chosen-players handout see who else got it? | **No ("Shared with you")**: allows secret handouts / yes, names | no · owner: DM | — |
| OQ-PARTY-11 | Do sheet lock / draft block item moves? | **No: a move is a logged game action, as coin** / lock blocks player moves in and out | no · owner: spec-party-board | character-sheet-full |
| OQ-PARTY-12 | dice-extras: clickable notation in handout bodies | **Body rendered through dice-extras' notation component when it ships; PARTY adds no parser** / none | no · owner: seams | dice-extras |
| OQ-PARTY-13 | compendium: items referencing compendium entries | **Later: nullable `party_item.itemRef` (additive)** / now (needs C's item data first) | no · owner: spec-compendium | compendium, post-mvp/world-builder |
| OQ-PARTY-14 | Glossary | **Add Party board, Handout, Handout reveal, Party inventory, Item move, Split; amend Party loot (item rows)** | no · owner: integrator | glossary |
| OQ-PARTY-15 | Notification title after revoke | **Keep "New handout: ‹title›" in the recipient's history (already seen)** / generic "New handout" text | no · owner: DM | notifications |
| OQ-PARTY-16 | party-loot owns the table, `loot.log` and FR-LOOT-07/13 | **P slices edit party-loot's folders by orchestrator assignment; integrator adds a revision note to party-loot** / LOOT revision block first | no · owner: seams | party-loot |
| OQ-PARTY-17 | character-sheet-full: who writes `items` on a move | **New CHARX helper file `sheet-items.ts` (validate, merge, caps), built under the char-sheet lock (last)**; no sheet UI change in sprint 3 / P writes the JSON leaf directly (duplicate validation) | no · owner: seams | character-sheet-full |

## 16. Out of scope

- See §4. PDF (OQ-PARTY-02), party notes (OQ-PARTY-07), player pins / annotations (OQ-PARTY-09), item references (OQ-PARTY-13), a "Give" button on the sheet's own Inventory tab (later, via CHARX), handout folders and reordering, load-older for the loot log (LOOT).
