---
title: Linked notes
prefix: NOTES
status: in-review
owner: spec-linked-notes
phase: post-mvp
---

# Linked notes

> **For the DM's gate:** ten product questions in [§15](#15-open-questions), short form in `.verify/gate.md`. Written against the bold picks. Test plan and build split: [linked-notes-build](linked-notes-build.md). Co-writing design: [proposed ADR](../architecture/adr/proposed-note-co-writing.md). Private notes hidden from the DM: [proposed ADR](../architecture/adr/proposed-owner-only-records.md).

## 1. Summary

- Players and the DM write **notes**. A note is **private** (its author only) or **shared** (the whole table). The author can switch it.
- `[[Title]]` links one note to another by title; each note lists its **backlinks**.
- People co-write shared notes live, Google Docs style: they see each other's typing and cursors.

## 2. Scope

- A Notes window in both clients: list, search, read, edit, links, backlinks, co-writing.
- A note may share a name with a token or creature; nothing ties them. Handouts ([party-board](party-board.md)) are unchanged.

## 3. Goals

- Own notes and the party's shared notes in one place, linked and searchable.
- Three people type in one shared note at once; nothing is lost while connected.
- A private note never reaches anyone but its author ([§8.3](#83-field-visibility)).

## 4. Non-goals

- World builder, reveal, DM-only parts; version history, comments, rich text.

## 5. User stories

- **Player:** I keep private notes on NPCs; the party edits a shared "Quest log" during play.
- **DM:** I write shared recaps the party can edit and private prep that stays mine; I never see a player's private notes.

## 6. Functional requirements

**Notes and who sees them**

| ID | Requirement |
|---|---|
| FR-NOTES-01 | Anyone at the table (DM or a player) creates a note: title 1–100 characters (trimmed), body plain text with MarkdownLite, at most 32 KiB UTF-8. A note from **New note** starts private. |
| FR-NOTES-02 | A **private** note reaches only its author's connections (every tab). Nothing about it reaches anyone else: no title, body, existence, count, ID, link target, backlink, search hit, timing, error wording or frame. That includes the DM's connections and the MCP tools ([proposed ADR](../architecture/adr/proposed-owner-only-records.md)). |
| FR-NOTES-03 | A **shared** note can be read and edited by every player and the DM of the campaign. |
| FR-NOTES-04 | Only the author switches a note between private and shared. Making it shared is refused if a shared note with the same title exists. Making it private gives every other viewer exactly what a delete gives them (FR-NOTES-12). |
| FR-NOTES-05 | Titles are compared folded (the shared matcher's `fold`, so case and accents are ignored). Create, rename and share check a title only against what the actor can read: shared notes and the actor's own private notes. They never check anyone else's private notes, so one viewer can end up with two readable notes of the same title (FR-NOTES-09). |
| FR-NOTES-06 | Caps: 1,000 shared notes per campaign, 300 private notes per author. A refusal names only a cap the actor can see. |

**Links and backlinks**

| ID | Requirement |
|---|---|
| FR-NOTES-07 | `[[Title]]` and `[[Title\|label]]` link by folded title. Each viewer's client resolves links among the notes it can read; the server is never asked. |
| FR-NOTES-08 | A link with no readable target shows as missing. Clicking it creates a note with that title and opens it. **The new note is shared if the note it was clicked in is shared, private otherwise** (OQ-03). |
| FR-NOTES-09 | If two readable notes have the same title, clicking opens **a chooser listing both, marked Private and Shared** (OQ-02). |
| FR-NOTES-10 | An open note lists its backlinks: readable notes that link to it. The list updates ≤ 2 s after a linking note is saved (FR-NOTES-17). A connection gets an update only when its own list changed. |
| FR-NOTES-11 | Anyone who can edit a note can rename it. **A rename rewrites `[[Old]]` as `[[New]]`, keeping the label, in every note the renamer can read. Other people's private notes are untouched** (OQ-04). |
| FR-NOTES-12 | **A private note can be deleted by its author; a shared note by its author or the DM** (OQ-01). A confirm dialog comes first; there is no undo. For everyone but the author, delete and make-private look the same: one event type (`NoteChanged`), a record delete and `notes.closed {noteId}`. The frames are byte-identical apart from `seq`. |

**Co-writing** ([proposed ADR](../architecture/adr/proposed-note-co-writing.md))

| ID | Requirement |
|---|---|
| FR-NOTES-13 | Opening a note subscribes the connection. The body arrives with its version, and every accepted change reaches every subscriber ≤ 300 ms on a LAN, in read mode and edit mode alike. |
| FR-NOTES-14 | The server holds each open note's text and version. It accepts a change only at the current version; otherwise the client rebases on the changes it receives and resends. No typing is lost or duplicated while connected. |
| FR-NOTES-15 | In edit mode, others' carets and selections show with a name tag in their colour (`player.color`, `campaign.dmColor`). A tab of your own shows as "You". Cursors are transient, sent for shared notes only, and gone ≤ 10 s after the person leaves. |
| FR-NOTES-16 | Typing while disconnected stays local and is sent, rebased, on reconnect. The client resumes from its version if the server still holds the changes since then; otherwise it reloads the note, and FR-NOTES-17's banner applies. |
| FR-NOTES-17 | **The body is saved ≤ 2 s after typing pauses, at least every 10 s while typing continues**, when the last viewer leaves, and at clean shutdown. A crash loses at most the last 10 s (OQ-09). If a reload drops text the client had, a banner says "Some recent typing was lost", with **Copy my text**. |
| FR-NOTES-18 | If a note is closed under someone (deleted, made private, or the campaign switched), they get the banner "This note is no longer available" with **Copy my text**, and the editor closes. |
| FR-NOTES-19 | A change that would take the body over 32 KiB is refused ("Note is full"). A paste whose frame would exceed 64 KiB is refused locally ("Too long to paste at once"). |

**Reading, search, the rest**

| ID | Requirement |
|---|---|
| FR-NOTES-20 | **A note opens rendered** (MarkdownLite): links per FR-NOTES-07 to -09, and dice notation as `DiceText` roll buttons. **Edit** switches to the editor (OQ-05). `[label](target)` shows the label only. |
| FR-NOTES-21 | **A roll from a note uses the label "Note"**, never the title, and follows normal roll visibility (OQ-10). |
| FR-NOTES-22 | Typing `[[` in the editor offers the titles the viewer can read (shared matcher); Enter inserts `[[Title]]`. |
| FR-NOTES-23 | Search matches the titles and bodies of the notes the viewer can read, with the shared matcher (`src/shared/search/`): up to 50 results, each with its title and a snippet. The server reads only shared notes and the viewer's own private notes (two indexed reads), so neither results nor time depend on anyone else's private notes. |
| FR-NOTES-24 | Notes add nothing to the event log, game log, session recap, stats, notifications or snapshots. Server log lines carry note IDs only, never titles or bodies. No MCP tool reads notes (OQ-11). |
| FR-NOTES-25 | New tables only (`note`, `note_link`, #416). A DB without them boots, with the tables empty. |
| FR-NOTES-26 | Leak tests per [build §1](linked-notes-build.md#1-test-plan): player-1, player-2 and the DM each have a private note with canaries. No other client's frame, snapshot, load, REST answer, MCP result, event log row or server log line holds those canaries. |

## 7. UI/UX notes

Gilt & Stone kit and [visual-direction](../design/visual-direction.md) only. Window `notes.main` in both clients, placed per [ADR-0025](../architecture/adr/0025-play-shell-windows.md) / [0060](../architecture/adr/0060-one-window-placer.md) and remembered per [0064](../architecture/adr/0064-window-memory.md). Size row: default 760 × 560, useful 560 × 420, min 360 × 320 ("list + 300 px of note"). Opened from the launcher ("Notes") and the command palette ("Open Notes", "New note").

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

- **Read:** rendered; links underlined, missing ones dotted; name chips of who is in the note. **Edit:** CodeMirror with others' carets; Esc or Done returns.
- **States:** empty ("No notes yet"), loading, error + Retry, disconnected (FR-SYNC-24 banner; editing goes on).
- **Narrow (< 520 px):** the list becomes a dropdown. **DM view = player view**, plus Delete on others' shared notes (OQ-01).
- **Test IDs:** `notes-new`, `notes-search`, `notes-list-item` (+ `data-record-id`), `notes-share-toggle`, `notes-edit`, `notes-editor`, `notes-rename`, `notes-delete`, `notes-link` (+ `data-title`), `notes-chooser`, `notes-backlinks`, `notes-cursor` (+ `data-player-id`), `notes-banner`, `notes-copy-text`.

## 8. Data model

### 8.1 Tables (new)

| Table | Field | Notes |
|---|---|---|
| `note` | `id`, `campaignId` | ids from `ctx.ids` |
| | `title`, `titleFold` | index (`campaignId`, `titleFold`) |
| | `shared` | boolean |
| | `authorRole`, `authorPlayerId` | `dm` or a player; index (`campaignId`, `shared`) and (`campaignId`, `authorRole`, `authorPlayerId`) |
| | `body`, `version` | saved text and its version (FR-NOTES-17) |
| | `createdAt`, `updatedAt`, `updatedByRole`, `updatedByPlayerId` | `ctx.clock` |
| `note_link` | `noteId`, `targetFold` | one row per distinct link target, rebuilt at each save; index `targetFold` |

### 8.2 Record and frames

- Record type **`note`**, campaign scope, `lazy: "all"`: `{id, campaignId, title, shared, author {role, playerId?}, updatedAt, updatedBy {role, playerId?}}`. No body. `ownerOf` = `null` if shared, else the author ([owner gate](../architecture/adr/proposed-owner-only-records.md)).
- The body travels only in co-writing results and frames ([ADR](../architecture/adr/proposed-note-co-writing.md)): `notes.open` results, `notes.updates`, `notes.cursor`, `notes.backlinks`, `notes.closed`.
- **Relations:** `note` → campaign and author (player or DM); `note_link` → its source `note`. Targets are titles, not keys.
- **Derived:** link resolution and the `[[` list (client side, from readable `note` rows); backlinks (server side, `note_link` filtered per viewer).
- **Persisted runtime state:** none. Sessions, subscriptions and cursors live in memory.

### 8.3 Field visibility

| Data | Author | Others at the table (DM included) |
|---|---|---|
| Private note: record, body, version, links, backlinks, search hits, updates, `notes.closed` | yes | never; no frame at all, `seq` unchanged |
| Private note ID in an intent from someone else | — | `not_found` "Note not found", same as a note that doesn't exist |
| Shared note: record, body, updates, backlinks, search hits | yes | yes |
| Cursor (`notes.cursor`) | — | shared notes only, to the players in that note and DM connections (FR-SYNC-28); never stored |
| `[[X]]` in a shared note where X is someone's private note | the author's client resolves it | missing (dotted); clicking creates their own X |
| Title clash errors | only against readable notes | only against readable notes |
| Event log, game log, recap, stats, notifications, server log text | nothing | nothing |

## 9. API & events

**WS intents** (DM and player; commands per ADR-0016; nothing logged)

| Intent | Validation / ownership |
|---|---|
| `notes.create {title, shared, body?}` | FR-NOTES-01, -05, -06 |
| `notes.rename {noteId, title}` | readable; FR-NOTES-05, -11 |
| `notes.setShared {noteId, shared}` | author only; FR-NOTES-04 |
| `notes.delete {noteId}` | FR-NOTES-12 |
| `notes.open {noteId, version?, epoch?}` / `notes.close {noteId}` | readable; result `{doc, version, epoch, backlinks}` or `{updates}` |
| `notes.push {noteId, version, updates}` | readable; result `{accepted}`; FR-NOTES-14, -19 |

Unreadable or missing → `not_found`, one message for both.

**Signals and frames**

| Name | Kind | Who gets it |
|---|---|---|
| `notes.cursor {noteId, version, ranges}` | client signal, `audience` hook | §8.3 |
| `notes.updates`, `notes.backlinks`, `notes.closed` | server signals (ADR-0071 seam) | subscribers who can read the note; backlinks only when that viewer's list changed |
| `note` record changes, cause `NoteChanged` | event | readers per §8.3 |

**REST:** `GET /api/notes/search?q=` (DM bearer or player token, as compendium search): FR-NOTES-23.

## 10. Permissions

Rules in FR-NOTES-02 to -04, -11, -12. The server checks each intent (§9); the owner gate filters every frame.

## 11. Edge cases & failure modes

- **Disconnect, reconnect, crash:** FR-NOTES-16, -17; the snapshot purges `note` rows (FR-SYNC-37), open notes resume or reload.
- **Concurrent edits, two tabs:** FR-NOTES-14, -15. A rename rewrite is one server change, ordered like any push.
- **Deleted or made private mid-edit:** FR-NOTES-18.
- **Malicious input:** bad change JSON → `invalid`; an oversized frame → closed (FR-SYNC); another's note ID → `not_found`.

## 12. Performance & bandwidth

- **Snapshots: 0 B** (lazy), so CON-44 (DM 1.5 MiB, players 512 KiB) is unchanged.
- **Load on Notes open:** about 250 B per `note` row. At 200 shared + 50 own private notes that is about 63 KB; at the caps with 100-character titles, about 430 KB, under the 4 MiB result limit. Measured in the first slice (`lazyLoadSizes`).
- **`notes.open`:** ≤ 32 KiB body plus backlinks (≤ ~80 KB at caps).
- **Typing:** ≤ 10 pushes/s per typist, ~200 B each; 3 typists, 4 subscribers ≈ 24 KB/s up the DM's tunnel. **Saves:** a ~300 B `note` upsert to every reader (FR-SYNC-34), at most every 2–10 s per active note.
- **Editor chunk:** loads on Notes open only; the editor slice measures it in both bundles.

## 13. Test plan

In [linked-notes-build §1](linked-notes-build.md#1-test-plan): unit, integration, leak, e2e, the `notes` bundle and a three-person co-writing walkthrough, isolated per worktree ([ADR-0008](../architecture/adr/0008-parallel-dev-isolation.md), [ADR-0017](../architecture/adr/0017-agent-verification-fixture-library.md)).

## 14. Dependencies

| On | What | Status |
|---|---|---|
| DM | `@codemirror/state`, `view`, `collab`, `commands` (MIT) | approved; exact set in the ADR |
| [live-sync](live-sync.md) | owner gate in `records.ts`; lazy types; server signals | gate: proposed ADR |
| [compendium](compendium.md) | a `[[…]]` run hook in `MarkdownLite` | OQ-13 |
| [dice-extras](dice-extras.md) | `DiceText` with label "Note" | exists |
| [play-shell](play-shell.md) | window, launcher, palette rows | append-only registries |
| [agent-api](agent-api.md) | MCP client keeps no `note` frames | OQ-13 |

## 15. Open questions

**Bold** = pick. OQ-01–10 are for the gate.

| ID | Question | Options | Blocking? | Affects |
|---|---|---|---|---|
| OQ-NOTES-01 | Who may delete a shared note? | **A author or DM**; B anyone at the table; C author only | yes | FR-12 |
| OQ-NOTES-02 | You can read two notes called X (yours private, one shared): what does `[[X]]` open? | **A chooser**; B yours; C the shared one | yes | FR-09 |
| OQ-NOTES-03 | Clicking a missing link creates a note that is… | **A shared if clicked in a shared note, else private**; B always private; C ask each time | yes | FR-08 |
| OQ-NOTES-04 | On rename, links to the old title… | **A are rewritten in notes the renamer can read**; B stay and show as missing | yes | FR-11 |
| OQ-NOTES-05 | Read vs edit | **A rendered, Edit button for the editor**; B always the editor (links and dice as decorations) | yes | FR-20 |
| OQ-NOTES-06 | The author makes a shared note private while others are in it | **A it leaves their screens at once, like a delete, with Copy my text**; B refused while anyone else has it open | yes | FR-04, -18 |
| OQ-NOTES-07 | Private notes sit in the DM's database file and backups, unencrypted | **A accept, say so in Notes' help line**; B encrypt per player (keys in player links; large) | yes | FR-02 |
| OQ-NOTES-08 | Limits | **A body 32 KiB (~5,000 words), title 100, 1,000 shared, 300 private each**; B 64 KiB bodies (chunked pushes) | yes | FR-01, -06 |
| OQ-NOTES-09 | Typing lost in a crash | **A ≤ 10 s (save after 2 s pause, at most every 10 s)**; B ~0 (save every change; more disk writes) | yes | FR-17 |
| OQ-NOTES-10 | Label on rolls from a note | **A "Note"**; B the title for shared notes | yes | FR-21 |
| OQ-NOTES-11 | MCP tools for shared notes? | **A not in this slice** (room in §8.4); B read-only tool now | no (owner: agent-api) | FR-24 |
| OQ-NOTES-12 | Glossary: add Note, Private note, Shared note, Wikilink, Backlink; "Share" (game log) gets a "not a shared note" line | **A add** | no (owner: integrator) | glossary |
| OQ-NOTES-13 | Cross-spec: compendium's `MarkdownLite` gains a `[[…]]` run hook; agent-api's MCP client drops frames of types its tools don't read | **A orchestrator assigns both lines to notes slices** | no (owner: orchestrator) | compendium, agent-api |

## 16. Out of scope

One line each on the room the model leaves:

- **Images:** a MarkdownLite image run on asset IDs ([ADR-0023](../architecture/adr/0023-asset-access-by-capability-id.md)); the body stays text.
- **Tags, folders:** a `note_tag` table or a `folder` column (new only).
- **Quest log, calendar, session timeline, NPC directory:** notes with a `kind` the list filters on.
- **Obsidian import:** `[[Title]]` is Obsidian's syntax; import = create notes.
- **MCP access to shared notes:** a read tool on the `note` type; the owner gate keeps private ones out (OQ-11).
- **Pop-outs:** FR-SHELL-201 `popout: true`, one per note.
- Links to tokens, creatures or compendium entries.
