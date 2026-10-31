---
title: Linked notes
prefix: NOTES
status: in-review
owner: spec-linked-notes
phase: post-mvp
---

# Linked notes

> **For the DM's gate.** Fifteen blocking questions are in [§15](#15-open-questions). This spec is written against the bold picks; none is decided. The table at the top of §15 lists every requirement that rests on a pick. Test plan and build split: [linked-notes-build](linked-notes-build.md). This is a reference spec, not a five-minute read.

## 1. Summary

- DM-written **notes** with **wikilinks** and **backlinks**, in one Notes window, that the DM can **reveal** to everyone or chosen players, searchable by what each viewer may read.
- A hidden note is not just out of sight: no frame, ack, count, ID, error, search result or search time tells a player about it. Every field has a rule in [§8.3](#83-field-visibility) and a leak test per player.
- 0 B in every snapshot: all note data loads on open ([ADR-0045](../architecture/adr/0045-lazy-record-types.md)).

## 2. Scope

Sprint 15 scope: notes, wikilinks, backlinks, reveal, search. Beyond it, each up to the gate: DM part (OQ-08), link kinds other than notes (OQ-05), MCP tools (OQ-07), and the extras (OQ-18): toast, New / Updated, Preview, images, tags, Compare, pop-out.

## 3. Goals

- The DM writes `[[`, picks a note, and it links; renaming the target never breaks it.
- The DM sees at a glance who can read a note and how they will read it, before revealing.
- Reveal reaches a player ≤ 1 s after commit; a player without access gets no frame at all.
- A half-typed note survives a dropped connection, a server crash and a reload.
- The real campaign upgrades itself: new tables only, empty, clean boot.

## 4. Non-goals

- Version history or undo of notes; folders; graph view; typed relations (room left, [§8.4](#84-room-left-not-built)).
- Showing a note over players' screens: handouts do that ([party-board](party-board.md)). Handouts stay; a note is the DM's world record, a handout the thing you hand over.

## 5. User stories

- **DM:** I write linked notes so my world stops living in Obsidian; I reveal the Mayor's note without revealing the traitor it mentions.
- **Player:** I find everything I've been given in one list, follow its links and search it, and never stumble on what I haven't.

## 6. Functional requirements

Test names start with the FR ID. Rules live here and in §8.3; other sections point.

| ID | Requirement |
|---|---|
| **Records and commands** | |
| FR-NOTES-01 | Tables `note`, `note_link`; record types `note`, `note-body`, `note-links`, `note-dm` ([§8](#8-data-model)), all campaign scope and **lazy**, in no snapshot for any viewer. |
| FR-NOTES-02 | **Input** (strict zod): title clean, 1–120 chars; body and DM part clean text; ≤ 100 links per note. Title and alias hold no `[`, `]`, `\|` or newline; alias no `*`. U+E000–U+F8FF stripped (FR-NOTES-23's sentinels). Title + body + DM part ≤ **60,000 B JSON-encoded** (≈ 55,000 plain English characters), so a save frame stays under the 64 KiB limit ([FR-SYNC-12](live-sync.md#6-functional-requirements)). Breaking any of these → `invalid`. |
| FR-NOTES-03 | `notes.create {title, rawBody?, rawDm?}` (DM): new note is hidden. ≤ 2,000 per campaign. Title unique per campaign by `fold` → else `conflict` naming the note. |
| FR-NOTES-04 | `notes.save {noteId, baseRev, title, rawBody, rawDm}` (DM): full replace in one transaction: row, link rows, event log. Same values → `ack`, no event. `baseRev` ≠ `rev` → `conflict {rev}`, nothing written. **Only `notes.save` bumps `rev`**: a reveal or a binding doesn't, so neither raises "Changed elsewhere". |
| FR-NOTES-22 | **Resolve** (server, one step inside create and save, before compile): input `[[Title]]`, `[[Title\|alias]]`, `[[kind:Name]]`, or already canonical tokens → canonical `[[n:<id>]]`, `[[pc:<id>]]`, `[[creature:<id>]]`, `[[cmp:<id>]]`, each with optional `\|alias`, or `[[?Title]]` for no note match. Matches by exact `fold`, this campaign only (compendium: also global). A non-note name matching several rows → `invalid` "2 creatures named X: pick from the list"; no match → `[[?kind:Name]]`. MCP and import send the same text as the editor. |
| FR-NOTES-05 | **Compile** (pure, `@shared/linked-notes/compile`, canonical text only). `publicText`: a link is its alias, or the fixed text `(unknown)` when it has none. Then `[label](target)` becomes `label`, with the same pattern `markdown.ts` uses, so no target goes on the wire. A `[[` that isn't a whole valid token on its line → `invalid` "line n" (the draft stays). So `publicText` never holds `[[`, an ID, or text the renderer would drop. Test: the words of `publicText` = the words rendered. `contentTag` = first 8 hex of SHA-256 of title + `publicText` + images; bytes never depend on another note's state. |
| FR-NOTES-06 | `notes.delete {noteId}` (DM). If the note isn't hidden, the transaction first emits exactly what a hide emits (players lose it there), then `NoteDeleted`, hidden → hidden for every player: a player's frames for a hide and for a delete are byte-identical apart from `seq`. Own links go. Links pointing at it stay dead, keeping `lastTitle` for the DM. Unknown → `not_found`. |
| FR-NOTES-07 | `notes.reveal {noteId, revealedTo {mode: none\|all\|players, playerIds}, notify = true}` (DM). IDs must be the campaign's players → else `invalid`. Same audience → `ack`, no event. "Everyone" includes players added later. **Never cascades:** linked notes keep their own state. |
| FR-NOTES-08 | **Visibility** (pure, `@shared/linked-notes/visibility`, record + viewer only): DM full; a player sees `note`, `note-body`, `note-links` iff `mode = all` or they're in `playerIds`, else **hidden**. The visible `note` is a **whitelist** ([§8.2](#82-record-types)), never a denylist. `note-dm` is `audience: dm`. |
| FR-NOTES-09 | **Quiet:** every note event sets `quietWhenUnchanged`. An edit a player can't see (hidden note, DM part, reveal to someone else, a hidden target's rename, reveal or delete) sends that player **no frame and no `seq` step**. |
| FR-NOTES-10 | **Link visibility:** a player receives a link span only if it's in the body part, and the source is visible, and the target is visible by kind: note → FR-NOTES-08; character → always (name only, [ADR-0024](../architecture/adr/0024-definition-visibility.md)), the name read from the `entity` row they already hold; creature → never (ADR-0024); compendium → `entryVisibleTo`, name in the span; dead or unresolved → never. No span means the text stays as `publicText` has it; nothing in the frame says a link was there. |
| FR-NOTES-11 | **Flips:** every change to a target's visibility or name lists `note-links` of each source in the same transaction's event. Notes: reveal, hide, delete, rename. Compendium: a new `compendium` entry hook on save, share and delete. Characters and creatures: a hook on entity delete; renames need none (the name comes from the `entity` row). Bodies aren't resent. |
| FR-NOTES-12 | **Unresolved and binding:** `[[?Title]]` shows as hidden to players and as create-on-click to the DM. Creating a note with that title, or renaming one onto it, rewrites sources' raw tokens in the same transaction and lists their `note-dm` and `note-links`. `publicText` and `rev` are unchanged, so players get nothing and open editors keep working: their `[[Title]]` resolves the same way at Save. |
| FR-NOTES-13 | `notes.backlinks {noteId}` (DM, player; read-only) → `{backlinks [{noteId, title, snippet ≤ 160, dmPart?}]}`. DM: every source, snippet from that part's compiled text, `dmPart` marked. Player: only sources visible to them, via a body-part link, and only if the target is visible to them; snippet from `publicText` only; no `dmPart` key. Hidden or unknown `noteId` → `{backlinks: []}`, never a reject. The count is the list's length; none is stored. |
| FR-NOTES-14 | `notes.search {q ≤ 200 chars, limit ≤ 50}` (DM, player; read-only) with the shared matcher (`searchTier`, FR-CMP-32 / -33). DM text: title, raw body, DM part. Player text: title + `publicText` minus `(unknown)`, of notes visible to them. **Filter first, match after:** the visible set comes from an index on `revealMode` that never touches a hidden row. A per-note word cache fills on demand **for the notes in that search's set only**, so a player's time depends only on what they can read; DM entries are separate and DM-only. Tiers only, no corpus statistics. → `{results [{noteId, title, snippet ≤ 160}]}`; miss → `{results: []}`. *Accepted residual:* a note revealed only to others costs microseconds in the index walk; a player can't time a hidden note at all. |
| FR-NOTES-15 | **Same answer for hidden and unknown:** roles are checked before any lookup, so a player's write intent → the same `forbidden` for a hidden, visible or unknown ID. Reads and `sync.load` return absent rows, not errors ([FR-SYNC-32](live-sync.md#6-functional-requirements)). `sync.load note-dm` by a player → `forbidden` with IDs, `invalid` without (as every `ids` type, `hub.ts`), never depending on a note. |
| FR-NOTES-16 | Notification kind `note-revealed` (info): one row per gaining player, in the command's transaction; none if `notify` is false, none to losers or the DM. Text is generic ("The DM revealed a note"), payload `{noteId \| null}`. **No title in the row.** The view loads with `useLazyRecords(note, [noteId])` and decides with `isLoaded`. On hide or delete the same transaction sets that player's `noteId` to null and lists the row; the view then says "A note you no longer have", no Open. `updateNotification` refuses non-pending rows, so this is a direct update as in `dice-extras/owner-hook.ts`, or a small notifications helper. |
| FR-NOTES-17 | `notes.previewAs {noteId, playerId}` (DM; read-only): the note as that player would load it **if they were in its audience**, whatever its state now: `note`, `note-body`, `note-links` through the same fns, with every target's real state. Test: bytes equal that player's own load after a real reveal. |
| FR-NOTES-18 | **No other path:** recap, stats, game log and every other feature read no note table. `Send to game log` isn't offered on notes. Event log payloads hold IDs, `rev`, flags and counts only, never title, text or alias. |
| FR-NOTES-19 | **Images:** `imageAssetIds` 0–10, unique, each via `assets.require`, on `note-body`. `assetUses` gains kind `note`, so "Used in" lists notes, and `assets.delete` refuses an image a note uses (`conflict`, as today): the DM removes it from the note first. A player learns an asset ID only through a visible `note-body` ([ADR-0023](../architecture/adr/0023-asset-access-by-capability-id.md)); IDs already seen stay valid after Hide, as handouts, and the Reveal dialog says so. |
| FR-NOTES-20 | **MCP:** tools `notes_list`, `note_get`, `notes_search` (read) and `note_create`, `note_update` (write, ask first, [FR-AGENT-15](agent-api.md#6-functional-requirements)) over `sync.load` and the intents above ([ADR-0072](../architecture/adr/0072-agent-mcp-server.md) D4). `note_update` **refuses a revealed note** (the tool reads its audience first; a tool-side rule, not a server one) and every result names the audience. No reveal tool. |
| FR-NOTES-21 | **Dice in a note** stay clickable, per `MarkdownLite` / `DiceText`, with the fixed label "Note", in both clients, never the title or any note text, so a roll from a player-1-only note says nothing in the shared log. |
| FR-NOTES-23 | **Link rendering:** the client inserts sentinels (U+E000 index U+E001 … U+E002) around visible spans before `parseMarkdownLite`, and the renderer splits runs on them: this is the seam, since `Run` has no offsets. Text between sentinels renders as a link; `aliased: false` shows the target's name instead of `(unknown)`. Proved first with table, quote, list and bold cases. |
| **DM window** | |
| FR-NOTES-30 | One window type `notes.window` "Notes", both clients, launcher + key: list on the left, note on the right; below 560 px wide the list folds behind a toggle. Close resets to the list and clears the back stack ([FR-SHELL-200](play-shell.md#6-functional-requirements)); minimise keeps; drafts survive both. |
| FR-NOTES-31 | **List:** search box, filter All · Hidden · Revealed, New note. Row: title, reveal Badge ("Hidden" muted / "Everyone" / player names), dead-link mark. By title. Empty: "No notes yet". |
| FR-NOTES-32 | **Note header** always shows the state in words: "Hidden from players" or "Visible to: Player 1". Actions: Edit, Reveal…, Preview as ▾, Delete (inline confirm naming how many notes link here). |
| FR-NOTES-33 | **Editor:** plain text box for the body, a second for the DM part under a "DM only" label, title. `[[` opens a suggestion list (shared matcher; ↑ ↓ Enter; `\|` adds an alias). The editor shows `[[Title]]`; the title ⇄ ID map is taken at edit start and sent as canonical tokens, so a rename during editing keeps the link. While revealed: "Saving updates what Player 1 sees". Live counter from 80 % of the limit. |
| FR-NOTES-34 | **Following:** click follows in place, with back / forward in the window. Note → that note; unresolved → create with that title (DM); character → sheet (a player: own only; another's name stays plain); creature → stat block (DM); compendium → its window. |
| FR-NOTES-35 | **DM's rendering of a link:** live link; eye-off mark + Tooltip when some reader of this note can't see the target ("Player 2 reads: (unknown)"); dead: struck-through `lastTitle` "(deleted)" with Remove; unresolved: dotted, "create". |
| FR-NOTES-36 | **Backlinks:** a "Linked from (n)" panel under the note, title + snippet per row, click follows; refreshes on any received `note` / `note-links` change (debounced 300 ms). DM rows tag "DM part". |
| FR-NOTES-37 | **Reveal dialog:** radio Hidden / Everyone / Chosen players (as the handout Share dialog), checkbox "Tell them" (`notify`), and **What they'll read**: every link the audience can't see, with its rendering and any alias, each with "Reveal that too" (a separate intent). Two clicks minimum. |
| FR-NOTES-38 | **Preview as ▾** a player: renders FR-NOTES-17's answer with the player's component, under a "Preview: Player 2" band. Read-only. |
| FR-NOTES-39 | **Draft:** the editor writes `pp.notes.draft.v1.<campaignId>.<noteId \| new-id>` `{title, rawBody, rawDm, baseRev, at}` to `localStorage` 500 ms after typing stops. ≤ 10 drafts; an 11th drops the oldest and says which; a failed write shows "Not saved on this browser". Save clears it after the `ack`. On open with a draft: "Unsaved draft · Restore · Discard". |
| FR-NOTES-40 | **Edit conflict:** `rev` moves while editing → banner "Changed elsewhere" at once; on Save the `conflict` keeps the draft and offers Keep mine (saves on the new `rev`) or Take theirs. Never overwrites silently. Two tabs on one note share a draft key; a `storage` listener shows "Also open in another tab". |
| FR-NOTES-46 | **Connection:** while not `live`, viewing stays, the editor stays typeable, Save is disabled, "Saved on this browser". Back live, the snapshot purges lazy rows and views reload. A Save in flight at a drop or crash is never resent: after reload, `rev` = base + 1 with equal text → draft cleared, else the draft stays and Save asks. Crash hooks `notes.save` and `notes.reveal` `:before-commit` / `:after-commit`. |
| **Player window** | |
| FR-NOTES-41 | List, search, viewer, links, back / forward, backlinks; "Shared with you" / "Everyone". No edit, reveal, DM part or preview control is rendered, and none has a player intent. Row marks **New** / **Updated** from `pp.notes.v1.<campaignId>.<playerId>` `{seen {noteId: contentTag}}`. Empty: "Nothing yet". Sorted by title (no creation order). |
| FR-NOTES-42 | A note that goes hidden or is deleted while open or away: "This note isn't available", same words for both. Same for a stale palette result's Open. |
| **Shared** | |
| FR-NOTES-43 | Palette: search provider group "Notes" (both clients, `notes.search`, ≥ 2 characters, debounced); commands Open Notes, New note (DM) ([ADR-0067](../architecture/adr/0067-command-registry.md)). |
| FR-NOTES-44 | Fixtures and bundle per [the build doc](linked-notes-build.md); `fixtures:reset-load linked-notes` works from empty and is deterministic. |
| FR-NOTES-47 | **If kept at OQ-18** (cut under the pick): **Tags:** 0–8, each 1–30 chars, column `tags`, on `note` DM wire only, searched by the DM only; a tag edit is quiet. **Compare:** a third conflict action showing mine and theirs read-only, side by side. **Pop out:** `notes-popout` opens the note in its own `notes.entry` window, a pop-out type (FR-SHELL-201, as `cmp.entry`, #422): one per note, read-only, same load, links and "isn't available". |

## 7. UI/UX notes

Per [visual-direction](../design/visual-direction.md) and the Gilt & Stone kit ([kit-parity](post-mvp/kit-parity.md)): window frame, list rows, Badge, Button, Input and Tooltip as they are; prose through `MarkdownLite` (React text nodes, never HTML). No new token or custom style. Screenshot baselines refresh with the slice that adds the window (AGENTS §9.4.1).

### 7.1 Window rows ([ADR-0025](../architecture/adr/0025-play-shell-windows.md), [ADR-0060](../architecture/adr/0060-one-window-placer.md), [ADR-0064](../architecture/adr/0064-window-memory.md))

| Kind | Clients | Default | Useful | Min | Useful-size criterion |
|---|---|---|---|---|---|
| `notes.window` | DM | 720 × 600 | 440 × 400 | 340 × 360 | Header + state line, 8 body lines, list toggle |
| `notes.window` | player | 600 × 560 | 440 × 400 | 340 × 360 | Same |

Launcher window, not default-open, not protected: the placer's ladder while untouched, remembered once moved. `restoreOpen` default (it shows the list without a target).

```text
DM, 720 × 600
┌ Notes ──────────────────────────────────────────────────┐
│ [Search…]                │ Mayor Harbin                  │
│ All · Hidden · Revealed  │ Visible to: Player 1          │
│ + New note               │ Edit Reveal… Preview as ▾ Del │
│──────────────────────────│───────────────────────────────│
│ Mayor Harbin    Player 1 │ Ask Duke Varen○ about the     │
│ The Duke          Hidden │ letter from the old sailor○.  │
│ Thieves' Den    Everyone │ ── DM only ────────────────── │
│                          │ He is lying about the ledger. │
│                          │ ── Linked from (2) ────────── │
│                          │ Thieves' Den: "…see the Mayor"│
└──────────────────────────┴───────────────────────────────┘
○ = some reader of this note can't see the target
```

### 7.2 What a player sees when a note mentions something hidden

The DM writes: `Ask [[Duke Varen]] about [[Duke Varen|the old sailor]]. Beware [[creature:Elite Goblin]]. See [[Burnt Ledger]].` Player 1 may see Duke Varen; Player 2 may not. Burnt Ledger was deleted. Players never receive creatures. Hidden note, hidden creature and deleted note all read the same, and their frames are the same.

| Reader | **B: alias or `(unknown)`** (pick) | A: always `(unknown)` | C: drop it |
|---|---|---|---|
| DM | Ask <u>Duke Varen</u>○ about <u>the old sailor</u>○. Beware <u>Elite Goblin</u>○. See ~~Burnt Ledger~~ (deleted). | same | same |
| Player 1 | Ask <u>Duke Varen</u> about <u>the old sailor</u>. Beware (unknown). See (unknown). | same as B | Ask <u>Duke Varen</u> about <u>the old sailor</u>. Beware . See . |
| Player 2 | Ask (unknown) about the old sailor. Beware (unknown). See (unknown). | Ask (unknown) about (unknown). Beware (unknown). See (unknown). | Ask  about . Beware . See . |

Longer tradeoffs: [the proposed ADR](../architecture/adr/proposed-cross-reference-decision.md).

### 7.3 States and views

Empty: FR-NOTES-31, -41. Loading: skeleton while `useLazyRecords` loads. Error: load reject → Retry. Not available: FR-NOTES-42. Disconnected: FR-NOTES-46, banner per [FR-SYNC-24](live-sync.md#6-functional-requirements). DM view: FR-NOTES-30–40. Player view: FR-NOTES-41, -42. Test IDs: [build doc](linked-notes-build.md#test-ids).

## 8. Data model

### 8.1 Tables (new, additive; start empty)

| Entity | Field | Type | Notes |
|---|---|---|---|
| `note` | id, campaignId (FK cascade) | id | `ctx.ids` |
| | title, titleFold | string | Unique (campaignId, titleFold), a plain column, no expression index |
| | rawBody, rawDm | string | Canonical text (FR-NOTES-22) |
| | publicText | string | Compiled from rawBody |
| | imageAssetIds | **JSON leaf** | Extras |
| | revealMode, revealedPlayerIds | `none\|all\|players`, **JSON leaf** | Index (campaignId, revealMode) |
| | contentTag, rev | string, int | |
| | createdAt, updatedAt | timestamp | `ctx.clock` |
| `note_link` *(server only)* | id, campaignId, sourceId (FK cascade) | id | One row per link; never a record type |
| | part | `body` \| `dm` | |
| | targetKind, targetId | `note\|character\|creature\|compendium`, id \| null | Null = unresolved |
| | unresolved, lastTitle | string \| null | `lastTitle`: DM copy, shown once dead |
| | aliased, at, len | bool, int, int | Span in that part's compiled text (`publicText`, or `rawDm` compiled for snippets) |

- **Relations:** note → campaign; link → source note; link → target (no FK: a target may go, the row stays dead). Index (campaignId, targetKind, targetId) for backlinks and flips.
- **Derived values:** backlinks; dead state; search word cache (server memory; per note and text set; filled on demand, dropped per note on write).
- **Persisted runtime state:** none beyond the tables. Drafts and seen maps are browser-only.

### 8.2 Record types

| Type | Lazy | Wire (player) | Wire (DM) |
|---|---|---|---|
| `note` | `all` | Exactly: `id, campaignId, title, audience (all\|players), contentTag, imageCount` | `id, campaignId, title, revealMode, revealedPlayerIds, contentTag, rev, imageCount, createdAt, updatedAt` |
| `note-body` | `ids` | `id, campaignId, publicText, imageAssetIds` | Same |
| `note-links` | `ids`, derived, has `byIds` | `id, campaignId, links [{at, len, kind, targetId, aliased, name?}]`, spans passing FR-NOTES-10 only | All links with `part`, `state`, `lastTitle` |
| `note-dm` | `ids`, `audience: dm` | Never | `id, campaignId, rawBody, rawDm, rev` |

- **Raw text lives only in `note-dm`:** the types a player can load hold none, so a redaction bug can't send an ID or alias of a hidden target.
- `note-links` is computed by joining `note_link` to each target's current state, so no copy can go stale; the per-link audience is server-only and stripped on the wire. `derived` with `lazy` has no precedent and no guard against it (`records.ts`); N1 proves it end to end.

### 8.3 Field visibility

| Field | DM | Player **with** access | Player **without** |
|---|---|---|---|
| Note ID | ✓ | ✓ | Never, in any frame (one who lost access: already seen, in no later frame beyond the delete) |
| Title | ✓ | ✓ | Never |
| Body text | Raw + compiled | `publicText` only | Never |
| Link target ID | ✓ | Only if the target is visible to them | Never |
| Link display text | Title or alias | Title or alias if visible; else alias as plain words or `(unknown)` | Never |
| Alias of a hidden target | ✓ | Plain words in `publicText` (pick OQ-04), listed in the Reveal dialog | Never |
| Markdown link target, malformed token | ✓ raw | Never: stripped or refused at compile | Never |
| DM part, its links, aliases | ✓ | Never, even when the note is revealed | Never |
| Backlinks, count, snippet | All | Visible sources only; count = list length; snippet from `publicText` | `[]` |
| Search results, count, snippet, time | All | Visible notes; from `publicText`; time depends only on their set | Same bytes as a miss |
| Attachments (asset IDs), image count | ✓ | ✓ | Never |
| Tags (if kept) | ✓ | **Never**, not searched either | Never |
| createdAt, updatedAt, reveal time | ✓ | **Never on a note record** | Never |
| `rev` | ✓ | **Never**; `contentTag` replaces it (no edit count) | Never |
| Author | No field: only the DM writes | — | — |
| Audience | Full, with IDs | `all` / `players`, no IDs (as [FR-PARTY-07](party-board.md#6-functional-requirements)) | Never |
| Total note count | ✓ | Own visible rows only | Same |
| Event log entry | DB only | No client path: `readEventLog` has only test callers. `cause.name` comes only on a frame already carrying a visible change, and is the same for hide and delete | None |
| Notification | None | Own row: generic text, `noteId` until they lose the note. **Exception, accepted:** its `createdAt` is the time they gained the note, and it stays. Campaign-wide `seq` gaps show other rows exist (any feature's, already so today) | No row |
| Session recap | No note data | No note data: `compose.ts` reads no note table | Same |
| Game log | Rolls from a note: label "Note". No note text | Same | Same |
| MCP | DM caller, full; results go to the model provider ([OQ-AGENT-12](agent-api.md#15-open-questions)) | No path (DM secret only) | Same |
| Error wording | Names the note | Same `forbidden` / empty for any ID | Same |
| Draft, seen map | DM browser only | Own browser; `contentTag`s of notes they saw | Nothing |

### 8.4 Room left, not built

| Later | How the model leaves room |
|---|---|
| Quest log | A quest row holds a `noteId` for its text and adds status; `note_link.targetKind` gains `quest`; the same reveal rule applies. |
| In-game calendar | A nullable `note.gameDate` added later, with its own field rule; nothing here assumes real-world dates. |
| Session timeline | Entries point at notes by ID. Notes store no session, so [ADR-0013](../architecture/adr/0013-session-journal-scope.md) stands. |
| NPC directory | Player notes get **their own table**, so `note`'s unique title stays as is and a uniqueness `conflict` can't reveal a hidden DM note. Links into `note` use the same span rule. |
| Journal sections | The body / DM-part split generalises to a `note_section` table, each with its own reveal; `note_link.part` already scopes a link to a part. |
| Map pins | A pin row on a scene holds a `noteId`. It can't be "visible iff its note is" by lookup (ADR-0021, ADR-0024 option C): the pin holds an audience copy, refreshed by a reveal hook that `notes.reveal` runs and whose changes it lists, as ADR-0024's copies do. |
| Obsidian import | `[[Title]]` input and unresolved links are the import format; a thin importer calls `notes.create` / `notes.save`, then bindings resolve. |
| Typed relations, graph | `note_link` gains a nullable `relType` (OQ-01's other half). |

## 9. API & events

**REST:** none. Everything is WS, including reads, so no new route takes a player credential. **Intents:** FR-NOTES-03, -04, -06, -07, -13, -14, -17; lazy loads via `sync.load` ([FR-SYNC-31](live-sync.md)). Read intents have no bus, write, log or `seq` (as `recap.query`) and `ack` to the sender only.

**WS events** are generic record changes per [FR-SYNC-19](live-sync.md#6-functional-requirements), all `quietWhenUnchanged`. All logged; none undoable. Protocol and data-model docs change with the code (AGENTS §9.9).

| Domain event (payload) | Changes | Visibility per connection |
|---|---|---|
| `NoteCreated` (`noteId`) | `note`, `note-body`, `note-links`, `note-dm`; bound sources' `note-dm`, `note-links` | DM only: a new note is hidden, and a binding leaves players' records unchanged |
| `NoteSaved` (`noteId, rev, publicChanged`) | `note`, `note-dm`; `note-body` and `note-links` if public content or links changed; on a rename, sources' `note-links` and bound sources' `note-dm` | DM all. Player with access: public changes only; none for a DM-part edit. Source readers: only if the target is visible to them. Others: no frame |
| `NoteAudienceChanged` (`noteId, mode, playerCount`) | `note`, `note-body`, `note-links`; sources' `note-links`; `note-revealed` rows created or scrubbed | Gainers: upserts + own row. Losers: deletes + own row scrubbed. Unchanged access: nothing, or the header if `audience` flipped. Others: no frame |
| `NoteDeleted` (`noteId`) | Deletes own four; sources' `note-links` | DM only: players already lost it in the `NoteAudienceChanged` before it (FR-NOTES-06) |

## 10. Permissions

Every write intent is DM only, roles before lookup (FR-NOTES-15). Reads per [§8.3](#83-field-visibility). MCP: DM secret ([ADR-0072](../architecture/adr/0072-agent-mcp-server.md)).

## 11. Edge cases & failure modes

| Case | Where |
|---|---|
| Player disconnect / reconnect; hidden while away | FR-NOTES-42, -46, -16 |
| DM disconnect with a half-typed note; server crash mid-save; browser crash | FR-NOTES-39, -46 |
| Concurrent edits, multiple DM tabs, reveal during an edit | FR-NOTES-04, -40 |
| Target renamed, deleted, hidden | FR-NOTES-06, -11, -12 |
| Hide after a player read it: bytes stay until the delete lands; images stay fetchable (accepted, ADR-0023) | FR-NOTES-19 |
| Campaign scope: scope gate; campaign delete cascades; another campaign's ID doesn't resolve | FR-NOTES-08, -22 |
| Malicious input: zod; React text nodes only; `sync.load` of guessed IDs returns nothing; oversize → `invalid`, or `1009` above 64 KiB, which the client counter prevents | FR-NOTES-02, -15 |
| Player removal doesn't exist today (CAMP §2, `player-hooks.ts`), so `revealedPlayerIds` can't go stale. A later removal adds a hook | — |

## 12. Performance & bandwidth

**CON-44: all four types lazy, 0 B in every snapshot.** Baseline: heavy DM ≈ 707 KB of 1.5 MiB, players ≈ 290 KB of 512 KiB (`SNAPSHOT_CEILING`; from the [protocol](../protocol/README.md) docs, not re-run). Record sizes are measured JSON with 36-character IDs in a scratch probe; N0's `con44.test.ts` re-measures on the heavy harness.

| At 500 notes, 100 revealed, 2 KB average public text | If in the snapshot | As lazy |
|---|---|---|
| DM headers (378 B typical) | +189 KB | 189 KB when Notes opens |
| DM headers at the cap (2,000 × 907 B max) | +1.8 MB: **over 1.5 MiB alone** | 1.8 MB ack, under the 4 MiB limit |
| DM bodies | +1 MB: 1.9 MB total, **over** | Per note |
| Player headers (198 B, 100 notes) | +20 KB | 20 KB on open |
| Player bodies | +200 KB: ≈ 510 KB total, **at the ceiling** | Per note |

- `note-revealed` rows sit in the existing 100-row notification window, smaller than the damage cards that fill it.
- **Worst load:** a `note-body` chunk of 50 × 60 KB = 3 MB (< 4 MiB). Normal use loads one.
- **Reveal frame, a gainer:** the note's header, body (≤ 60 KB) and links, plus a `note-links` row per source they can see: 572 B at 5 links, 9.4 KB at the cap. 200 such sources ≈ 115 KB. Sources' bodies aren't resent. Everyone else: no frame.
- **Search** (scratch probe, real `searchTier`, 2 words, one text set; a player's set holds only their visible notes):

| Notes × chars | Fill the cache | One note's refill | One search |
|---|---|---|---|
| 500 × 2,000 | 63 ms | 0.12 ms | 0.5 ms |
| 2,000 × 2,000 | 235 ms | 0.14 ms | 1.6 ms |
| 2,000 × 20,000 | 1.7 s | 0.8 ms | 4.7 ms |

- **FTS5:** refused at boot in the main DB; probe results in [the proposed ADR](../architecture/adr/proposed-no-virtual-tables-under-push.md).
- **Upgrade on the real campaign** (scratch probe on stand-in tables of this shape, not the repo's `schema.ts`): populated DB gains `CREATE` statements only, rows kept, new tables empty, next boot 0 statements. Follows #416 and AGENTS §3. `upgrade:check` (merged, #424) proves it on the real schema in CI for N0.

## 13. Test plan

Fixtures, bundle `linked-notes`, leak tests per field and player, browser walkthrough, isolation per worktree: [linked-notes-build §Test plan](linked-notes-build.md#test-plan).

## 14. Dependencies

| On | What we need | Status |
|---|---|---|
| Upgrade guards | BL-172, BL-173 | Merged (#424) |
| [live-sync](live-sync.md) | `lazy`, `sync.load`, `quietWhenUnchanged`; `derived` with `lazy` proved in N1 | Built |
| [notifications](notifications.md) | Kind + views registries; scrub helper or direct update (FR-NOTES-16) | Append only; helper via orchestrator |
| [compendium](compendium.md) | `MarkdownLite` seam (FR-NOTES-23); entry hook (FR-NOTES-11); `entryVisibleTo` import | Needs assignment |
| [entities](entities.md) | Hook on entity delete (FR-NOTES-11) | Needs assignment |
| [assets-pipeline](assets-pipeline.md) | `assetUses` kind `note` (extras) | Needs assignment |
| [play-shell](play-shell.md) | Window + size rows, palette entries, key | Append only; key via integrator |
| [agent-api](agent-api.md) | Add the five tools to its §9 (OQ-07) | Needs assignment |
| Glossary, [world-builder](post-mvp/world-builder.md) | OQ-13, OQ-20; world-builder's "SQLite FTS" pick is overtaken | Integrator |
| [ADR-0011](../architecture/adr/0011-cross-references.md) | Folded from [proposed-cross-reference-decision](../architecture/adr/proposed-cross-reference-decision.md) at acceptance | Gate |

## 15. Open questions

**Requirements that rest on a pick** (none decided):

| OQ | FR-NOTES-… resting on it |
|---|---|
| 01 Model | 01, 11, 13, 36 |
| 02 Link target | 05, 22, 33, 34 |
| 03 Target deleted | 06, 35, 42 |
| 04 Hidden mention | 05, 10, 14, 23, 37; §7.2 |
| 05 Other targets | 10, 11, 22, 34, 35 |
| 06 Format | 05, 21, 23, 33 |
| 07 MCP | 20 |
| 08 Parts | 01, 02, 03, 04, 08, 13, 14, 33, 39; §8.2 |
| 09 Who searches | 14, 41 |
| 10 Players write | 03, 41; §8.4 |
| 11 Granularity | 07, 08, 16, 37 |
| 12 Search engine | 14 |
| 13 Verb | Names in 07, 16, 31, 32, 37, §9, test IDs. Before N0 |
| 18 Extras | 16, 17, 19, 38, 41, 47 |
| 19 Cascade | 07, 37 |

**Bold** = suggested pick, not decided. OQ-01–05: longer text in the [proposed ADR](../architecture/adr/proposed-cross-reference-decision.md).

| ID | Question | Options (pick marked) | Blocking? | Affects |
|---|---|---|---|---|
| OQ-NOTES-01 | ADR-0011: cross-reference model | Inline links only, backlinks by scanning bodies (no table; typed relations need one later) · **Inline links indexed as untyped mentions in `note_link`, typed relations later; only the mention half built now** (one query surface; index kept in step in the save) | yes | ADR-0011, world-builder, importer |
| OQ-NOTES-02 | Link target | **Stable ID; display = title at render, or an alias** (rename-safe; the editor maps titles) · By title, Obsidian-style (readable; a rename breaks links or rewrites notes) | yes | ADR-0011 |
| OQ-NOTES-03 | Target deleted | **Dangling: DM sees the struck last title + Remove; players see what hidden shows** (nothing else edited; dead links to tidy) · Rewrite sources to plain text (no dead links; edits notes you didn't touch) · Block delete while linked (no dead links; slows prep) | yes | ADR-0011 |
| OQ-NOTES-04 | **What a player sees when a note mentions something hidden** ([§7.2](#72-what-a-player-sees-when-a-note-mentions-something-hidden)) | **B. Alias as plain words, else `(unknown)`** (reads well; a careless alias says what it says, so the dialog lists them) · A. Always `(unknown)` (tightest; prose stutters) · C. Drop it (no trace; broken sentences) | yes | ADR-0011, all link kinds |
| OQ-NOTES-05 | Links beyond notes | **Compendium, characters and creatures by ID, shown only if the reader may read them** (needs entry and entity-delete hooks) · Notes + compendium only (fewer rules; no "see Elite Goblin") · Notes only (smallest; no "see Fireball") | yes | ADR-0011, compendium, entities |
| OQ-NOTES-06 | Rich-text format | **Markdown-lite + wikilinks in a plain text box, on `MarkdownLite`** (no dependency, Obsidian- and agent-friendly; no live formatting) · Same text in CodeMirror (live preview; a dependency needing your OK; can follow later, storage unchanged) · Structured editor JSON (true WYSIWYG; big dependency; poor Obsidian and MCP fit) | yes | N2, N3, importer |
| OQ-NOTES-07 | Notes in the MCP tools now | Read + create + update of any note (fullest; an update to a revealed note reaches players at once) · **Read + create + update refused on revealed notes; no reveal tool** (the agent can't change what a player reads; revealed notes are edited by hand) · Read only (safest; no drafting) · None yet (smallest) | yes | agent-api, N9 |
| OQ-NOTES-08 | Player-visible parts | Whole-note only (simplest; secrets need a second note) · **Body + one DM part, stored apart** (the common case; a parser bug can't leak it) · Inline `:::dm` sections (flexible, closest to journal sections; one parser bug from a leak) | yes | §8, journal sections |
| OQ-NOTES-09 | Who may search what | **DM everything; players the title and on-screen text of notes visible to them** (useful; proven by byte-equal probes) · Players titles only (less to test; less useful) · DM only (no player search surface) | yes | FR-NOTES-14 |
| OQ-NOTES-10 | Players write notes in this slice | **No** (one author; NPC directory adds it, in its own table) · Private player notes now (wanted eventually; a second visibility path before the first is proven) | yes | §8.4 |
| OQ-NOTES-11 | Reveal granularity | **Per player: nobody / everyone / chosen** (same as handouts; same filter and tests) · All or nothing (slightly simpler; loses "tell only the rogue") | yes | FR-NOTES-07 |
| OQ-NOTES-12 | Search engine | **Shared matcher in memory, per-note word cache** (same results as every other search; a first-search fill, 235 ms at 2,000 notes for the DM) · Plain `note_word` table (no cold start; survives push; roughly 600,000 rows at the cap, an estimate; save rewrites them; matcher semantics to redo in SQL) · FTS5 in an attached sidecar file (real FTS; a second DB for backups, reset and digest; different matching) | yes | [proposed ADR](../architecture/adr/proposed-no-virtual-tables-under-push.md) |
| OQ-NOTES-13 | The verb, before N0: it names intents, events, the kind, test IDs. The glossary says "reveal" stays fog's word and handouts **Share** | **Reveal / Hide** (notes start secret, as the world-builder stub says "reveal"; the glossary line must change; two verbs for near-identical dialogs) · Share / Unshare (no glossary change; one verb with handouts; reads oddly for a secret) | yes | Glossary, all names |
| OQ-NOTES-18 | Extras beyond sprint scope: toast, New / Updated, Preview, images, tags, Compare, pop-out | **Keep toast, New / Updated, Preview, images (a late slice); cut tags, Compare, pop-out** (players notice reveals, and the DM can check one; tags have no view yet) · Keep all seven (fullest; about two more slices) · Cut all seven (strict scope; players are told aloud; images stay on handouts) | yes | §6, build split |
| OQ-NOTES-19 | Does revealing a note reveal what it links to? | **Never; the dialog lists each hidden link with "Reveal that too"** (no accident; a click per link) · A single off-by-default "Also reveal what it links to", one level (faster for a batch; one click shows several secrets) · Never, and the dialog only lists them (smallest; reveal the others from their own notes) | yes | FR-NOTES-07, -37 |
| OQ-NOTES-14 | Prefix `NOTES` sits next to notifications' `NOTE` (`FR-NOTE-`, `note.dismiss`, `note-history-*`) | **Keep `NOTES`, feature folder `linked-notes`** · `LNOTE` everywhere | no · integrator | IDs, grep |
| OQ-NOTES-15 | Shortcut | **`J`** ("journal"; L I D C B R P S N are taken) · no key | no · integrator | play-shell §7 |
| OQ-NOTES-16 | Caps | **2,000 notes, 60,000 B per note, 100 links** · Other numbers (60,000 B can't pass 64 KiB without a split save) | no · DM | §6, §12 |
| OQ-NOTES-17 | Saving | **Explicit Save + browser draft** (a Save is a deliberate change players may see) · Autosave to the server (no button; players would watch half-typed text) | no · spec-linked-notes | FR-NOTES-39 |
| OQ-NOTES-20 | Glossary: add **Note**, **Wikilink**, **Backlink**, **Mention**, **Alias**, **DM part** | **Add** | no · integrator | Glossary |

## 16. Out of scope

- Later, room left per [§8.4](#84-room-left-not-built): quest log, calendar, session timeline ([campaign-manager](post-mvp/campaign-manager.md)), NPC directory, journal sections, map pins ([scene-tools](scene-tools.md)), [Obsidian import](post-mvp/obsidian-importer.md).
- World-builder's other entity kinds, location ↔ scene ([world-builder](post-mvp/world-builder.md)). Handouts stay in [party-board](party-board.md).
