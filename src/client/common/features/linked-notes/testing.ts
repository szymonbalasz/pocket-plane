// Test support (N3): an in-memory note authority that answers like the server (ADR-0078: accept at
// the current version, else the updates since; `notes.updates` to every open editor before the
// sender's ack; `reload` once rows are gone), a fake clock, and editors driving `NoteSession`s.
import { ChangeSet, type EditorState, Text } from "@codemirror/state";
import type { NoteHere, NoteUpdate } from "@shared/linked-notes/collab";
import { NOTE_BODY_MAX_BYTES, NOTE_BODY_TOO_BIG } from "@shared/linked-notes/schemas";
import { type NoteHost, NoteSession, type NoteTransport } from "./session";

export class FakeClock {
  now = 0;
  private queue: { at: number; fn: () => void; id: number }[] = [];
  private next = 1;
  setTimeout = (fn: () => void, ms: number): unknown => {
    const id = this.next++;
    this.queue.push({ at: this.now + ms, fn, id });
    return id;
  };
  clearTimeout = (h: unknown): void => {
    this.queue = this.queue.filter((q) => q.id !== h);
  };
  /** Runs every timer due within `ms`, letting promises settle between them. */
  async advance(ms: number): Promise<void> {
    const end = this.now + ms;
    for (;;) {
      await settle();
      this.queue.sort((a, b) => a.at - b.at);
      const q = this.queue[0];
      if (!q || q.at > end) break;
      this.queue.shift();
      this.now = Math.max(this.now, q.at);
      q.fn();
    }
    this.now = end;
    await settle();
  }
}

/** Lets every pending promise run (a real macrotask turn flushes the microtask queue). */
export async function settle(): Promise<void> {
  await new Promise<void>((r) => setTimeout(r, 0));
}

class Rejected extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** The server's side of one note: text, version, the kept updates, who has it open. */
export class FakeAuthority {
  text: Text;
  version = 0;
  log: NoteUpdate[] = [];
  /** Versions below this are no longer kept (pushes from before them get `reload`). */
  keptFrom = 0;
  readonly editors = new Map<string, FakeEditor>();
  pushes: { bytes: number; updates: number }[] = [];
  /** Next push answers `not_found` (binned meanwhile). */
  gone = false;

  constructor(
    readonly noteId: string,
    doc = "",
  ) {
    this.text = Text.of(doc.split("\n"));
  }

  here(): NoteHere[] {
    return [...this.editors.values()]
      .filter((e) => e.subscribed)
      .map((e) => ({ role: e.role, playerId: e.playerId, clientId: e.session.clientId }));
  }

  since(v: number): NoteUpdate[] | null {
    if (v > this.version || v < this.keptFrom) return null;
    return this.log.slice(v - this.keptFrom);
  }

  open(e: FakeEditor, p: { version?: number }) {
    if (this.gone) throw new Rejected("not_found", "Note not found");
    e.subscribed = true;
    const since = p.version === undefined ? null : this.since(p.version);
    const out =
      since === null
        ? { mode: "doc", version: this.version, doc: this.text.toString(), here: this.here() }
        : { mode: "updates", version: this.version, updates: since, here: this.here() };
    for (const o of this.editors.values())
      if (o !== e && o.subscribed) o.session.onHere({ noteId: this.noteId, here: this.here() });
    return out;
  }

  push(e: FakeEditor, p: { version: number; updates: NoteUpdate[] }, bytes: number) {
    if (this.gone) throw new Rejected("not_found", "Note not found");
    if (!e.subscribed) throw new Rejected("invalid", "Open the note first");
    this.pushes.push({ bytes, updates: p.updates.length });
    if (p.version !== this.version) {
      const since = this.since(p.version);
      return since === null
        ? { accepted: false, reload: true }
        : { accepted: false, updates: since };
    }
    let t = this.text;
    for (const u of p.updates) t = ChangeSet.fromJSON(u.changes).apply(t);
    if (new TextEncoder().encode(t.toString()).length > NOTE_BODY_MAX_BYTES)
      throw new Rejected("invalid", NOTE_BODY_TOO_BIG);
    const from = this.version;
    this.text = t;
    this.version += p.updates.length;
    this.log.push(...p.updates);
    for (const o of this.editors.values())
      if (o.subscribed && o.live)
        o.session.onUpdates({ noteId: this.noteId, from, updates: p.updates });
    return { accepted: true };
  }

  /** Folds and forgets every kept update (a far-behind editor must reload). */
  forget(): void {
    this.keptFrom = this.version;
    this.log = [];
  }
}

/** One tab: a session over a plain `EditorState` host and a transport to the authority. */
export class FakeEditor implements NoteHost {
  state: EditorState;
  live = true;
  subscribed = false;
  readonly session: NoteSession;
  readonly sent: { name: string; data: unknown }[] = [];
  changes = 0;

  constructor(
    readonly auth: FakeAuthority,
    readonly clock: FakeClock,
    readonly clientId: string,
    readonly role: "dm" | "player" = "player",
    readonly playerId: string | null = clientId,
  ) {
    const transport: NoteTransport = {
      live: () => this.live,
      now: () => clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      signal: (name, data) => {
        if (!this.live) return false;
        this.sent.push({ name, data });
        return true;
      },
      send: async (name, payload) => {
        await Promise.resolve();
        if (!this.live) throw new Rejected("offline", "Not connected");
        const bytes = new TextEncoder().encode(JSON.stringify(payload)).length;
        const p = payload as { version?: number; updates: NoteUpdate[] };
        if (name === "notes.open") return auth.open(this, p);
        if (name === "notes.push") return auth.push(this, p as never, bytes);
        if (name === "notes.close") {
          this.subscribed = false;
          return undefined;
        }
        throw new Error(`unexpected ${name}`);
      },
    };
    this.session = new NoteSession({
      noteId: auth.noteId,
      clientId,
      transport,
      host: this,
      onChange: () => {
        this.changes++;
      },
    });
    this.state = this.session.freshState("", 0);
    auth.editors.set(clientId, this);
  }

  dispatch(tr: Parameters<NoteHost["dispatch"]>[0]): void {
    this.state = "startState" in tr ? tr.state : this.state.update(tr).state;
  }
  setState(state: EditorState): void {
    this.state = state;
  }

  get doc(): string {
    return this.state.doc.toString();
  }

  /** Types `text` at `at` as the user would (then the session's 100 ms push). */
  type(at: number | "end", text: string): boolean {
    const pos = at === "end" ? this.state.doc.length : Math.min(at, this.state.doc.length);
    const tr = this.state.update({ changes: { from: pos, insert: text }, userEvent: "input" });
    const changed = tr.docChanged;
    this.state = tr.state;
    if (changed) this.session.edited();
    return changed;
  }

  erase(from: number, to: number): void {
    this.state = this.state.update({ changes: { from, to }, userEvent: "delete" }).state;
    this.session.edited();
  }

  /** Drops (the server's subscription goes with the connection). */
  disconnect(): void {
    this.live = false;
    this.subscribed = false;
    this.session.connectionChanged();
  }

  /** Back with a new snapshot: the session re-opens. */
  reconnect(): void {
    this.live = true;
    this.session.resynced();
  }
}
