---
title: Send to game log
prefix: SHARE
status: in-review
owner: build-log-share
wave: post-mvp
---

# Send to game log

> Five-minute read. See [AGENTS.md](../../AGENTS.md). Decided by the DM, 2026-10-31 ([decisions #415](../decisions-log.md)).

## 1. Summary

- A **Send to game log** button on compendium entries, rule cards and character sheet rows posts the full text to the [game log](dice-roll-log.md) for the whole table.
- Replaces copy-pasting a spell into Discord while describing it. Rare and deliberate, so the full text shows, not a collapsed card.
- The client names what to share; the server builds the text from what the sender may read.

## 2. Scope

- Compendium: spells, items, conditions, features, rules (homebrew too). Rule cards in the Rules window.
- Character sheet rows: attacks, spells, features, items, in view mode.
- A new log kind `share.entry`; no new table or record type.

## 3. Goals

- One click, and everyone reads what the speaker means.
- A player can never post text they couldn't read, or free text under an entry's name.
- A reconnect stays cheap, however many shares were made.

## 4. Non-goals

- Free-text chat ([feature-tiers](../feature-tiers.md): tier C–D, still open).
- Sharing a monster's stat block: one misclick would show players the whole block.
- Whispers, or sharing with chosen players: handouts do that ([party-board](party-board.md)).
- Sharing NPC sheets, companion cards or sheet fields other than the four row lists.

## 5. User stories

**DM**
- As the DM, I want to send a rule or an unshared homebrew entry to the log, so the table reads it without my opening a handout.
- As the DM, I want a confirm before unshared homebrew goes out, and Hide afterwards, so a slip can be taken back.

**Player**
- As a player, I want to send a spell from my sheet while describing it, so nobody needs a Discord paste.

## 6. Functional requirements

| ID | Requirement | Notes |
|---|---|---|
| FR-SHARE-01 | **Compendium and rules:** an entry's actions row (`cmp-entry-actions`) has a labelled "Send to game log" Button, and a rule card an icon one, for every kind but `monster`. Disabled while not live. | `share-send`, `data-value="compendium"`, `data-record-id` = entry id |
| FR-SHARE-02 | **Sheet rows:** an icon Button on each attack, spell (registry `spell-row-actions`), feature (Features tab and Limited uses) and item row, in view mode, for the DM and the row's owner (`canCount`), locked or not. Not on NPC sheets, or on a legacy row without an id. | `share-send`, `data-value` = list, `data-record-id` = row id |
| FR-SHARE-03 | **Intent:** `share.toLog` names the source only (entry id, or creature + list + row id); strict schema, so no text can be sent. Ack `{entryId}`; a success toast "Sent to the game log"; a reject toasts. | |
| FR-SHARE-04 | **Text, built by the server.** An entry: its facts as the compendium shows them (spell: casting time, range, components, duration; item: cost, weight, damage, properties, AC), its text, At Higher Levels. A sheet row holds no rules text, so it reads the compendium entry **of its name and kind** the sender may read: not one another candidate replaces (FR-CMPX-13), lowest source rank first (FR-CMP-38), so the campaign's own wins. Then its own notes, "**Notes.** …". A feature keeps its own text, unless that is empty or a clipped copy of the entry's ("…"), which reads the whole. An attack: the sheet's line as the summary ("+8 · 2d6+5 slashing + 2d6 fire"), the item entry's text if any. No entry → the row's own words. | |
| FR-SHARE-05 | **In the log:** kind `share.entry`, payload `{title, line, text, cut?, folded?}`, category `other`, **public** whatever the DM's category setting. The row has its normal head ("Mira · shares Fireball", time), wraps, and grows to show the summary and the full text below it (amends FR-KIT-40's 40 px for this kind), rendered as markdown-lite (FR-CMP-26; a notation in it rolls). No Tooltip. Screen readers read the head and the text. | `share-entry-body`, `-line`, `-folded`, `-cut` |
| FR-SHARE-06 | **One share's limit:** text ≤ 16,000 chars (every SRD spell and magic item fits: the longest is 13,949); longer is cut with "…" and the row says "Cut to fit the log." | |
| FR-SHARE-07 | **Row menu** (amends FR-DICE-103, -106): Copy text (the whole text with its markdown, ready for Discord), the DM's Hide / Reveal (FR-DICE-99), no Roll details and no double-click: a double-click selects a word. A selection inside one share's text copies just those words (amends FR-KIT-46). | |
| FR-SHARE-08 | **The window's limit** (CON-44): the shares in the log's 100-entry window keep ≤ 64,000 chars of text, newest first. An older share past that keeps its head and summary, loses its text and shows "An older share: its text is no longer kept." In the same event, so every client follows. The DB row loses it too. | Worst case measured: +109 KB per viewer, including the 100 rows themselves |
| FR-SHARE-09 | **Who it reads as:** a sheet row, the character. A compendium entry: the DM "DM"; a player their one character of the campaign, else their player name. | |
| FR-SHARE-10 | **Who may share what:** an entry the sender may read (FR-CMP-14), else `not_found`, as an unknown id; a monster → `invalid`, for the DM too. A sheet row: the DM any character of the campaign, a player their own (`forbidden`), a monster or another campaign's → `not_found`; a row that's gone → `not_found`. A sheet share never reads an entry the sender can't. | |
| FR-SHARE-11 | **The DM's unshared homebrew** (and unshared house rule): the Button asks first, "Show this to everyone?" (Keep private / Send to game log). Sending doesn't share the entry: it stays closed to players. | `share-confirm-dialog`, `-send`, `-cancel` |
| FR-SHARE-12 | **A tall share lands at its head** (amends FR-DICE-21): a new share taller than a pinned list scrolls to its row's top and unpins, so what follows shows as "N new" while the reader reads. One that fits stays pinned, and so does a list that loads with a tall share already in it (a reload, a reopened window). | |

## 7. UI/UX notes

Reference [visual-direction](../design/visual-direction.md). Existing Button, Tip, Dialog and MarkdownLite; no custom styling.

- **States:** disabled while not live; toast on success and on a reject; an empty text (an attack no item names) shows the head and summary only.
- **DM view:** the Button everywhere, with the confirm of FR-SHARE-11; a hidden share keeps its muted eye-off row.
- **Player view:** the Button on entries they can read and on their own sheet; the same row in the log.

## 8. Data model

No new table, column or record type. A share is a `game-log-entry`.

| Entity | Field | Type | Notes |
|---|---|---|---|
| `game_log_entry.payload` (kind `share.entry`) | title | text 1–80 | Entry or row name |
| | line | text 0–120 | "Level 3 evocation", the attack's line, a feature's source |
| | text | text 0–16,000 | Markdown-lite; a copy, so later edits to the entry don't touch it |
| | cut | `true`? | FR-SHARE-06 |
| | folded | `true`? | FR-SHARE-08 |

- **Relations:** none: the entry or row isn't referenced, so a share outlives it.
- **Derived values:** none.
- **Persisted runtime state:** none.

## 9. API & events

**REST (Hono RPC)**: none.

**WS intents (client → server)**

| Intent | Who | Validation / ownership |
|---|---|---|
| `share.toLog` | DM, player | `{from: "compendium", entryId}` or `{from: "sheet", creatureId, list, rowId}`; FR-SHARE-10 |

**WS events (server → client)**

| Event | Payload | Visibility rule |
|---|---|---|
| `LogEntryShared` | `{entryId, from, title}`; changes: the new `game-log-entry`, plus any older share folded | Everyone: a share is stamped public. After a DM Hide, the usual `game-log-entry` rule (FR-DICE-15): DM only. No DM-only payload |

## 10. Permissions

| Action | DM | Player | Server check |
|---|---|---|---|
| Share a readable entry | ✓ | ✓ | `entryVisibleTo` (FR-CMP-14) |
| Share unshared homebrew | ✓ (confirm) | — | `entryVisibleTo` → `not_found` |
| Share a monster | — | — | `invalid` / `not_found` |
| Share a sheet row | any character | own character | `authorizedCharacter` |
| Hide / reveal a share | ✓ | — | `dice.setEntryHidden` (FR-DICE-99) |

## 11. Edge cases & failure modes

- **Player disconnect / reconnect:** the Button is disabled while not live; a share made meanwhile is in the snapshot's window.
- **DM disconnect / reconnect:** same.
- **Server crash mid-action:** one transaction: the entry, the folds and the event log commit together or not at all.
- **Concurrent edits:** the text is read inside the command's transaction; a row deleted first → `not_found`, toasted.
- **Invalid / malicious input:** extra fields rejected by the strict schema; other campaigns' entries and creatures → `not_found`. Text renders as text nodes (FR-CMP-26), never HTML.
- **Renamed row:** no entry of that name → the row's own words.
- **Two entries of one name:** FR-SHARE-04's order decides.

## 12. Performance & bandwidth

- A share is a one-off upsert of ≤ ~16 KB to each viewer. Clicks while one is in flight are dropped.
- **CON-44** (FR-SHARE-08; `FR-SHARE-08 CON-44`): 100 shares of the longest text add at most +109,235 B per viewer on the `log-share` bundle, about 45 KB of it the rows themselves, as rolls would be. Ceilings DM 1.5 MiB, players 512 KiB.

## 13. Test plan

Isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md)). Agent build loop per [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md).

