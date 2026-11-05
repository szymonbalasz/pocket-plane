# Proposed — Note co-writing: the server as the one authority, every change stored

- **Status:** proposed, with [linked-notes](../../specs/linked-notes.md) (FR-NOTES-10, -13 to -19, -23).
- **Date:** 2026-11-05 (revised after review 2).
- **Keeps:**
  - [ADR-0005](0005-server-authoritative-sync.md): the server owns the text and the order.
  - [ADR-0006](0006-persistence.md): session state survives a crash.
  - [ADR-0016](0016-domain-events-pending-actions.md): mutate inside the command's transaction; non-logged events.
  - [ADR-0026](0026-signal-routing.md) and [0033](0033-signal-audience.md): signals.
  - [ADR-0045](0045-lazy-record-types.md): lazy types.
  - [ADR-0071](0071-spell-fx.md): `hub.sendServerSignal`.
- **Dependency:** approved by the DM for this feature.

## Context

Shared notes are co-written live by up to about 8 people, who see each other's cursors.

What the hub already offers:

- **Commands:** validated, one transaction each; events go out after the commit; caches refresh after the commit (CON-23).
- **`seq`:** per connection, and it moves only when a frame reaches that connection.
- **Client signals:** each can have an `audience` hook.
- **Per-viewer server signals:** these skip connections that aren't `live` and are never queued.

Limits:

- A client frame can be at most 64 KiB; anything bigger closes the socket (`hub.ts`).
- The server can buffer up to 4 MiB of outgoing frames.

How `@codemirror/collab` works:

- It needs a central authority.
- A client sends its unconfirmed changes together with the version they're based on.
- The authority accepts only at its current version.
- A client that is behind receives the missing changes, rebases its own (`receiveUpdates`) and resends.
- The authority needs only `@codemirror/state` (`ChangeSet`, `Text`), which has no DOM and runs in Bun.

## Options

**Protocol**

| Option | Pros | Cons |
|---|---|---|
| **A. `@codemirror/collab`, with the server as the authority** | Matches ADR-0005. Small server code. Offline typing rebases | A client far behind has to reload |
| B. Yjs (CRDT) | Peers merge directly; offline-first | Not approved by the DM. The server becomes a relay instead of the authority, and the state grows with history |
| C. Whole-body saves, last write wins | No new protocol | Typing at the same time overwrites; it isn't "Google Docs" |

**Persistence**

| Option | Pros | Cons |
|---|---|---|
| **P1. Store each accepted push as a `note_change` row in the push command's own transaction; fold rows into `body` now and then** | Nothing accepted is lost; restarts resume; no epoch; ADR-0006 and ADR-0016 hold; no timers, stop hook or hub change | ~30 small commits a second at 3 typists (below) |
| P2. Keep the text in memory; save on a 2 s / 10 s timer and at shutdown | Fewer commits | Loses up to 10 s in a crash. Two ADR exceptions: session state that doesn't survive a crash (0006), and memory changed inside a transaction that can roll back (0016). Needs new core seams: a feature timer, an `onStop` before `hub.shutdown`, a connection-closed sweep. Also needs an epoch, which drops offline typing after every restart |

## Decision

> **Suggested: A with P1.** Both are technical decisions; their product effects are the spec's OQ-NOTES-08.

### Packages (exact)

- **Direct:** `@codemirror/state`, `@codemirror/view`, `@codemirror/collab`, `@codemirror/commands` (history, `defaultKeymap`, `historyKeymap`).
- **Pulled in:** `@codemirror/language`, `@codemirror/streamparser`, `@lezer/common`, `@lezer/lr`, `@lezer/highlight`, `crelt`, `style-mod`, `w3c-keyname`, `@marijn/find-cluster-break`. All are MIT (checked on npm, 2026-11-05).
- **Not needed:** no `@codemirror/autocomplete` (the `[[` list is a `showTooltip`) and no Yjs.
- **Where they're used:** the server imports only `@codemirror/state`. `src/shared` stays zod-only: changes travel as JSON (`ChangeSet.toJSON`).

### Server

