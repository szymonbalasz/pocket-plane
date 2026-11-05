---
title: Linked notes
prefix: NOTES
status: in-review
owner: spec-linked-notes
phase: post-mvp
---

# Linked notes

> **For the DM's gate:** six product questions and three to accept in [§15](#15-open-questions). Written against the bold picks. Test plan and build split: [linked-notes-build](linked-notes-build.md). How co-writing works: [proposed ADR](../architecture/adr/proposed-note-co-writing.md). Private notes hidden from the DM: [proposed ADR](../architecture/adr/proposed-owner-only-records.md).

## 1. Summary

- Players and the DM write **notes**. A note is **private** (only its author sees it) or **shared** (the whole table sees it).
- `[[Title]]` links one note to another by title; each note lists its **backlinks**.
- Shared notes are co-written live, Google Docs style: everyone sees each other's typing and cursors.

## 2. Scope

- A Notes window in both clients: list, search, read, edit, links, backlinks, co-writing.
- A note can have the same name as a token or creature; nothing ties them together. Handouts ([party-board](party-board.md)) don't change.

## 3. Goals

- Your own notes and the party's shared notes in one place, linked and searchable.
- Three people type in one shared note at once, and nothing anyone typed is lost, not even in a server crash.
- A private note never reaches anyone but its author.

## 4. Non-goals

- A world builder, reveal, DM-only parts, version history, comments, rich text.

## 5. User stories

- **Player:** I keep private notes on NPCs, and the party edits a shared "Quest log" during play.
- **DM:** I write shared recaps the party can edit and private prep that stays mine. I never see a player's private notes.

## 6. Functional requirements

**Notes and who sees them**