| Level | What | Fixtures |
|---|---|---|
| Unit | Text per kind, limits, the line and row (`src/shared/log-share/text.test.ts`); row, menu, Button (`log-share.test.tsx`) | none |
| Integration | Permissions, lookup order, public stamp, fold, hide (`share.test.ts`); over real sockets: delivery, fresh snapshot, leak, CON-44 (`sync.test.ts`) | `log-share` |
| E2E (thin) | A sheet spell reaches the DM and another player; Hide; the DM's confirm (`e2e/log-share.e2e.ts`) | `log-share` |

**Browser walkthrough** (`fixtures:reset-load log-share --profile verify`; contexts `dm`, `player-1`, `player-2`):

| # | Who | Step | Expected |
|---|---|---|---|
| 1 | Player 1 | Sheet → Fireball row → Send | Toast; own log shows "Mira · shares Fireball", Level 3 evocation, facts, full text, **Notes.** Aim away from the party. |
| 2 | DM, Player 2 | Read the log | The same row, markdown rendered; the row is as tall as its text |
| 3 | Player 1 | Hedge Whisper → Send | Row with "Level 1 spell" and the row's notes only |
| 4 | Player 1 | Moonblade Shard (item), Second Wind (feature), Light crossbow (attack) → Send | Text, notes; feature text; the attack's line |
| 5 | Player 1 | Compendium → a condition → Send | Row reads "Mira · shares …" |
| 6 | DM | Compendium → CMP-SECRET-ITEM → Send → Keep private | No row anywhere |
| 7 | DM | Same → Send to game log | Row for everyone; the entry is still absent from Player 2's compendium search |
| 8 | DM | Rules → a card → Send; "Flanking"-style unshared house rule asks first | Row for everyone |
| 9 | DM | Goblin stat block | No Send button |
| 10 | Player 2 | Right-click a share → Copy text; select a sentence and copy | Whole text with markdown; just the sentence |
| 11 | DM | Right-click a share → Hide | Gone from both players; DM keeps a muted row. Reveal brings it back |
| 12 | All | Hard-reload | Rows unchanged; the log still pinned to the bottom |

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| [dice-roll-log](dice-roll-log.md) | `gameLog.append`, kinds registry, row, menu, Hide | built |
| [compendium](compendium.md) | Entries, `entryVisibleTo`, `MarkdownLite`, source rank | built |
| [character-sheet-full](character-sheet-full.md) | Rows, `authorizedCharacter`, `spell-row-actions` | built |

## 15. Open questions

None blocking.

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-SHARE-01 | Should a share offer a monster's public traits later? | **No, until asked** / a chosen-sections share | no; owner DM | compendium |

## 16. Out of scope

- Free-text and pasted descriptions in the log (tier C–D, [feature-tiers](../feature-tiers.md)).
- Linking a share back to its entry ("open in compendium").
