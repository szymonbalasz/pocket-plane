# ADR-0078 — Note co-writing: the server as the one authority, every change stored

- **Status:** accepted (DM, #446), with [linked-notes](../../specs/linked-notes.md) (FR-NOTES-07 to -22).
- **Date:** 2026-11-05 (revised after the DM's gate, [#444](../../decisions-log.md), [#445](../../decisions-log.md) and #446: every note shared, nothing private, a Recycle bin, `@` as a picker).
- **Keeps:**
  - [ADR-0005](0005-server-authoritative-sync.md): the server owns the text and the order.
  - [ADR-0006](0006-persistence.md): session state survives a crash.
  - [ADR-0016](0016-domain-events-pending-actions.md): mutate inside the command's transaction; non-logged events.
  - [ADR-0026](0026-signal-routing.md) and [0033](0033-signal-audience.md): signals.
  - [ADR-0045](0045-lazy-record-types.md): lazy types.
  - [ADR-0071](0071-spell-fx.md): `hub.sendServerSignal`.
- **Dependency:** approved by the DM for this feature.

## Context

Notes are co-written live by up to about 8 people, who see each other's cursors and who is in the note. Every note reaches the campaign's whole table and nothing else.

What the hub already offers:

- **Commands:** validated, one transaction each; events go out after the commit; caches refresh after the commit (CON-23).
- **`seq`:** per connection, and it moves only when a frame reaches that connection.
- **Client signals:** each can have an `audience` hook.
- **Per-viewer server signals:** these skip connections that aren't `live` and are never queued.

Limits: a client frame can be at most 64 KiB, and anything bigger closes the socket (`hub.ts`); the server buffers up to 4 MiB of outgoing frames.

How `@codemirror/collab` works: a central authority accepts changes only at its current version. A client sends its unconfirmed changes with the version they're based on; a client that is behind receives the missing changes, rebases its own (`receiveUpdates`) and resends. The authority needs only `@codemirror/state` (`ChangeSet`, `Text`), which has no DOM and runs in Bun.

## Options

**Protocol**

| Option | Pros | Cons |
|---|---|---|
| **A. `@codemirror/collab`, with the server as the authority** | Matches ADR-0005. Small server code. Offline typing rebases. Its history undoes only local changes | A client far behind has to reload |
| B. Yjs (CRDT) | Peers merge directly; offline-first | Not approved by the DM. The server becomes a relay instead of the authority, and the state grows with history |
| C. Whole-body saves, last write wins | No new protocol | Typing at the same time overwrites; it isn't "Google Docs" |

**Persistence**

| Option | Pros | Cons |
|---|---|---|
| **P1. Store each accepted push as a `note_change` row in the push command's own transaction; fold rows into `body` now and then** | Nothing accepted is lost; restarts resume; ADR-0006 and ADR-0016 hold; no timers, stop hook or hub change | ~30 small commits a second at 3 typists (below) |
| P2. Keep the text in memory; save on a 2 s / 10 s timer and at shutdown | Fewer commits | Loses up to 10 s in a crash. Two ADR exceptions (0006: state lost in a crash; 0016: memory changed inside a transaction that can roll back). Needs a feature timer, an `onStop` hook and a connection-closed sweep, plus an epoch that drops offline typing after every restart |

## Decision

> **Suggested: A with P1.** Both are technical; their product effects are in the spec.

### Packages (exact)

- **Direct:** `@codemirror/state`, `@codemirror/view`, `@codemirror/collab`, `@codemirror/commands` (history, `defaultKeymap`, `historyKeymap`).
- **Pulled in:** `@codemirror/language`, `@codemirror/streamparser`, `@lezer/common`, `@lezer/lr`, `@lezer/highlight`, `crelt`, `style-mod`, `w3c-keyname`, `@marijn/find-cluster-break`. All MIT (checked on npm, 2026-11-05).
- **Not needed:** no `@codemirror/autocomplete` (the `@` / `[[` title picker is a `showTooltip`), no `lang-markdown` (chips, die buttons and styling are view decorations; chips are `atomicRanges`), no Yjs.
- **Where:** the server imports only `@codemirror/state`. `src/shared` stays zod-only: changes travel as JSON (`ChangeSet.toJSON`). The link parser (`parseLinks(text)`, `[[…]]` only) is plain TypeScript in `src/shared/linked-notes/`, used by both sides.

### Server

- **Source of truth is the DB:** `note.body` up to `bodyVersion`, then the `note_change` rows up to `version`.
- **In-memory session per open note:** the current `Text`, and per subscriber its bound `clientId` and the last backlinks list it was sent. A cache: refreshed after commit, rebuilt from the DB when missing.
- **Intents** (`not_found` for an unknown or binned note):
  - `notes.open {noteId, clientId, version?}`: subscribes and binds `clientId` (≤ 8 open notes per connection). Result `{updates}` if the client sent a `version` whose rows are still kept, else `{doc, version, backlinks}`; either way plus `here`, who has the note open.
  - `notes.push {noteId, version, updates[{clientId, changes}]}`:
    - `invalid` if `clientId` isn't the one bound to this connection.
    - At the current version: apply to a copy of the text; over 32 KiB → `invalid` `note_full`. Insert the `note_change` row, bump `note.version`; if the parsed links changed, rewrite `note_link`; if ≥ 60 s since the last bump, bump `updatedAt` / `updatedBy` (a `note` upsert).
    - Every 100 unfolded changes, fold: write `body`, `bodyFold`, `bodyVersion`, and prune `note_change` to the last 1,000 rows or 1 MiB.
    - Result `{accepted: true}`; at a stale version `{accepted: false, updates}`, or `{reload: true}` if those rows are gone.
  - `notes.close {noteId}`.
- **Delivery:** an accepted push emits `NoteEdited` (non-logged, no record changes). A listener sends `notes.updates {noteId, from, updates}` via `sendServerSignal` to the note's subscribers, the sender included; the sender treats its own `clientId` as the confirmation.
- **A missed `notes.updates`** (signals aren't queued; resync and scene activation send snapshots): after every snapshot the client re-opens each open note with its version, and a stale push gets the missing changes back.
- **Pruning, no timers or hooks:** every notes command first drops subscriptions whose connection isn't in `hub.connections()` and drops sessions with no subscriber.

### Links

- `parseLinks` returns the `[[…]]` targets; `@` is only an editor gesture that inserts `[[Title]]`, so stored text has one link form. `note_link` keeps one row per distinct folded target.
- **Rename rewrite:** the rename command, in its own transaction, rewrites each linking note as a server change (`clientId: "server"`, one `note_change` row each), found through `note_link`, binned notes included. Concurrent pushes go stale and rebase as usual.
- **Backlinks:** on every `NoteChanged` (create, rename, delete, restore) and every push that changed links, a listener collects the affected titles (old and new targets and titles), computes each affected open note's backlinks, and sends `notes.backlinks` only where a subscriber's list differs from the last one sent.

### Presence: who is here, cursors, undo

- **Who is here:** open, close and pruning send `notes.here {noteId, who[]}` (server signal) to the note's subscribers. Clients also drop a chip when live-sync presence shows that person offline, since pruning waits for the next notes command.
- **Cursors:** `notes.cursor {noteId, version, ranges[≤ 10]}`, a client signal, throttled to 10 a second.
- Its `audience` hook returns `{players: <players subscribed to the note>}`, so DM connections get it too (FR-SYNC-28); a missing or other campaign's note throws `not_found`. Colour from the server-stamped `from` (ADR-0055).
- Receivers map ranges forward through the changes since `version` and drop any more than 50 versions old. A cursor goes 10 s after its last signal, or on `{left: true}`. Never stored.
- **Undo:** `@codemirror/commands` history in each tab. `receiveUpdates` adds others' changes outside the history, so undo reverts only this tab's own changes, mapped over everyone else's.

### Frames, delete, switch

- **Push size:** a prefix of the unconfirmed changes, ≤ 48 KiB per frame, one push in flight, 100 ms batching. The editor stops typing at 32 KiB with a change filter; a size refusal reloads that client, keeping its text for Copy my text.
- **Recycle bin:** delete sets `deletedAt` (refused past 1,000 binned), drops the session, and a listener sends `notes.closed {noteId}` to its subscribers. A binned note's body, links and search entry stay in the DB but are skipped by `open`, backlinks and search. **Restore** clears `deletedAt`, renaming to "Title (restored)", "(restored 2)"… on a clash. No expiry, no timer.
- **Campaign switch:** closes every connection with 4409 first (FR-SYNC-07); the client shows the banner from that close, and the listener drops the old campaign's sessions.
- **Campaign isolation:** every intent and the cursor `audience` check the note's `campaignId` against the connection's; subscribers are always connections of that campaign; REST search reads only the token's campaign. A future player removal ([OQ-CAMP-08](../../specs/campaign-management.md#15-open-questions)) only has to close that player's connections.
- **Nothing about notes goes into the event log** (FR-SYNC-16 allows non-logged events per spec).

### Limits and load

| What | Cost | Basis |
|---|---|---|
| Push frames | ≤ 10 a second per typist, ~200 B each | Pushes batch |
| Typing traffic | ≈ 24 KB/s up the DM's tunnel | 3 typists, 4 subscribers |
| Cursor traffic | ≈ 18 KB/s | Review 2's estimate |
| Disk writes | ≈ 30 commits a second at 3 typists, each a ~200 B insert plus a version update | — |
| `fsync` time | ≈ 1–3 ms per commit on an SSD, 3–9% of the server thread | Estimate; the co-writing slice measures it |
| WAL growth | Auto-checkpointing covers it; folding prunes `note_change` | — |
| Search | Matches stored `bodyFold` (open notes use their live text), ≤ 1,000 × 32 KiB; no per-query fold | The search slice benches it; target ≤ 50 ms |

## Consequences

- **New feature folder** `linked-notes`, new tables only (#416).
- **No hub, services or protocol-frame change:** commands, client signals and server signals already exist. No owner gate: nothing in notes is private.
- **Dependencies:** `package.json` / `bun.lock` gain the four packages in the co-writing slice.
- **Test helpers:** a leak scan over raw frames (signals and acks) beside `leakScan`'s record checks, with a second campaign's clients as the outsiders.
- **Revisit** if more than ~8 people co-write at once, if the measured `fsync` cost is high (then batch pushes at 200 ms), or if bodies need more than 32 KiB.
