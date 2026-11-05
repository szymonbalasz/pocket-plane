// Test support for co-writing (N2): a real `@codemirror/collab` editor state per test client,
// driven like the N3 window will drive it: open (doc or updates), type, push the sendable updates
// at the synced version, apply `notes.updates` signals and stale-push answers, rebase, resend.

import {
  collab,
  getSyncedVersion,
  receiveUpdates,
  sendableUpdates,
  type Update,
} from "@codemirror/collab";
import { ChangeSet, EditorState } from "@codemirror/state";
import {
  NOTES_UPDATES_SIGNAL,
  type NoteUpdate,
  type OpenNoteResult,
  type PushNoteResult,
} from "@shared/linked-notes/collab";
import type { ServerFrame } from "@shared/protocol/frames";
import type { TestClient } from "../../testing/harness";
import { NOTES_COLLAB_INTENTS as C } from "./collab-commands";

const toUpdates = (list: readonly NoteUpdate[]): Update[] =>
  list.map((u) => ({ changes: ChangeSet.fromJSON(u.changes), clientID: u.clientId }));

type Answer = Extract<ServerFrame, { type: "ack" | "reject" }>;

export class Peer {
  state: EditorState | null = null;
  /** Every `notes.*` signal frame seen, for isolation checks. */
  readonly signals: { name: string; data: unknown }[] = [];
  reloads = 0;
  /** Stale pushes answered with the updates since (the rebase path). */
  rebases = 0;

  constructor(
    public c: TestClient,
    readonly noteId: string,
    readonly clientId: string,
  ) {}

  get doc(): string {
    return this.state?.doc.toString() ?? "";
  }
  get version(): number {
    return this.state ? getSyncedVersion(this.state) : -1;
  }

  /** Reads frames in order (applying signals) until the answer to `intentId`. */
  async answer(intentId: string, ms = 5000): Promise<Answer> {
    for (;;) {
      const f = await this.c.next(undefined, ms);
      if (f.type === "signal") this.signal(f.name, f.data);
      else if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
    }
  }

  private signal(name: string, data: unknown): void {
    if (!name.startsWith("notes.")) return;
    this.signals.push({ name, data });
    const d = data as { noteId: string; from: number; updates: NoteUpdate[] };
    if (name !== NOTES_UPDATES_SIGNAL || d.noteId !== this.noteId) return;
    this.receive(d.from, d.updates);
  }

  /** Applies updates starting at version `from`, skipping those already applied. */
  receive(from: number, updates: readonly NoteUpdate[]): void {
    if (!this.state) return;
    const skip = this.version - from;
    if (skip < 0) throw new Error(`${this.clientId}: gap (${from} > ${this.version})`);
    const fresh = updates.slice(skip);
    if (fresh.length > 0) this.state = receiveUpdates(this.state, toUpdates(fresh)).state;
  }

  /** `notes.open`: a first open takes the doc; a re-open sends the synced version. */
  async open(): Promise<OpenNoteResult> {
    const payload =
      this.state === null
        ? { noteId: this.noteId, clientId: this.clientId }
        : { noteId: this.noteId, clientId: this.clientId, version: this.version };
    const a = await this.answer(this.c.intent(C.open, payload));
    if (a.type !== "ack") throw new Error(`open refused: ${JSON.stringify(a)}`);
    const r = a.result as OpenNoteResult;
    if (r.mode === "doc") {
      if (this.state && sendableUpdates(this.state).length > 0) this.reloads++;
      this.state = EditorState.create({
        doc: r.doc,
        extensions: [collab({ startVersion: r.version, clientID: this.clientId })],
      });
    } else {
      this.receive(r.version - r.updates.length, r.updates);
    }
    return r;
  }

  type(at: number | "end", text: string): void {
    if (!this.state) throw new Error("not open");
    const pos = at === "end" ? this.state.doc.length : Math.min(at, this.state.doc.length);
    this.state = this.state.update({ changes: { from: pos, insert: text } }).state;
  }

  /** The push payload for the current unconfirmed updates (null when there are none). */
  pending(): { noteId: string; version: number; updates: NoteUpdate[] } | null {
    if (!this.state) return null;
    const list = sendableUpdates(this.state);
    if (list.length === 0) return null;
    return {
      noteId: this.noteId,
      version: this.version,
      updates: list.map((u) => ({ clientId: u.clientID, changes: u.changes.toJSON() as never })),
    };
  }

  /** Pushes until nothing is unconfirmed, rebasing on stale answers. Returns the push count. */
  async flush(max = 50): Promise<number> {
    let n = 0;
    for (let p = this.pending(); p !== null; p = this.pending()) {
      if (++n > max) throw new Error(`${this.clientId}: no progress after ${max} pushes`);
      const a = await this.answer(this.c.intent(C.push, p));
      if (a.type !== "ack") throw new Error(`push refused: ${JSON.stringify(a)}`);
      const r = a.result as PushNoteResult;
      if (r.accepted) continue; // its own notes.updates (read before the ack) confirmed it
      if ("reload" in r) throw new Error(`${this.clientId}: reload`);
      this.rebases++;
      this.receive(p.version, r.updates);
    }
    return n;
  }

  /** A ping round trip: every frame the server sent before it is applied. */
  async settle(): Promise<void> {
    this.c.send({ type: "ping" });
    for (;;) {
      const f = await this.c.next(undefined, 5000);
      if (f.type === "signal") this.signal(f.name, f.data);
      if (f.type === "pong") return;
    }
  }
}
