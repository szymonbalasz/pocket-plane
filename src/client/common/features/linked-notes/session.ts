// The co-writing client of one open note (ADR-0078 client side, slice N3). No DOM: it drives an
// `EditorState` through a host (the CodeMirror view, or a plain state in tests) and the sync
// connection. Open (whole text, or the updates since our version on a re-open), push the
// unconfirmed updates (one push in flight, 100 ms batching, ≤ 48 KiB a frame), apply
// `notes.updates`, rebase on a stale answer, re-open after every snapshot, Saved / Saving… /
// Offline, the reload and gone banners with Copy my text, remote cursors (FR-NOTES-14 – -21).
import {
  collab,
  getSyncedVersion,
  receiveUpdates,
  sendableUpdates,
  type Update,
} from "@codemirror/collab";
import { history } from "@codemirror/commands";
import {
  type ChangeDesc,
  ChangeSet,
  EditorState,
  type Extension,
  Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import {
  NOTE_NOT_OPEN,
  NOTES_CURSOR_RANGES_MAX,
  NOTES_CURSOR_SIGNAL,
  type NoteCursorSignal,
  type NoteHere,
  type NoteUpdate,
  type OpenNoteResult,
  type PushNoteResult,
  pushPrefix,
} from "@shared/linked-notes/collab";
import { NOTE_BODY_MAX_BYTES, NOTE_BODY_TOO_BIG } from "@shared/linked-notes/schemas";

/** Push batching after a keystroke (ADR-0078). */
export const PUSH_DELAY_MS = 100;
/** FR-NOTES-15: cursor signals per second at most. */
export const CURSOR_PER_SECOND = 10;
/** FR-NOTES-15 (walkthrough r1): a caret's name tag shows this long after its person moves or types. */
export const TAG_MS = 2_000;
/** Accepted changes kept for bringing forward a cursor that arrives from an older version. */
export const CURSOR_MAX_LAG = 50;
/** r1: "Saving…" only once unconfirmed text has waited this long; until then "Saved". */
export const SAVING_AFTER_MS = 1_000;
/** FR-NOTES-21: "Note is full" stays this long after the cap refused input. */
export const FULL_SHOWN_MS = 3_000;

/** `none`: a deleted / gone banner speaks for the note; `full`: the cap refused input. */
export type NoteStatus = "loading" | "saved" | "saving" | "offline" | "full" | "none";

/**
 * A banner over the editor (FR-NOTES-20, -21): `deleted` (binned while open: Restore), `gone`
 * (not found: another campaign, or binned while away), `full` (the server refused a push over
 * 32 KiB) and `reload` (our version's changes are no longer kept): the last two reload the note.
 * `text` = what this tab had, for Copy my text.
 */
export type NoteBanner =
  | { kind: "deleted"; text: string }
  | { kind: "gone"; text: string }
  | { kind: "full"; text: string }
  | { kind: "reload"; text: string };

/** Someone else's caret and selections (FR-NOTES-15), as received. */
export interface RemoteCursor {
  clientId: string;
  role: "dm" | "player";
  playerId: string | null;
  version: number;
  ranges: { anchor: number; head: number }[];
  /** Local clock ms of the person's last move or typing (shows the name tag, `TAG_MS`). */
  at: number;
}

/** The editor the session drives. */
export interface NoteHost {
  readonly state: EditorState;
  dispatch(tr: Transaction | TransactionSpec): void;
  /** Replace the whole state (a fresh open or a reload). */
  setState(state: EditorState): void;
}

/** The connection, as far as a note needs it. */
export interface NoteTransport {
  live(): boolean;
  /** Resolves with the ack's result; rejects with `{code, message}` (`IntentRejected`). */
  send(name: string, payload: unknown): Promise<unknown>;
  signal(name: string, data: unknown): boolean;
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

export interface NoteSessionOptions {
  noteId: string;
  clientId: string;
  transport: NoteTransport;
  host: NoteHost;
  /** Editor extensions besides collab and history (the view adds keymaps, cursors, the cap). */
  extensions?: Extension;
  /** Anything shown changed (status, banner, here, cursors). */
  onChange(): void;
}

const utf8 = new TextEncoder();
/** FR-NOTES-21: UTF-8 bytes of a doc (cheap path while it can't be near the cap). */
export function docBytes(state: EditorState): number {
  if (state.doc.length * 3 <= NOTE_BODY_MAX_BYTES) return state.doc.length;
  return utf8.encode(state.doc.toString()).length;
}

/**
 * FR-NOTES-21: refuses a local change (typing or a paste) that would take the note past 32 KiB
 * of UTF-8, and tells `onBlocked`, so the status can say "Note is full".
 */
export function typingCap(onBlocked: () => void = () => {}): Extension {
  return EditorState.changeFilter.of((tr) => {
    if (!tr.docChanged || tr.annotation(Transaction.remote) === true) return true;
    if (docBytes(tr.state) <= NOTE_BODY_MAX_BYTES) return true;
    onBlocked();
    return false;
  });
}

/** A range through one change set (positions past its start text are clamped first). */
function mapRange(r: { anchor: number; head: number }, cs: ChangeSet) {
  return {
    anchor: cs.mapPos(Math.min(r.anchor, cs.length), 1),
    head: cs.mapPos(Math.min(r.head, cs.length), 1),
  };
}

const toUpdates = (list: readonly NoteUpdate[]): Update[] =>
  list.map((u) => ({ changes: ChangeSet.fromJSON(u.changes), clientID: u.clientId }));

interface Rejection {
  code?: string;
  message?: string;
}

export class NoteSession {
  readonly noteId: string;
  readonly clientId: string;
  status: NoteStatus = "loading";
  banner: NoteBanner | null = null;
  here: NoteHere[] = [];
  readonly cursors = new Map<string, RemoteCursor>();
  /** Accepted changes by version (for mapping remote cursors), the newest `CURSOR_MAX_LAG`. */
  private past: { version: number; changes: ChangeSet }[] = [];
  private opened = false;
  /** Opened once: later opens send our version (FR-NOTES-18). */
  private everOpened = false;
  private opening = false;
  private inflight = false;
  private pushTimer: unknown = null;
  private lastCursorAt = -Infinity;
  private cursorTimer: unknown = null;
  /** We have sent a caret (so a late joiner gets it again, r2). */
  private cursorShown = false;
  /** Since when unconfirmed text has waited (null = none). */
  private pendingSince: number | null = null;
  private statusTimer: unknown = null;
  /** When the cap last refused input. */
  private blockedAt = Number.NEGATIVE_INFINITY;
  private closed = false;
  private readonly t: NoteTransport;
  private readonly host: NoteHost;
  private readonly extensions: Extension;
  private readonly changed: () => void;

  constructor(o: NoteSessionOptions) {
    this.noteId = o.noteId;
    this.clientId = o.clientId;
    this.t = o.transport;
    this.host = o.host;
    this.extensions = o.extensions ?? [];
    this.changed = o.onChange;
  }

  /** The state a fresh open (or a reload) starts from. */
  freshState(doc: string, version: number): EditorState {
    return EditorState.create({
      doc,
      extensions: [
        collab({ startVersion: version, clientID: this.clientId }),
        history(),
        typingCap(() => this.blocked()),
        this.extensions,
      ],
    });
  }

  get version(): number {
    return getSyncedVersion(this.host.state);
  }
  get unconfirmed(): number {
    return sendableUpdates(this.host.state).length;
  }
  get isOpen(): boolean {
    return this.opened;
  }
  /** Typing allowed: opened once and not deleted or gone (offline typing carries on). */
  get editable(): boolean {
    return this.everOpened && this.banner?.kind !== "deleted" && this.banner?.kind !== "gone";
  }

  /**
   * The status line (r1): "Saving…" only once unconfirmed text has waited `SAVING_AFTER_MS`, else
   * "Saved"; "Note is full" for `FULL_SHOWN_MS` after the cap refused input; nothing while a
   * deleted / gone banner shows. Re-checks itself when the next change of label is due.
   */
  private refresh(): void {
    if (this.closed) return;
    const now = this.t.now();
    const gone = this.banner?.kind === "deleted" || this.banner?.kind === "gone";
    const pending =
      !gone && (this.inflight || this.unconfirmed > 0 || (!this.opened && this.everOpened));
    if (!pending) this.pendingSince = null;
    else if (this.pendingSince === null) this.pendingSince = now;
    const waited = this.pendingSince === null ? 0 : now - this.pendingSince;
    const fullFor = FULL_SHOWN_MS - (now - this.blockedAt);
    this.status = gone
      ? "none"
      : !this.t.live()
        ? "offline"
        : !this.everOpened
          ? "loading"
          : fullFor > 0
            ? "full"
            : pending && waited >= SAVING_AFTER_MS
              ? "saving"
              : "saved";
    if (this.statusTimer !== null) this.t.clearTimeout(this.statusTimer);
    this.statusTimer = null;
    const due = Math.min(
      fullFor > 0 ? fullFor : Number.POSITIVE_INFINITY,
      pending && waited < SAVING_AFTER_MS ? SAVING_AFTER_MS - waited : Number.POSITIVE_INFINITY,
    );
    if (Number.isFinite(due))
      this.statusTimer = this.t.setTimeout(() => {
        this.statusTimer = null;
        this.refresh();
      }, due);
    this.changed();
  }

  /** The cap refused input (FR-NOTES-21): "Note is full", once the refused transaction is done. */
  private blocked(): void {
    this.blockedAt = this.t.now();
    this.t.setTimeout(() => this.refresh(), 0);
  }

  /** `notes.open`: the whole text the first time, else the updates since our version. */
  async open(): Promise<void> {
    if (this.closed || this.opening || !this.t.live()) return this.refresh();
    this.opening = true;
    const first = !this.everOpened;
    const payload = first
      ? { noteId: this.noteId, clientId: this.clientId }
      : { noteId: this.noteId, clientId: this.clientId, version: this.version };
    try {
      const r = (await this.t.send("notes.open", payload)) as OpenNoteResult;
      if (this.closed) return;
      if (r.mode === "doc") {
        const mine = this.host.state.doc.toString();
        if (!first && this.unconfirmed > 0) this.banner = { kind: "reload", text: mine };
        this.past = [];
        this.host.setState(this.freshState(r.doc, r.version));
      } else {
        this.receive(r.version - r.updates.length, r.updates);
      }
      this.here = r.here;
      this.opened = true;
      this.everOpened = true;
      if (this.banner?.kind === "gone" || this.banner?.kind === "deleted") this.banner = null;
    } catch (err) {
      this.rejected(err as Rejection);
    } finally {
      this.opening = false;
    }
    this.refresh();
    this.schedule(0);
  }

  /** A local edit: push soon. */
  edited(): void {
    this.refresh();
    this.schedule(PUSH_DELAY_MS);
  }

  private schedule(ms: number): void {
    if (this.closed || this.pushTimer !== null) return;
    this.pushTimer = this.t.setTimeout(() => {
      this.pushTimer = null;
      void this.push();
    }, ms);
  }

  /** One push in flight: the unconfirmed updates' prefix within 48 KiB. */
  async push(): Promise<void> {
    if (this.closed || this.inflight || !this.opened || !this.t.live()) return this.refresh();
    const sendable = sendableUpdates(this.host.state);
    if (sendable.length === 0) return this.refresh();
    const version = this.version;
    const updates = pushPrefix(
      this.noteId,
      version,
      sendable.map((u) => ({
        clientId: u.clientID,
        changes: u.changes.toJSON() as NoteUpdate["changes"],
      })),
    );
    this.inflight = true;
    this.refresh();
    try {
      const r = (await this.t.send("notes.push", {
        noteId: this.noteId,
        version,
        updates,
      })) as PushNoteResult;
      if (this.closed) return;
      if (!r.accepted) {
        if ("reload" in r) await this.reload("reload");
        else this.receive(version, r.updates);
      }
    } catch (err) {
      this.rejected(err as Rejection);
    } finally {
      this.inflight = false;
    }
    this.refresh();
    if (this.opened && this.unconfirmed > 0) this.schedule(0);
  }

  /** Drop to the server's text, keeping ours for Copy my text (FR-NOTES-21, ADR-0078). */
  private async reload(kind: "full" | "reload"): Promise<void> {
    this.banner = { kind, text: this.host.state.doc.toString() };
    this.opened = false;
    this.past = [];
    try {
      const r = (await this.t.send("notes.open", {
        noteId: this.noteId,
        clientId: this.clientId,
      })) as OpenNoteResult;
      if (this.closed || r.mode !== "doc") return;
      this.host.setState(this.freshState(r.doc, r.version));
      this.here = r.here;
      this.opened = true;
    } catch (err) {
      this.rejected(err as Rejection);
    }
  }

  private rejected(e: Rejection): void {
    if (e.code === "not_found") {
      this.opened = false;
      this.banner = { kind: "gone", text: this.host.state.doc.toString() };
    } else if (e.code === "invalid" && e.message === NOTE_BODY_TOO_BIG) {
      void this.reload("full").then(() => this.refresh());
    } else if (e.code === "invalid" && e.message === NOTE_NOT_OPEN) {
      this.opened = false;
      void this.open();
    }
    // `disconnected` / `offline`: the next snapshot re-opens and the push follows.
  }

  /** Updates from version `from` (a signal, a re-open or a stale answer); skips those we have. */
  receive(from: number, updates: readonly NoteUpdate[]): void {
    const skip = this.version - from;
    if (skip < 0) {
      // A gap (a signal missed): the re-open brings what's missing.
      this.opened = false;
      void this.open();
      return;
    }
    const fresh = updates.slice(skip);
    if (fresh.length === 0) return;
    const list = toUpdates(fresh);
    const at = this.version;
    this.host.dispatch(receiveUpdates(this.host.state, list));
    const now = this.t.now();
    list.forEach((u, i) => {
      this.past.push({ version: at + i, changes: u.changes });
      // Carets stay where they are under others' typing (FR-NOTES-15): each one at this version
      // moves on with it; an update from its own person shows the name tag again.
      for (const c of this.cursors.values()) {
        if (c.clientId === u.clientID) c.at = now;
        if (c.version !== at + i) continue;
        c.ranges = c.ranges.map((r) => mapRange(r, u.changes));
        c.version = at + i + 1;
      }
    });
    if (this.past.length > CURSOR_MAX_LAG) this.past.splice(0, this.past.length - CURSOR_MAX_LAG);
    this.refresh();
  }

  /** `notes.updates`. */
  onUpdates(d: { noteId: string; from: number; updates: NoteUpdate[] }): void {
    if (d.noteId !== this.noteId || !this.opened) return;
    this.receive(d.from, d.updates);
  }

  /** `notes.here`. */
  onHere(d: { noteId: string; here: NoteHere[] }): void {
    if (d.noteId !== this.noteId) return;
    // r2 (late joiner): a new editor in the note gets our caret again, if we have shown one,
    // so it sees where everyone sits without waiting for them to move.
    const joined = d.here.some(
      (h) => h.clientId !== this.clientId && !this.here.some((o) => o.clientId === h.clientId),
    );
    this.here = d.here;
    for (const id of [...this.cursors.keys()])
      if (!d.here.some((h) => h.clientId === id)) this.cursors.delete(id);
    if (joined && this.cursorShown) this.selectionChanged();
    this.changed();
  }

  /** `notes.closed`: binned while open (FR-NOTES-20). */
  onClosed(d: { noteId: string }): void {
    if (d.noteId !== this.noteId) return;
    this.opened = false;
    this.banner = { kind: "deleted", text: this.host.state.doc.toString() };
    this.here = [];
    this.cursors.clear();
    this.refresh();
  }

  /** `notes.cursor` from someone else (`from` stamped by the server). */
  onCursor(d: NoteCursorSignal, from: { role: "dm" } | { role: "player"; playerId: string }): void {
    if (d.noteId !== this.noteId || d.clientId === this.clientId) return;
    if (d.left) this.cursors.delete(d.clientId);
    else {
      // From an older version: brought forward through the changes kept since; ahead of ours:
      // kept as is until `receive` brings us there. Stays until close, `left` or leaving `here`.
      let ranges = d.ranges.slice(0, NOTES_CURSOR_RANGES_MAX);
      let version = d.version;
      if (version < this.version) {
        for (const p of this.past)
          if (p.version >= version) ranges = ranges.map((r) => mapRange(r, p.changes));
        version = this.version;
      }
      this.cursors.set(d.clientId, {
        clientId: d.clientId,
        role: from.role,
        playerId: from.role === "player" ? from.playerId : null,
        version,
        ranges,
        at: this.t.now(),
      });
    }
    this.changed();
  }

  /** r1: a caret's name tag shows for `TAG_MS` after its person moved or typed (and on hover). */
  showTag(c: RemoteCursor): boolean {
    return this.t.now() - c.at < TAG_MS;
  }

  /**
   * A remote cursor's ranges in our current text: kept at our synced version as changes arrive,
   * then mapped through our unconfirmed changes. Null while it is ahead of us.
   */
  mapCursor(c: RemoteCursor): { anchor: number; head: number }[] | null {
    if (c.version > this.version) return null;
    let ranges = c.ranges;
    for (const u of sendableUpdates(this.host.state))
      ranges = ranges.map((r) => mapRange(r, u.changes));
    const len = this.host.state.doc.length;
    return ranges.map((r) => ({ anchor: Math.min(r.anchor, len), head: Math.min(r.head, len) }));
  }

  /** Our selection changed: a cursor signal, at most 10 a second (the last one always goes). */
  selectionChanged(): void {
    if (this.closed || !this.opened) return;
    const wait = this.lastCursorAt + 1000 / CURSOR_PER_SECOND - this.t.now();
    if (wait > 0) {
      if (this.cursorTimer === null)
        this.cursorTimer = this.t.setTimeout(() => {
          this.cursorTimer = null;
          this.selectionChanged();
        }, wait);
      return;
    }
    this.lastCursorAt = this.t.now();
    this.cursorShown = true;
    this.t.signal(NOTES_CURSOR_SIGNAL, {
      noteId: this.noteId,
      clientId: this.clientId,
      version: this.version,
      ranges: this.syncedSelection(),
    } satisfies NoteCursorSignal);
  }

  /**
   * r2 (caret drift): our selection in the text at our synced version. The editor's selection
   * already includes our unconfirmed typing, which receivers only get later as updates (and map
   * the caret through them), so it goes back through those changes first.
   */
  syncedSelection(): { anchor: number; head: number }[] {
    const state = this.host.state;
    const mine = sendableUpdates(state);
    let back: ChangeDesc | null = null;
    if (mine.length > 0) {
      let all = (mine[0] as (typeof mine)[number]).changes;
      for (const u of mine.slice(1)) all = all.compose(u.changes);
      back = all.invertedDesc;
    }
    return state.selection.ranges.slice(0, NOTES_CURSOR_RANGES_MAX).map((r) => ({
      anchor: back ? back.mapPos(r.anchor, -1) : r.anchor,
      head: back ? back.mapPos(r.head, -1) : r.head,
    }));
  }

  /** A new snapshot (reconnect, resync, restart): re-open from our version (FR-NOTES-18). */
  resynced(): void {
    if (this.closed) return;
    this.opened = false;
    void this.open();
  }

  /** The connection went down or came back. */
  connectionChanged(): void {
    this.refresh();
  }

  /** Leaving the note: `left` cursor, `notes.close` (best effort). */
  close(): void {
    if (this.closed) return;
    if (this.opened && this.t.live()) {
      this.t.signal(NOTES_CURSOR_SIGNAL, {
        noteId: this.noteId,
        clientId: this.clientId,
        version: this.version,
        ranges: [],
        left: true,
      } satisfies NoteCursorSignal);
      this.t.send("notes.close", { noteId: this.noteId }).catch(() => {});
    }
    this.closed = true;
    if (this.pushTimer !== null) this.t.clearTimeout(this.pushTimer);
    if (this.cursorTimer !== null) this.t.clearTimeout(this.cursorTimer);
    if (this.statusTimer !== null) this.t.clearTimeout(this.statusTimer);
  }
}