- **The source of truth is the DB:** `note.body` up to `bodyVersion`, then the `note_change` rows up to `version`.
- **In-memory session per open note:** the current `Text` and, per subscriber, its bound `clientId` and the last backlinks list it was sent. The session is a cache: it is refreshed after commit (CON-23 style) and rebuilt from the DB whenever it's missing.
- **Intents** (all commands for the DM and players; `authorize` = can read the note, otherwise `not_found`):
  - `notes.open {noteId, clientId, version?}`
    - Subscribes the connection and binds `clientId`. At most 8 open notes per connection.
    - If the client sent a `version` and the rows since it are still kept, the result is `{updates}`.
    - Otherwise it is `{doc, version, backlinks}`.
  - `notes.push {noteId, version, updates[{clientId, changes}]}`
    - Refused (`invalid`) if `clientId` isn't the one bound to this connection.
    - At the current version, the server applies the changes to a copy of the text. Over 32 KiB → `invalid` `note_full`.
    - Then it inserts the `note_change` row and bumps `note.version`.
    - If the link targets changed, it rewrites `note_link`.
    - If ≥ 60 s have passed since the last bump, it bumps `updatedAt` / `updatedBy`, which upserts the `note` record.
    - Every 100 unfolded changes it folds: it writes `body`, `bodyFold` and `bodyVersion`, and prunes `note_change` down to the last 1,000 rows or 1 MiB.
    - Result `{accepted: true}`. At a stale version the result is `{accepted: false, updates}` (the changes since the client's version), or `{reload: true}` if those are no longer kept.
  - `notes.close {noteId}` unsubscribes the connection.
- **Delivery:** an accepted push emits `NoteEdited`, which is non-logged and has no record changes. A listener sends `notes.updates {noteId, from, updates}` through `sendServerSignal`. The payload is non-null only for subscribers that can read the note, the sender included. The sender treats its own `clientId` as the confirmation.
- **A missed `notes.updates`** (signals aren't queued; a resync or a scene activation sends a snapshot): after every snapshot, the client re-opens each open note with its version. A stale push also gets the missing changes back. So no client stays stale.
- **Pruning, with no timers or hooks:** every notes command first drops subscriptions whose connection isn't in `hub.connections()`, and drops sessions with no subscriber left. Nothing needs saving: every change is already stored.

### Logged, saved

- **Nothing about notes goes into the event log.** Every note event is non-logged (FR-SYNC-16 allows this per spec).
- Create, rename, share, copy-private and delete emit `NoteChanged`, which carries the `note` record change for the broadcaster and the owner gate.
- A push stores its change in its own transaction (`synchronous = FULL`), so a crash loses nothing that was accepted.
- On restart, sessions rebuild from `body` + `note_change`. Clients resume from their version, and offline typing is rebased as usual.

### Backlinks

A listener runs on every `NoteChanged` and on every push that changed links:

- It collects the affected titles: the old and new link targets, and the old and new title.
- For each open note with one of those titles, it computes each subscriber's readable backlinks.
- It sends `notes.backlinks` only to subscribers whose list differs from the one last sent.

A save of someone else's private note therefore changes no one else's list and sends no frame. If the gate picks OQ-06 A (make private = vanish for others), make-private and delete share one code path, so the frames others get are byte-identical apart from `seq`. The FR-12 test then keeps a link target open.

### Presence (cursors)

- **The signal:** `notes.cursor {noteId, version, ranges[≤ 10]}` is a client signal, throttled on the client to 10 a second at most.
- **Routing:** its `audience` hook returns `{players: <players subscribed to the note>}`, so DM connections get it too (FR-SYNC-28). For a private note, a missing note or another campaign's note, the hook throws `not_found` and nobody gets the signal.
- **Colour:** looked up from the server-stamped `from` (ADR-0055).
- **Receivers:** they map the ranges forward through the changes since `version` and drop any more than 50 versions old.
- **Clean-up:** a cursor goes 10 s after its last signal, or straight away on `{left: true}`. Cursors are never stored.

### Frames, closing, renames

- **Push size:** the client sends a prefix of its unconfirmed changes, at most 48 KiB per frame, one push in flight, with 100 ms batching.
- **Typing limit:** the editor stops typing at 32 KiB with a change filter. If the server refuses a push for size (two people's typing together went over), that client reloads and keeps its own text for Copy my text.
- **Delete:** the command drops the note's session, and a listener sends `notes.closed {noteId}` to its subscribers. Later pushes get `not_found`.
- **Campaign switch:** the switch closes every connection with 4409 before anything else (FR-SYNC-07). The client shows the banner from that close, and the listener drops the old campaign's sessions.
- **Rename rewrite (OQ-04):** stored as a change with `clientId: "server"`, the same as a push.

### Limits and load

| What | Cost | Basis |
|---|---|---|
| Push frames | ≤ 10 a second per typist, ~200 B each | Pushes batch |
| Typing traffic | ≈ 24 KB/s up the DM's tunnel | 3 typists, 4 subscribers |
| Cursor traffic | ≈ 18 KB/s | Review 2's estimate |
| Disk writes | ≈ 30 commits a second at 3 typists, each a ~200 B insert plus a version update | — |
| `fsync` time | ≈ 1–3 ms per commit on an SSD, so 3–9% of the server thread | An estimate, not measured; the first co-writing slice measures it |
| WAL growth | Normal auto-checkpointing covers it, and folding prunes `note_change` | — |
| Search | Matches stored `bodyFold` (open notes use their live text). No per-query fold: folding 1,300 × 32 KiB took 399 ms in review 2 | The search slice benches the cost at the limits; target ≤ 50 ms |

## Consequences

- **New feature folder** `linked-notes`, with new tables only (#416).
- **No hub, services or protocol-frame change:** commands, client signals and server signals already exist, and P1 needs no timers or stop hook.
- **Dependencies:** `package.json` / `bun.lock` gain the four packages in the first co-writing slice.
- **Test helpers:** a leak scan over raw frames (signals and acks), alongside `leakScan`'s record checks.
- **Revisit** if more than ~8 people co-write at once, if the measured `fsync` cost is high (then batch pushes at 200 ms), or if bodies need more than 32 KiB.
