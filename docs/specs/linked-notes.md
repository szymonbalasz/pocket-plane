---
title: Linked notes
prefix: NOTES
status: complete
owner: spec-linked-notes
phase: post-mvp
---

# Linked notes

> No open questions for the gate: the DM decided everything ([#444](../decisions-log.md), [#445](../decisions-log.md), #446 this round; §15). Test plan and build split: [linked-notes-build](linked-notes-build.md). How co-writing works: [proposed ADR](../architecture/adr/0078-note-co-writing.md).

## 1. Summary

- The table keeps **notes** together. Every note is shared: the DM and every player can read, edit, rename and delete it. Nothing in notes is private.
- Typing `@` picks a note and inserts a link, shown as a chip. Each note lists its **backlinks**.
- A note opens straight into a live editor, Google Docs style: everyone's typing, named cursors and selections, and who is in the note now.
- Deleted notes go to a **Recycle bin**, and anyone can restore them.

## 2. Scope

What "full Google Docs" means here:

| In this build | Not in this build |
|---|---|
| Live co-writing; named cursors and selections; who is in this note now; click a name to jump to their cursor | Comments, suggestion mode, version history and restore |
| Undo / redo of your own changes only | Formatting toolbar, tables, images, find and replace |
| Typing offline, sent when you're back; "Saved" / "Offline" status | Per-note sharing or roles: everyone edits everything |
| `@` links, backlinks, search, Recycle bin, the browser's spell check | `@` notifying someone; permanent delete; export and print |

A note can have the same name as a token or creature; nothing ties them together. Handouts ([party-board](party-board.md)) don't change.

## 3. Goals

- The party's notes in one place, linked and searchable.
- Three people type in one note at once, and nothing anyone typed is lost, not even in a server crash.
- Nothing is ever lost by a delete; notes never leave their campaign.

## 4. Non-goals

- Private notes or comments (players keep those in their own apps), reveal, DM-only parts, rich text.

## 5. User stories

- **Player:** the party edits "Quest log" together during play, I see who's typing where, and I type `@Duke` to link the Duke's note.
- **DM:** I write recaps the party can fix and extend; if someone deletes one by mistake, I restore it from the Recycle bin three weeks later.

## 6. Functional requirements

**Notes and the Recycle bin**

| ID | Requirement |
|---|---|
| FR-NOTES-01 | Anyone at the table (the DM or a player) can create, edit, rename, delete or restore a note. Every note of the campaign reaches every player and the DM of that campaign, and no one else. |
| FR-NOTES-02 | Title: 1–100 characters, trimmed, no `[[`, `]]`, `\|` or line break. Titles are unique among the campaign's live notes, compared folded (the shared matcher's `fold`); a clash is refused ("A note with that title exists"). |
| FR-NOTES-03 | Body: plain text with MarkdownLite syntax, at most 32 KiB of UTF-8 (~5,000 words). At most 1,000 live notes per campaign. |
| FR-NOTES-04 | Delete asks for confirmation and moves the note to the **Recycle bin**, with no expiry. A binned note leaves links, backlinks, search and title checks: links to its title show as missing, and a new note may take its title. Its body isn't sent to anyone until it's restored. |
| FR-NOTES-05 | **Restore** brings a binned note back with its text. If its title is taken, it comes back as "Title (restored)", then "Title (restored 2)" and so on, shortening the title to stay within 100 characters. Restoring past the 1,000 live notes is refused. |
| FR-NOTES-06 | The bin holds at most 1,000 notes. A delete past that is refused: "The Recycle bin is full (1,000 notes). Restore some first." There is no permanent delete or emptying in this build. |

**Links and backlinks**

| ID | Requirement |
|---|---|
| FR-NOTES-07 | A link is stored as `[[Title]]` (or `[[Title\|label]]`) in the text and points to the live note with that folded title. Typing `[[Title]]` by hand links too. |
| FR-NOTES-08 | Typing `@` at the start of a line or after a space or punctuation, or typing `[[`, opens a **title picker** under the caret. It filters titles with the shared matcher as you type, and its last row is **Create note "…"**. Enter or a click inserts `[[Title]]` in place of `@…` (creating the note first for the last row). Esc, moving the caret away, or a space right after `@` closes it, and the typed text stays plain text. Only picked or hand-typed `[[…]]` links. |
| FR-NOTES-09 | A link shows as a **chip** (its title or label; dotted if missing). The chip is atomic: Backspace just after it, or Delete just before it, removes it whole. **A click follows it and never moves the caret.** Alt+click (long-press on touch), or moving into it with the arrow keys, shows the raw `[[…]]` to edit as text, until the caret leaves. |
| FR-NOTES-10 | A click on a missing chip creates a note with that title and opens it; if someone created it meanwhile, that note opens. |
| FR-NOTES-11 | A rename rewrites `[[Old]]` to `[[New]]`, label kept, in every note, binned ones included, so chips follow. |
| FR-NOTES-12 | An open note lists its backlinks: the live notes that link to it. The list refreshes ≤ 1 s after any link, title, delete or restore change, and only on connections whose list changed. |

**Editor and co-writing** (mechanics in the [ADR](../architecture/adr/0078-note-co-writing.md))

| ID | Requirement |
|---|---|
| FR-NOTES-13 | Opening a note shows the editor at once; there is no Edit button or read mode. Dice notation gets a die button that rolls on click. Headings, bold and lists are styled in place. Up to 8 open notes per connection. |
| FR-NOTES-14 | Every accepted change reaches everyone in the note ≤ 300 ms on a LAN. The server accepts a change only at the note's current version and from the editor ID that connection opened with; otherwise the client rebases and resends. Nothing typed is lost or doubled. |
| FR-NOTES-15 | Other people's carets and selections show with a name tag in their colour (`player.color`, `campaign.dmColor`); your own other tab shows as "You". Cursors are never stored and go ≤ 10 s after the person leaves. |
| FR-NOTES-16 | **Who is here:** name chips at the top of the note show everyone who has it open, updated ≤ 1 s after they open or close it, and gone when live-sync shows them offline. Clicking one scrolls to that person's cursor. |
| FR-NOTES-17 | Undo and redo (Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y) undo only your own changes in this tab, adjusted for what others typed since. |
| FR-NOTES-18 | After every snapshot (reconnect, resync, server restart), each open note re-opens from the client's version, and anything typed meanwhile, offline included, is sent rebased. The status shows "Saved", "Saving…" or "Offline". |
| FR-NOTES-19 | Each accepted change is stored in the transaction that accepts it. **A server crash loses nothing the server accepted.** |
| FR-NOTES-20 | If a note is deleted, or the campaign switches, while someone has it open, they see "This note was deleted" (or "…is no longer available"), with **Copy my text** and, for a delete, **Restore**. |
| FR-NOTES-21 | Typing stops at 32 KiB ("Note is full"). If two people's typing together goes over, the server refuses the push and that client reloads the note, with Copy my text. |

**Search and the rest**

| ID | Requirement |
|---|---|
| FR-NOTES-22 | Search covers live notes' titles and bodies with the shared matcher: up to 50 results, each with its title and a snippet. |
| FR-NOTES-23 | **A roll from a note is labelled "Note", never the note's title,** and follows normal roll visibility. |
| FR-NOTES-24 | Notes add nothing to the event log, game log, session recap, stats, notifications or snapshots. Server log lines name notes by ID only. No MCP tool reads notes (OQ-07). New tables only (#416): a DB without them boots, and they start empty. |

## 7. UI/UX notes

Gilt & Stone kit and [visual-direction](../design/visual-direction.md) only.

- **Window:** `notes.main` in both clients, placed per [ADR-0025](../architecture/adr/0025-play-shell-windows.md) / [0060](../architecture/adr/0060-one-window-placer.md), remembered per [0064](../architecture/adr/0064-window-memory.md). Size row: default 760 × 560, useful 560 × 420, minimum 360 × 320.
- **Opened from:** the launcher ("Notes") and the command palette ("Open Notes", "New note").

```text
┌ Notes ───────────────────────────────────────────────────────┐
│ [Search notes…] [+ New] │ Burnt Ledger    (M)(DM)  Saved     │
│  Burnt Ledger  Mira·2m  │ [Rename] [Delete]                  │
│  Quest log     DM·1h    │ Found in (Duke Varen)'s office.|M  │
│                         │ Roll 2d6 [die].  See (Quest log)   │
│ Recycle bin (1)         │ ── Linked from: Quest log ──────── │
└──────────────────────────────────────────────────────────────┘
```

- **Editor:** CodeMirror; link chips, the title picker, die buttons, carets with name tags, who-is-here chips, status at the right.
- **Recycle bin:** a fold-out at the list's foot, newest first: title, who deleted it, when, **Restore**.
- **States:** empty ("No notes yet"), loading, error with Retry, disconnected (FR-SYNC-24 banner; typing carries on).
- **Narrow (< 520 px):** the list becomes a dropdown.
- **DM view = player view.**
- **Test IDs:** `notes-new`, `notes-search`, `notes-list-item` (+ `data-record-id`), `notes-editor`, `notes-rename`, `notes-delete`, `notes-link` (+ `data-title`), `notes-picker`, `notes-picker-item`, `notes-picker-create`, `notes-die`, `notes-backlinks`, `notes-cursor` (+ `data-player-id`), `notes-here` (+ `data-player-id`), `notes-status`, `notes-bin`, `notes-restore`, `notes-banner`, `notes-copy-text`.

## 8. Data model

### 8.1 Tables (new)

| Table | Fields | Notes |
|---|---|---|
| `note` | `id`, `campaignId`, `title`, `titleFold`, `createdBy{Role,PlayerId}`, `createdAt`, `updatedAt`, `updatedBy{Role,PlayerId}`, `deletedAt`, `deletedBy{Role,PlayerId}` | IDs from `ctx.ids`, times from `ctx.clock`. `deletedAt` set = in the bin. Index (`campaignId`, `titleFold`); live-title uniqueness is checked by the commands |
| | `body`, `bodyFold`, `bodyVersion`, `version` | `body` holds the changes up to `bodyVersion`; `version` is the latest accepted change |
| `note_change` | `noteId`, `version`, `clientId`, `changes` (JSON), `at` | One row per accepted push; the last 1,000 rows or 1 MiB per note are kept |
| `note_link` | `noteId`, `targetFold` | One row per distinct link target, rewritten when the links change |

### 8.2 Record, relations, derived values

- **Record type `note`:** campaign scope, `lazy: "all"`, seen by the campaign's DM and players. Fields `{id, title, createdBy, updatedAt, updatedBy, deletedAt, deletedBy}`; no body. Bodies travel only in co-writing results and signals, and never for a binned note.
- **Relations:** `note_change` and `note_link` rows belong to a `note`; a `note` belongs to a campaign. Link targets are titles, not keys.
- **Derived:** link resolution and the picker on the client, from live `note` rows; backlinks on the server from `note_link`, live notes only.
- **Runtime state:** subscriptions, who is here and cursors, in memory only.
- **Permanent delete, later:** a `notes.purge {noteId}` intent (and Empty bin) removing the row and its `note_change` / `note_link` rows. No schema change.

### 8.3 Field visibility

Everything about a note goes to the campaign's DM and players. Cursors and who-is-here go to the people with that note open (cursors also to DM connections, FR-SYNC-28). Nothing reaches another campaign's connections.

## 9. API & events

**WS intents** (DM and player): commands per ADR-0016, none logged. A note that doesn't exist or belongs to another campaign gets `not_found`; opening or pushing to a binned note too.

| Intent | Rule |
|---|---|
| `notes.create {title, ifMissing?}` / `notes.rename {noteId, title}` | FR-NOTES-02, -03, -10, -11 |
| `notes.delete {noteId}` / `notes.restore {noteId}` | FR-NOTES-04 to -06 |
| `notes.open {noteId, clientId, version?}` / `notes.close {noteId}` | FR-NOTES-13, -16, -18 |
| `notes.push {noteId, version, updates}` | From the bound `clientId`; FR-NOTES-14, -21 |

**Signals and frames**

| Name | Kind | Who gets it |
|---|---|---|
| `notes.cursor` | Client signal with an `audience` hook | §8.3 |
| `notes.updates`, `notes.here`, `notes.backlinks`, `notes.closed` | Server signals (ADR-0071) | The note's subscribers; `notes.backlinks` only where the list changed |
| `note` record changes, cause `NoteChanged` | Event | The campaign's DM and players |

**REST:** `GET /api/notes/search?q=`, with a DM bearer or a player token, like compendium search; it searches the token's campaign only.

## 10. Permissions

Anyone at the table may do anything to a note (FR-NOTES-01). The server checks every intent against the connection's campaign.

## 11. Edge cases & failure modes

| Case | Rule |
|---|---|
| Disconnect, reconnect, crash | FR-NOTES-18, -19 |
| Concurrent edits, two tabs | FR-NOTES-14, -15, -17 |
| Deleted mid-edit, campaign switch | FR-NOTES-20 |
| Over a limit | FR-NOTES-03, -05, -06, -21 |
| Two people restore, or delete, the same note at once | The second is a no-op ack |
| Another campaign's note ID | `not_found` |
| A player removed from the campaign | Removal doesn't exist yet ([OQ-CAMP-08](campaign-management.md#15-open-questions)). Notes add no path of their own: every note frame goes to live connections of the campaign, and search checks the token on every call |
| Bad change JSON | `invalid` |

## 12. Performance & bandwidth

- **Snapshots: 0 B** (lazy), so the CON-44 ceilings don't move.
- **Load on Notes open:** about 250 B per `note` row, binned included: ≈ 50 KB at 200 notes, ≈ 500 KB at both caps, under the 4 MiB result cap. Measured with `lazyLoadSizes`.
- **Typing, cursors, disk and search:** [ADR](../architecture/adr/0078-note-co-writing.md#limits-and-load).
- **Editor:** its own chunk, loaded when Notes opens; measured in both bundles.

## 13. Test plan

See [linked-notes-build §1](linked-notes-build.md#1-test-plan): fixtures, the `notes` bundle, unit, integration and campaign-isolation tests, e2e, and a walkthrough with three people typing in one note. Each worktree runs it in isolation ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md), [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md)).

## 14. Dependencies

| On | What | Status |
|---|---|---|
| DM | `@codemirror/state`, `view`, `collab`, `commands` (MIT) | Approved; exact set in the ADR |
| [live-sync](live-sync.md) | Lazy types, server signals, presence | Exist |
| [dice-extras](dice-extras.md) | Dice notation parser and roll, label "Note" | Exists |
| [play-shell](play-shell.md) | Window, launcher and palette rows | Append-only registries |

## 15. Open questions

| ID | Question | Options | Blocking? | Affects |
|---|---|---|---|---|
| OQ-NOTES-01 | Who sees notes, and are any private? | **Decided (#440, #444, #445):** every note shared with the whole table, the DM included; no private notes or comments | — | FR-01 |
| OQ-NOTES-02 | Who deletes and renames; titles | **Decided (#444):** anyone; titles unique per campaign; renames rewrite links | — | FR-02, -11 |
| OQ-NOTES-03 | Live editing and reading | **Decided (#440, #444, #445):** live co-writing on `@codemirror/collab`; the editor opens directly; full Google Docs presence | — | FR-13 to -18 |
| OQ-NOTES-04 | Getting a deleted note back | **Decided (#446):** a Recycle bin with soft deletes and no expiry; anyone restores | — | FR-04 to -06 |
| OQ-NOTES-05 | Comments | **Decided (#445, #446):** none | — | §2 |
| OQ-NOTES-06 | `@` links; rolls labelled "Note"; limits (32 KiB, 100-character titles, 1,000 notes) | **Decided (#446):** `@` opens a picker that inserts `[[Title]]`, as in Google Docs; the accept group stood without objection | — | FR-03, -07 to -09, -23 |
| OQ-NOTES-07 | MCP tools for notes? | **A: not in this slice**; B: a read-only tool now | No (owner: agent-api) | FR-24 |
| OQ-NOTES-08 | Glossary: add Note, Note link (a chip), Backlink, Recycle bin. "Share" (handouts, game log) and session-recap's "share note" each gain a "not a note" line | **A: add them** | No (owner: integrator) | Glossary |

## 16. Out of scope

Each with the room left for it: permanent delete (`notes.purge`, §8.2); version history (`note_change` rows already hold recent changes); images (an image run on asset IDs, [ADR-0023](../architecture/adr/0023-asset-access-by-capability-id.md)); tags and folders; quest log, calendar, NPC directory (a note `kind`); Obsidian import (create notes from `[[Title]]` text); MCP (a read tool on `note`, OQ-07); pop-outs (FR-SHELL-201); links to tokens, creatures or compendium entries.