| ID | Requirement |
|---|---|
| FR-NOTES-01 | Anyone at the table (the DM or a player) can create a note. Title: 1–100 characters, trimmed. Body: plain text with MarkdownLite, at most 32 KiB of UTF-8 (OQ-08). **New note** creates a private note. |
| FR-NOTES-02 | A **private** note reaches only its author's connections, in every tab. Nothing about it reaches anyone else: not its title, body, existence, count, ID, link targets, backlinks, search hits, timing, error wording or any frame. That includes the DM's connections ([owner gate](../architecture/adr/proposed-owner-only-records.md)). |
| FR-NOTES-03 | Every player and the DM of the campaign can read and edit a **shared** note. |
| FR-NOTES-04 | Only the author can share a private note. **On a shared note, the author's Make private creates a private copy for the author; the shared note stays as it is** (OQ-06). |
| FR-NOTES-05 | Titles are compared folded (the shared matcher's `fold`). **A shared title must be unique among the campaign's shared notes. A private title must be unique among its author's private notes.** No check ever looks at anyone else's private notes (OQ-02). |
| FR-NOTES-06 | Limits: 1,000 shared notes per campaign and 300 private notes per author (OQ-08). A refusal names only a limit the actor can see. |

**Links and backlinks**

| ID | Requirement |
|---|---|
| FR-NOTES-07 | `[[Title]]` and `[[Title\|label]]` link by folded title. Each viewer's client resolves links among the notes that viewer can read; it never asks the server. |
| FR-NOTES-08 | A link with no readable target shows as missing. Clicking it creates a note with that title and opens it. **The new note is shared if the link was clicked in a shared note, and private otherwise** (OQ-03). |
| FR-NOTES-09 | **If you can read two notes with the same title (your private one and a shared one), clicking opens a chooser that lists both, marked Private and Shared** (OQ-02). |
| FR-NOTES-10 | An open note lists its backlinks: the readable notes that link to it. The list refreshes ≤ 1 s after any note's links, title or sharing change, or a note is deleted. A connection gets a refresh only when its own list changed. |
| FR-NOTES-11 | Anyone who can edit a note can rename it. **A rename changes `[[Old]]` to `[[New]]`, label kept, in every note the renamer can read; other people's private notes stay untouched** (OQ-04). |
| FR-NOTES-12 | A private note can be deleted by its author. **A shared note can be deleted by its author or the DM** (OQ-01). Delete asks for confirmation; it can't be undone. |

**Co-writing** (mechanics in the [ADR](../architecture/adr/proposed-note-co-writing.md))

| ID | Requirement |
|---|---|
| FR-NOTES-13 | Opening a note subscribes the connection, up to 8 open notes per connection. Every accepted change reaches every subscriber ≤ 300 ms on a LAN, in read mode and in edit mode. |
| FR-NOTES-14 | The server is the only authority. It accepts a change only at the note's current version and from the editor ID that connection opened with. Otherwise the client rebases on the changes it is sent and tries again. Nothing typed is lost or doubled. |
| FR-NOTES-15 | In edit mode, other people's carets and selections show with a name tag in their colour (`player.color`, `campaign.dmColor`); your own other tab shows as "You". Cursors are sent for shared notes only, never stored, and disappear ≤ 10 s after the person leaves. |
| FR-NOTES-16 | After every snapshot (reconnect, resync, server restart), each open note re-opens from the client's version. Anything typed meanwhile, offline included, is sent rebased. |
| FR-NOTES-17 | Each accepted change is stored in the same transaction that accepts it. **A server crash loses nothing the server accepted.** |
| FR-NOTES-18 | If a note is deleted, or the campaign switches, while someone has it open, they see a banner, "This note is no longer available", with **Copy my text**, and the editor closes. |
| FR-NOTES-19 | Typing stops at 32 KiB ("Note is full"). Pushes go out in frames of ≤ 48 KiB. If two people's typing together goes over the limit, the server refuses the push and that client reloads the note, with Copy my text. |

**Reading, search and the rest**

| ID | Requirement |
|---|---|
| FR-NOTES-20 | **A note opens as a rendered page** (MarkdownLite): links behave as in FR-NOTES-07 to -09 and dice notation becomes `DiceText` roll buttons. **Edit** switches to the editor (OQ-05). `[label](target)` shows only its label. |
| FR-NOTES-21 | **A roll from a note is labelled "Note", never the note's title,** and follows normal roll visibility (OQ-09). |
| FR-NOTES-22 | Typing `[[` in the editor lists the titles the viewer can read (shared matcher); Enter inserts `[[Title]]`. |
| FR-NOTES-23 | Search covers the titles and bodies of the notes the viewer can read, using the shared matcher: up to 50 results, each with its title and a snippet. The server reads only shared notes and the viewer's own private notes, using folded bodies stored at save time, so other people's private notes change neither the results nor the time a search takes. |
| FR-NOTES-24 | Notes add nothing to the event log, game log, session recap, stats, notifications or snapshots. Server log lines name notes by ID only. No MCP tool reads notes (OQ-10). |
| FR-NOTES-25 | Notes add new tables only (#416). A DB without them boots, and the tables start empty. |

## 7. UI/UX notes

Gilt & Stone kit and [visual-direction](../design/visual-direction.md) only.

- **Window:** `notes.main` in both clients, placed per [ADR-0025](../architecture/adr/0025-play-shell-windows.md) / [0060](../architecture/adr/0060-one-window-placer.md) and remembered per [0064](../architecture/adr/0064-window-memory.md).
- **Size row:** default 760 × 560, useful 560 × 420, minimum 360 × 320 ("list + 300 px of note").
- **Opened from:** the launcher ("Notes") and the command palette ("Open Notes", "New note").

```text
┌ Notes ───────────────────────────────────────────────────────┐
│ [Search notes…]      [+ New note] │ Burnt Ledger   Shared ▾  │
│ SHARED                            │ [Edit] [Rename] [Delete] │
│  Burnt Ledger        Mira · 2m    │ Found in [[Duke Varen]]'s│
│  Quest log           DM · 1h      │ office. Roll 2d6 (●).    │
│ PRIVATE                           │ ── Linked from ───────── │
│  Duke Varen                       │  Quest log               │
└──────────────────────────────────────────────────────────────┘
```

- **Reading:** the rendered page. Links are underlined and missing ones dotted; name chips show who else has the note open.
- **Editing:** CodeMirror, with other people's carets. Esc or Done goes back to reading.
- **States:** empty ("No notes yet"), loading, error with Retry, disconnected (FR-SYNC-24 banner; editing carries on).
- **Narrow (< 520 px):** the list becomes a dropdown.
- **DM view = player view**, plus Delete on other people's shared notes (OQ-01).
- **Test IDs:** `notes-new`, `notes-search`, `notes-list-item` (+ `data-record-id`), `notes-share-toggle`, `notes-make-private`, `notes-edit`, `notes-editor`, `notes-rename`, `notes-delete`, `notes-link` (+ `data-title`), `notes-chooser`, `notes-backlinks`, `notes-cursor` (+ `data-player-id`), `notes-banner`, `notes-copy-text`.

## 8. Data model

### 8.1 Tables (new)

| Table | Fields | Notes |
|---|---|---|
| `note` | `id`, `campaignId`, `title`, `titleFold`, `shared`, `authorRole`, `authorPlayerId` | IDs from `ctx.ids`. Indexes: (`campaignId`, `shared`, `titleFold`) and (`campaignId`, `authorRole`, `authorPlayerId`) |
| | `body`, `bodyFold`, `bodyVersion`, `version` | `body` holds the changes up to `bodyVersion`; `version` is the latest accepted change |
| | `createdAt`, `updatedAt`, `updatedByRole`, `updatedByPlayerId` | `ctx.clock` |
| `note_change` | `noteId`, `version`, `clientId`, `changes` (JSON), `at` | One row per accepted push; the last 1,000 rows or 1 MiB per note are kept |
| `note_link` | `noteId`, `targetFold` | One row per distinct link target, rewritten whenever the links change; index on `targetFold` |

### 8.2 Record, relations, derived values

- **Record type `note`:** campaign scope, `lazy: "all"`. Fields: `{id, campaignId, title, shared, author {role, playerId?}, updatedAt, updatedBy}`; no body.
  - `ownerOf` is `null` for a shared note and the author for a private one.
  - The provider returns every note of the campaign, and the owner gate filters them.
- **Bodies** travel only in co-writing results and signals ([ADR](../architecture/adr/proposed-note-co-writing.md)).
- **Relations:** a `note` belongs to a campaign and an author (a player or the DM). `note_change` and `note_link` rows belong to their `note`. Link targets are titles, not keys.
- **Derived:** link resolution and the `[[` list are worked out on the client from the readable `note` rows. Backlinks are worked out on the server from `note_link`, per viewer.
- **Runtime state:** none persisted beyond the tables above. Subscriptions and cursors live in memory.

### 8.3 Field visibility

Everything about a private note goes to its author only (FR-NOTES-02); everything about a shared note goes to the whole table (FR-NOTES-03). Two cases need a rule of their own:

| Data | Who gets it |
|---|---|
| Cursor (`notes.cursor`) | Shared notes only: the players who have that note open, and DM connections (FR-SYNC-28). Never stored |
| `[[X]]` inside a shared note, where X is someone's private note | Only X's author's client resolves it. Everyone else sees a missing link; clicking it creates a new shared X (FR-NOTES-08) |

## 9. API & events

**WS intents** (DM and player). These are commands per ADR-0016, and none is logged. A note that is unreadable or doesn't exist gets the same `not_found`.

| Intent | Validation / ownership |
|---|---|
| `notes.create {title, shared, body?}` | FR-NOTES-01, -05, -06 |
| `notes.rename {noteId, title}` | Readable; FR-NOTES-05, -11 |
| `notes.share {noteId}` / `notes.copyPrivate {noteId}` | Author only; FR-NOTES-04 |
| `notes.delete {noteId}` | FR-NOTES-12 |
| `notes.open {noteId, clientId, version?}` / `notes.close {noteId}` | Readable; FR-NOTES-13, -16 |
| `notes.push {noteId, version, updates}` | Readable, from the bound `clientId`; FR-NOTES-14, -19 |

**Signals and frames**

| Name | Kind | Who gets it |
|---|---|---|
| `notes.cursor` | Client signal with an `audience` hook | §8.3 |
| `notes.updates`, `notes.backlinks`, `notes.closed` | Server signals (ADR-0071) | Subscribers who can read the note. `notes.backlinks` goes only to a viewer whose list changed |
| `note` record changes, cause `NoteChanged` | Event | Readers |

**REST:** `GET /api/notes/search?q=`, with a DM bearer or a player token, like compendium search (FR-NOTES-23).

## 10. Permissions

The rules are FR-NOTES-02 to -05, -11 and -12. The server checks every intent (§9), and the owner gate filters every frame.

## 11. Edge cases & failure modes

| Case | Rule |
|---|---|
| Disconnect, reconnect, crash | FR-NOTES-16, -17 |
| Concurrent edits, two tabs | FR-NOTES-14, -15 |
| Deleted mid-edit, campaign switch | FR-NOTES-18 |
| Over the size limit | FR-NOTES-19 |
| Bad change JSON | `invalid` |
| Someone else's note ID | `not_found` |

## 12. Performance & bandwidth

- **Snapshots: 0 B** (lazy), so the CON-44 ceilings (DM 1.5 MiB, players 512 KiB) don't move.
- **Load on Notes open:** about 250 B per `note` row. That's about 63 KB at 200 shared and 50 own private notes, and about 430 KB at the limits, under the 4 MiB result cap. The first slice measures it with `lazyLoadSizes`.
- **Typing and cursor traffic, and search cost:** see the [ADR](../architecture/adr/proposed-note-co-writing.md#limits-and-load).
- **Editor:** its own chunk, loaded only when Notes opens. The editor slice measures it in both bundles.

## 13. Test plan

See [linked-notes-build §1](linked-notes-build.md#1-test-plan): fixtures, the `notes` bundle, unit, integration and leak tests, e2e, and a walkthrough with three people typing in one note. Each worktree runs it in isolation ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md), [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md)).

## 14. Dependencies

| On | What | Status |
|---|---|---|
| DM | `@codemirror/state`, `view`, `collab`, `commands` (MIT) | Approved; exact set in the ADR |
| [live-sync](live-sync.md) | Owner gate in `records.ts`, lazy types, server signals | Proposed ADR |
| [compendium](compendium.md) | A `[[…]]` run hook in `MarkdownLite` | OQ-12 |
| [dice-extras](dice-extras.md) | `DiceText` with the label "Note" | Exists |
| [play-shell](play-shell.md) | Window, launcher and palette rows | Append-only registries |

## 15. Open questions

**Bold** = pick. OQ-01 to OQ-09 go to the gate.

| ID | Question | Options | Blocking? | Affects |
|---|---|---|---|---|
| OQ-NOTES-01 | Who can delete a shared note? | **A: its author or the DM**; B: anyone at the table; C: its author only | Yes | FR-12 |
| OQ-NOTES-02 | Titles, and what happens when they clash | **A: shared titles unique among shared notes, private titles unique per author; when you can read both, `[[X]]` opens a chooser**; B: as A, but your own note opens; C: as A, but the shared note opens | Yes | FR-05, -09 |
| OQ-NOTES-03 | Clicking a missing link creates… | **A: a shared note if clicked in a shared note, otherwise a private one**; B: always a private note; C: ask each time | Yes | FR-08 |
| OQ-NOTES-04 | When a note is renamed, links to the old title… | **A: are rewritten in every note the renamer can read**; B: stay, and show as missing | Yes | FR-11 |
| OQ-NOTES-05 | Reading vs editing | **A: rendered page with an Edit button**; B: always the editor | Yes | FR-20 |
| OQ-NOTES-06 | The author of a shared note wants it private | A: it disappears for everyone else, like a delete; B: refused while anyone else has it open; **C: the author gets a private copy and the shared note stays** | Yes | FR-04 |
| OQ-NOTES-07 | Private notes are stored unencrypted in the DM's database file and backups | **A: accept, and say so in Notes' help line**; B: encrypt per player (keys in player links; a big job) | Yes | FR-02 |
| OQ-NOTES-08 | Limits | **A: 32 KiB per body (~5,000 words), 100-character titles, 1,000 shared notes, 300 private per author**; B: 64 KiB bodies | Yes | FR-01, -06 |
| OQ-NOTES-09 | Label on rolls from a note | **A: "Note"**; B: the title, for shared notes | Yes | FR-21 |
| OQ-NOTES-10 | MCP tools for shared notes? | **A: not in this slice**; B: a read-only tool now | No (owner: agent-api) | FR-24 |
| OQ-NOTES-11 | Glossary: add Note, Private note, Shared note, Wikilink, Backlink. "Share / Unshare" (handouts), "Share" (game log) and session-recap's "share note" each gain a "not a shared note" line | **A: add them** | No (owner: integrator) | Glossary |
| OQ-NOTES-12 | Cross-spec: compendium's `MarkdownLite` gains a `[[…]]` run hook | **A: the orchestrator assigns it to the window slice** | No (owner: orchestrator) | Compendium |

## 16. Out of scope

- **Out of scope**, each with the room left for it:
  - Images: an image run on asset IDs ([ADR-0023](../architecture/adr/0023-asset-access-by-capability-id.md)).
  - Tags and folders: a new table or column.
  - Quest log, calendar, session timeline, NPC directory: a note `kind`.
  - Obsidian import: create notes from `[[Title]]` text.
  - MCP for shared notes: a read tool on the owner-gated `note` type (OQ-10).
  - Pop-outs: FR-SHELL-201, one per note.
  - Links to tokens, creatures or compendium entries.
