# Proposed — Note co-writing: one central authority per open note

- Status: proposed, with [linked-notes](../../specs/linked-notes.md) (FR-NOTES-13 to -19)
- Date: 2026-11-05
- Fits: [ADR-0005](0005-server-authoritative-sync.md) (server-authoritative), [ADR-0016](0016-domain-events-pending-actions.md) (commands, non-logged events), [ADR-0026](0026-signal-routing.md) / [0033](0033-signal-audience.md) (signals, audience), [ADR-0045](0045-lazy-record-types.md) (lazy types), [ADR-0071](0071-spell-fx.md) (`hub.sendServerSignal`)
- Dependency: approved by the DM for this feature (sprint 15 gate)

## Context

- Shared notes are co-written live by up to ~8 people (DM + players), with cursors.
- The hub has: commands (validated, one transaction, events after commit), per-connection `seq` that only moves when a frame touches the connection, client signals with an `audience` hook, and per-connection server signals (`sendServerSignal`, payload per viewer, never queued).
- Limits: client frames ≤ 64 KiB (`MAX_CLIENT_FRAME_BYTES`, closes on excess); server frames ≤ 4 MiB send buffer.
- `@codemirror/collab` is a central-authority protocol: a client sends its unconfirmed changes with the version they are based on; the authority accepts only at its current version; a client behind receives the missing changes, rebases its own (`receiveUpdates`) and resends. The authority needs only `@codemirror/state` (`ChangeSet`, `Text`), which has no DOM and runs in Bun.

## Options

| Option | Pros | Cons |
|---|---|---|
| **A. `@codemirror/collab` with the server as the authority** | Matches ADR-0005: the server owns the text and the order; small server code (apply at version, keep recent changes); offline typing rebases | Server keeps a change list per open note; a client far behind reloads |
| B. Yjs (CRDT) | Peer merge, offline-first | New dependency the DM didn't approve; CRDT state grows with history; the server becomes a relay, not the authority |
| C. Whole-body saves with last-write-wins | No new protocol | Typing at once overwrites; not "Google Docs" |

## Decision

> Suggested: **A** (technical; the product effects are the spec's OQ-NOTES-08 and -09).

### Packages (exact)

- Direct: `@codemirror/state`, `@codemirror/view`, `@codemirror/collab`, `@codemirror/commands` (history, `defaultKeymap`, `historyKeymap`).
- Pulled in: `@codemirror/language` (by commands), `@codemirror/streamparser`, `@lezer/common`, `@lezer/lr`, `@lezer/highlight`, `crelt`, `style-mod`, `w3c-keyname`, `@marijn/find-cluster-break`. All MIT (npm registry, 2026-11-05).
- Not needed: `@codemirror/autocomplete`. The `[[` list is a `showTooltip` from `@codemirror/view`. No Yjs.
- The server imports only `@codemirror/state`. `src/shared` stays zod-only (AGENTS §9.1): the shared schemas carry changes as JSON (`ChangeSet.toJSON`), and server and client parse them.

### Server: one session per open note

- `src/server/features/linked-notes/collab.ts` keeps an in-memory session per note with at least one subscriber: `text`, `version`, `epoch` (a new ID each time the session loads from the DB), and the changes since the oldest subscriber's version, up to 1,000. A subscriber further behind reloads.
- Intents are commands (roles DM and player; `authorize` = can read, else `not_found`):
  - `notes.open {noteId, version?, epoch?}`: subscribes. Same epoch and the changes still held → `{updates}`; otherwise `{doc, version, epoch, backlinks}`.
  - `notes.push {noteId, version, updates[{clientID, changes}]}`: at the current version, apply (refused over 32 KiB, `invalid`), bump the version, result `{accepted: true}`; otherwise `{accepted: false}`, not an error.
  - `notes.close {noteId}`: unsubscribes.
- An accepted push emits `NoteEdited` (non-logged, no record changes, so the broadcaster sends nothing). A listener sends `notes.updates {noteId, from: version, updates}` with `hub.sendServerSignal`; the payload is non-null only for subscriber connections that can read the note, the sender's included. A client sees its own `clientID` as the confirmation.
- A missed `notes.updates` (never queued, e.g. mid-snapshot) shows as a version gap; the client calls `notes.open` with its version.
- Subscriptions are keyed by connection ID. A closed connection simply stops getting payloads and is pruned on the next push. No hub change.

### What is a command, what is logged, when the body is saved

- **Nothing about notes enters the event log**; every note event is non-logged (FR-SYNC-16 allows that per spec). Why: the log is a DM-side file. Private notes must never land there, and nothing reads note history. Create, rename, share and delete are commands whose event `NoteChanged` carries the `note` record change, so the broadcaster and the owner gate route it.
- **Save:** a system command `notes.saveBody` writes `body`, `version`, `updatedAt` / `updatedBy` and rebuilds `note_link` in one transaction. It runs 2 s after the last accepted push, at most 10 s after the first unsaved push, when the last subscriber leaves, and at clean shutdown. Its `NoteChanged` is `quietWhenUnchanged`. Timers use the hub's injectable timers (FR-SYNC-26).
- **Backlinks:** after a save that changes `note_link`, a listener computes each affected open note's backlinks per subscriber (readable sources only). It sends `notes.backlinks` only to a subscriber whose list changed. So a save of someone else's private note sends nothing (closes a timing leak).

### Presence (cursors)

- Client signal `notes.cursor {noteId, version, ranges[≤ 10]}`, client-throttled to ≤ 10 per second. The `audience` hook returns `{players: <players subscribed to the note>}`, so DM connections get it too, per FR-SYNC-28. For a private, missing or other-campaign note it throws `not_found`, and nobody receives it.
- The sender comes from the server-stamped `from`; the colour is looked up (ADR-0055). Receivers map ranges through changes when they are ahead and drop ranges more than 50 versions old. A cursor vanishes 10 s after its last signal, or at once on `{left: true}`. Never stored.

### Limits

- Body ≤ 32 KiB UTF-8 (server check after apply). The client measures each push frame and refuses a paste that would exceed 64 KiB, before sending.
- Pushes batch naturally: one in flight per editor, plus 100 ms batching.

### Reconnect, crash, two tabs, closing under someone

- **Reconnect:** the snapshot purges `note` rows (FR-SYNC-37). Open notes call `notes.open {version, epoch}`. With the same epoch, the client gets the missing changes and pushes its local ones, rebased. A different epoch means a reload.
- **Crash:** the restarted session has a new epoch at the last saved version, so at most 10 s of accepted typing is lost (2 s typical). A client whose text is ahead reloads and keeps a copy for **Copy my text**. The epoch stops a client from resuming onto a different history with the same version numbers.
- **Two tabs of one person:** two connections, two `clientID`s, both subscribed. Nothing special.
- **Delete / make private / campaign switch:** the command drops the session (delete) or every subscriber who can no longer read it (make private). A listener sends the dropped ones `notes.closed {noteId}`, the same payload for every cause. Their later pushes get `not_found`.
- **Rename rewrite** (OQ-NOTES-04): applied as a server change (`clientID: "server"`) through each affected note's session, or straight to the DB with a version bump when no session is open.

## Consequences

- New feature folder `linked-notes` (server, shared schemas, both clients). Tables `note` and `note_link` are new only (#416). No hub or protocol frame change: commands, client signals and server signals already exist.
- `package.json` / `bun.lock` gain the four packages, in the slice that first needs them (orchestrator lock).
- Test helpers: a leak scan over raw frames (signals and acks), next to `leakScan`'s record checks.
- Revisit if more than ~8 people co-write at once, or bodies need more than 32 KiB (chunked pushes).
