---
title: Linked notes
prefix: NOTES
status: in-review
owner: spec-linked-notes
phase: post-mvp
---

# Linked notes

> **For the DM's gate:** three questions and one group to accept in [§15](#15-open-questions). The rest follows the DM's answers ([#444](../decisions-log.md) and the later "full Google Docs, no private comments"). Test plan and build split: [linked-notes-build](linked-notes-build.md). How co-writing works: [proposed ADR](../architecture/adr/proposed-note-co-writing.md).

## 1. Summary

- The table keeps **notes** together. Every note is shared: the DM and every player can read, edit, rename and delete it. Nothing in notes is private.
- `[[Title]]` and `@Title` link notes by title; each note lists its **backlinks**.
- A note opens straight into a live editor, Google Docs style: everyone's typing, named cursors and selections, and who is in the note now.

## 2. Scope

What "full Google Docs" means here:

| In this build | Not in this build |
|---|---|
| Live co-writing; named cursors and selections; who is in this note now; click a name to jump to their cursor | Comments (OQ-02), suggestion mode, version history and restore |
| Undo / redo of your own changes only | Formatting toolbar, tables, images, find and replace |
| Typing offline, sent when you're back; "Saved" / "Offline" status | Per-note sharing or roles: everyone edits everything |
| Links, backlinks, search, the browser's spell check | `@` notifying someone; export and print |

A note can have the same name as a token or creature; nothing ties them together. Handouts ([party-board](party-board.md)) don't change.

## 3. Goals

- The party's notes in one place, linked and searchable.
- Three people type in one note at once, and nothing anyone typed is lost, not even in a server crash.
- Notes never leave their campaign.

## 4. Non-goals

- Private notes or comments (players keep those in their own apps), reveal, DM-only parts, rich text.

## 5. User stories

- **Player:** the party edits "Quest log" together during play, and I can see who's typing where.
- **DM:** I write recaps the party can fix and extend; I link NPCs with `@Duke Varen`.

## 6. Functional requirements

**Notes**

| ID | Requirement |
|---|---|
| FR-NOTES-01 | Anyone at the table (the DM or a player) can create, edit, rename or delete a note. Every note of the campaign reaches every player and the DM of that campaign, and no one else. |
| FR-NOTES-02 | Title: 1–100 characters, trimmed, no `[[`, `]]`, `\|` or line break. Titles are unique per campaign, compared folded (the shared matcher's `fold`); a clash is refused ("A note with that title exists"). |
| FR-NOTES-03 | Body: plain text with MarkdownLite syntax, at most 32 KiB of UTF-8. At most 1,000 notes per campaign (OQ-04). |
| FR-NOTES-04 | Delete asks for confirmation. **A deleted note goes to Recently deleted in the Notes window for 7 days, where anyone can restore it; then it's gone** (OQ-01). A restore whose title is now taken gets " (restored)" added. |

**Links and backlinks**

| ID | Requirement |
|---|---|
| FR-NOTES-05 | `[[Title]]` and `[[Title\|label]]` link to the note with that folded title. |
| FR-NOTES-06 | `@` starts a link when it begins the text or follows a character that isn't a letter or digit (so `mira@x.com` isn't one). **The link is the longest note title that the text after `@` starts with, followed by the end of the line or a character that isn't a letter or digit** (OQ-03). So `@Duke Varen's office` links "Duke Varen", and `@Quest log.` links "Quest log". With no matching title, the link is the one word after `@` (letters, digits, `-`, `_`), shown as missing. |
| FR-NOTES-07 | A missing link shows dotted. Clicking it creates a note with that title and opens it; if someone created it meanwhile, that note opens. |
| FR-NOTES-08 | Typing `[[` or `@` lists matching titles (shared matcher); Enter inserts `[[Title]]` or `@Title`. |
| FR-NOTES-09 | A rename rewrites every link to the note in every note, label kept: `[[Old]]` → `[[New]]`, `@Old` → `@New` (or `[[New]]` if `@New` would match a longer title there). |
| FR-NOTES-10 | An open note lists its backlinks: the notes that link to it, in either form. The list refreshes ≤ 1 s after any link, title, delete or restore change, and only on connections whose list changed. |

**Editor and co-writing** (mechanics in the [ADR](../architecture/adr/proposed-note-co-writing.md))

| ID | Requirement |
|---|---|
| FR-NOTES-11 | Opening a note shows the editor at once; there is no Edit button or read mode. Up to 8 open notes per connection. |
| FR-NOTES-12 | Live preview: away from the caret, a link shows as its title (or label) with the brackets hidden, and dice notation gets a die button. **A click on a link follows it; it never moves the caret. Arrow keys, or Alt+click (long-press on touch), put the caret inside, and the raw `[[…]]` shows.** A click on a die button rolls. Headings, bold and lists are styled in place. |
| FR-NOTES-13 | Every accepted change reaches everyone in the note ≤ 300 ms on a LAN. The server accepts a change only at the note's current version and from the editor ID that connection opened with; otherwise the client rebases and resends. Nothing typed is lost or doubled. |
| FR-NOTES-14 | Other people's carets and selections show with a name tag in their colour (`player.color`, `campaign.dmColor`); your own other tab shows as "You". Cursors are never stored and go ≤ 10 s after the person leaves. |
| FR-NOTES-15 | **Who is here:** name chips at the top of the note show everyone who has it open, updated ≤ 1 s after they open or close it, and gone when live-sync shows them offline. Clicking a chip scrolls to that person's cursor. |
| FR-NOTES-16 | Undo and redo (Ctrl+Z, Ctrl+Shift+Z / Ctrl+Y) undo only your own changes in this tab, adjusted for what others typed since. |
| FR-NOTES-17 | After every snapshot (reconnect, resync, server restart), each open note re-opens from the client's version, and anything typed meanwhile, offline included, is sent rebased. The status line shows "Saved", "Saving…" or "Offline". |
| FR-NOTES-18 | Each accepted change is stored in the transaction that accepts it. **A server crash loses nothing the server accepted.** |
| FR-NOTES-19 | If a note is deleted, or the campaign switches, while someone has it open, they see "This note was deleted" (or "…is no longer available"), with **Copy my text** and, for a delete, **Restore**. |
| FR-NOTES-20 | Typing stops at 32 KiB ("Note is full"). If two people's typing together goes over, the server refuses the push and that client reloads the note, with Copy my text. |

**Search and the rest**

| ID | Requirement |
|---|---|
| FR-NOTES-21 | Search covers note titles and bodies with the shared matcher: up to 50 results, each with its title and a snippet. |
| FR-NOTES-22 | **A roll from a note is labelled "Note", never the note's title,** and follows normal roll visibility (OQ-04). |
| FR-NOTES-23 | Notes add nothing to the event log, game log, session recap, stats, notifications or snapshots. Server log lines name notes by ID only. No MCP tool reads notes (OQ-05). New tables only (#416): a DB without them boots, and they start empty. |

## 7. UI/UX notes

Gilt & Stone kit and [visual-direction](../design/visual-direction.md) only.

- **Window:** `notes.main` in both clients, placed per [ADR-0025](../architecture/adr/0025-play-shell-windows.md) / [0060](../architecture/adr/0060-one-window-placer.md), remembered per [0064](../architecture/adr/0064-window-memory.md). Size row: default 760 × 560, useful 560 × 420, minimum 360 × 320.
- **Opened from:** the launcher ("Notes") and the command palette ("Open Notes", "New note").

```text
┌ Notes ───────────────────────────────────────────────────────┐
│ [Search notes…] [+ New] │ Burnt Ledger    (M)(DM)  Saved     │
│  Burnt Ledger  Mira·2m  │ [Rename] [Delete]                  │
│  Quest log     DM·1h    │ Found in Duke Varen's office.|Mira │
│                         │ Roll 2d6 [die].  See @Quest log    │
│ Recently deleted (1)    │ ── Linked from: Quest log ──────── │
└──────────────────────────────────────────────────────────────┘
```

- **Editor:** CodeMirror with live preview (FR-NOTES-12), carets with name tags, chips for who is here (FR-NOTES-15), status at the right.
- **Recently deleted:** a fold-out at the list's foot: title, who deleted it, when, **Restore**.
- **States:** empty ("No notes yet"), loading, error with Retry, disconnected (FR-SYNC-24 banner; typing carries on).
- **Narrow (< 520 px):** the list becomes a dropdown.
- **DM view = player view.**
- **Test IDs:** `notes-new`, `notes-search`, `notes-list-item` (+ `data-record-id`), `notes-editor`, `notes-rename`, `notes-delete`, `notes-link` (+ `data-title`), `notes-die`, `notes-backlinks`, `notes-cursor` (+ `data-player-id`), `notes-here` (+ `data-player-id`), `notes-status`, `notes-deleted-list`, `notes-restore`, `notes-banner`, `notes-copy-text`.

## 8. Data model

### 8.1 Tables (new)

| Table | Fields | Notes |
|---|---|---|
| `note` | `id`, `campaignId`, `title`, `titleFold`, `createdBy{Role,PlayerId}`, `createdAt`, `updatedAt`, `updatedBy{Role,PlayerId}`, `deletedAt`, `deletedBy{Role,PlayerId}` | IDs from `ctx.ids`, times from `ctx.clock`. Unique (`campaignId`, `titleFold`) among live notes |
| | `body`, `bodyFold`, `bodyVersion`, `version` | `body` holds the changes up to `bodyVersion`; `version` is the latest accepted change |
| `note_change` | `noteId`, `version`, `clientId`, `changes` (JSON), `at` | One row per accepted push; the last 1,000 rows or 1 MiB per note are kept |
| `note_link` | `noteId`, `kind` (`wiki` / `at`), `targetFold` | Rewritten when the links change. `at` rows hold the folded text after `@` to the line's end (≤ 100 characters), resolved by FR-NOTES-06 |

### 8.2 Record, relations, derived values

- **Record type `note`:** campaign scope, `lazy: "all"`, seen by the campaign's DM and players. Fields `{id, title, createdBy, updatedAt, updatedBy, deletedAt, deletedBy}`; no body. Bodies travel only in co-writing results and signals.
- **Relations:** `note_change` and `note_link` rows belong to a `note`; a `note` belongs to a campaign. Link targets are titles, not keys.
- **Derived:** link resolution and the `[[` / `@` lists on the client, from `note` rows; backlinks on the server from `note_link`.
- **Runtime state:** subscriptions, who is here and cursors, in memory only.

### 8.3 Field visibility

Everything about a note goes to the campaign's DM and players. Cursors and who-is-here go to the people with that note open (cursors also to DM connections, FR-SYNC-28). Nothing reaches another campaign's connections.

## 9. API & events

**WS intents** (DM and player): commands per ADR-0016, none logged. A note that doesn't exist, or belongs to another campaign, gets `not_found`.

| Intent | Rule |
|---|---|
| `notes.create {title, ifMissing?}` / `notes.rename {noteId, title}` | FR-NOTES-02, -03, -07, -09 |
| `notes.delete {noteId}` / `notes.restore {noteId}` | FR-NOTES-04 |
| `notes.open {noteId, clientId, version?}` / `notes.close {noteId}` | FR-NOTES-11, -15, -17 |
| `notes.push {noteId, version, updates}` | From the bound `clientId`; FR-NOTES-13, -20 |

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
| Disconnect, reconnect, crash | FR-NOTES-17, -18 |
| Concurrent edits, two tabs | FR-NOTES-13, -14, -16 |
| Deleted mid-edit, campaign switch | FR-NOTES-19 |
| Over a limit | FR-NOTES-03, -20 |
| Another campaign's note ID | `not_found` |
| A player removed from the campaign | Removal doesn't exist yet ([OQ-CAMP-08](campaign-management.md#15-open-questions)). Notes add no path of their own: every note frame goes to live connections of the campaign, and search checks the token on every call. Removal closing the player's connections is enough |
| Bad change JSON | `invalid` |

## 12. Performance & bandwidth

- **Snapshots: 0 B** (lazy), so the CON-44 ceilings don't move.
- **Load on Notes open:** about 250 B per `note` row: ≈ 50 KB at 200 notes, ≈ 250 KB at 1,000, under the 4 MiB result cap. Measured with `lazyLoadSizes`.
- **Typing, cursors, disk and search:** [ADR](../architecture/adr/proposed-note-co-writing.md#limits-and-load).
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

**Bold** = pick. OQ-01 to OQ-04 go to the gate. Decided by the DM ([#444](../decisions-log.md) and after): every note shared, nothing private, anyone deletes and renames, unique titles, links renamed, `@` links, editor only.

| ID | Question | Options | Blocking? | Affects |
|---|---|---|---|---|
| OQ-NOTES-01 | Getting a deleted note back | A: never; **B: Recently deleted for 7 days, anyone restores**; C: as B, DM only | Yes | FR-04, -19 |
| OQ-NOTES-02 | Shared comments (Google Docs style, seen by all) | **A: not in this build; their own slice later**; B: in this build | Yes | §2 |
| OQ-NOTES-03 | How far `@` reaches | **A: the longest note title that fits** (`@Duke Varen` works); B: one word only, longer titles need `[[…]]` | Yes | FR-06 |
| OQ-NOTES-04 | Accept as before: rolls labelled "Note"; limits of 32 KiB per note (~5,000 words), 100-character titles, 1,000 notes | **A: accept** | Yes | FR-03, -22 |
| OQ-NOTES-05 | MCP tools for notes? | **A: not in this slice**; B: a read-only tool now | No (owner: agent-api) | FR-23 |
| OQ-NOTES-06 | Glossary: add Note, Wikilink, Mention (`@`), Backlink. "Share" (handouts, game log) and session-recap's "share note" each gain a "not a note" line | **A: add them** | No (owner: integrator) | Glossary |

## 16. Out of scope

Each with the room left for it: comments (a `note_comment` table anchored like cursors, OQ-02); version history (`note_change` rows already hold recent changes); images (an image run on asset IDs, [ADR-0023](../architecture/adr/0023-asset-access-by-capability-id.md)); tags and folders; quest log, calendar, NPC directory (a note `kind`); Obsidian import; MCP (a read tool on `note`, OQ-05); pop-outs (FR-SHELL-201); links to tokens, creatures or compendium entries.
