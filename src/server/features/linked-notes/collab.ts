// Note co-writing, the server side (ADR-0078, slice N2). The DB is the source of truth: `note.body`
// up to `bodyVersion`, then the `note_change` rows up to `note.version` (one row per accepted push,
// `version` = the version its first update applies at). `NotesRuntime` holds, per services
// instance, a cache per open note (its current `Text` and version) and its subscribers (one per
// connection, each bound to an editor `clientId`); never stored. Imports only `@codemirror/state`.
import { ChangeSet, Text } from "@codemirror/state";
import {
  NOTE_BAD_CHANGE,
  NOTES_KEEP_BYTES,
  NOTES_KEEP_ROWS,
  NOTES_PUSH_UPDATES_MAX,
  type NoteHere,
  type NoteUpdate,
} from "@shared/linked-notes/collab";
import { and, asc, desc, eq, gte, lt } from "drizzle-orm";
import { invalid } from "../../commands/errors";
import type { Db, Tx } from "../../db/client";
import { noteChange } from "../../db/schema";
import type { Services } from "../../services";
import type { NoteRow } from "./rows";

type Reader = Db | Tx;

export interface Subscriber {
  connId: string;
  role: "dm" | "player";
  playerId: string | null;
  clientId: string;
}

export interface Session {
  noteId: string;
  campaignId: string;
  text: Text;
  version: number;
  /** connId → subscriber. */
  subs: Map<string, Subscriber>;
}

/** A body string as a CodeMirror `Text` (lines split on `\n`, as `Text.toString` joins them). */
export const textOf = (body: string): Text => Text.of(body.split("\n"));

/** One update's changes, or `invalid` when they don't parse or don't fit `text`. */
export function changesFor(text: Text, json: unknown): ChangeSet {
  let cs: ChangeSet;
  try {
    cs = ChangeSet.fromJSON(json);
  } catch {
    throw invalid(NOTE_BAD_CHANGE);
  }
  if (cs.length !== text.length) throw invalid(NOTE_BAD_CHANGE);
  return cs;
}

interface ChangeRow {
  version: number;
  updates: NoteUpdate[];
}

/** `note_change` rows whose updates reach version `v` or later, oldest first. */
function rowsFrom(db: Reader, noteId: string, v: number): ChangeRow[] {
  return db
    .select({ version: noteChange.version, changes: noteChange.changes })
    .from(noteChange)
    .where(
      and(
        eq(noteChange.noteId, noteId),
        gte(noteChange.version, Math.max(0, v - NOTES_PUSH_UPDATES_MAX)),
      ),
    )
    .orderBy(asc(noteChange.version))
    .all()
    .map((r) => ({ version: r.version, updates: r.changes as NoteUpdate[] }))
    .filter((r) => r.version + r.updates.length > v);
}

/**
 * The accepted updates from version `v` up to `current`, or null when some of them are no
 * longer kept (folded and pruned): that client must reload the whole text.
 */
export function updatesSince(
  db: Reader,
  noteId: string,
  v: number,
  current: number,
): NoteUpdate[] | null {
  if (v === current) return [];
  if (v > current) return null;
  const out: NoteUpdate[] = [];
  let at = v;
  for (const r of rowsFrom(db, noteId, v)) {
    if (r.version > at) return null;
    for (const [i, u] of r.updates.entries()) {
      if (r.version + i < at) continue;
      out.push(u);
      at++;
    }
  }
  return at === current ? out : null;
}

/** Rebuilds a note's current text from the DB: the body, then the rows past `bodyVersion`. */
export function loadText(db: Reader, row: NoteRow): Text {
  let text = textOf(row.body);
  const tail = updatesSince(db, row.id, row.bodyVersion, row.version);
  if (tail === null) throw new Error(`note ${row.id}: change rows missing past its body`);
  for (const u of tail) text = ChangeSet.fromJSON(u.changes).apply(text);
  return text;
}

/**
 * ADR-0078 pruning: keep the newest rows while there are at most 1,000 and they hold at most
 * 1 MiB; rows past `bodyVersion` are never dropped (the caller folds first).
 */
export function pruneChanges(tx: Tx, noteId: string, bodyVersion: number): void {
  const rows = tx
    .select({ version: noteChange.version, changes: noteChange.changes })
    .from(noteChange)
    .where(eq(noteChange.noteId, noteId))
    .orderBy(desc(noteChange.version))
    .all();
  let bytes = 0;
  let keep = 0;
  for (const r of rows) {
    const n = Buffer.byteLength(JSON.stringify(r.changes), "utf8");
    if (r.version < bodyVersion && (keep + 1 > NOTES_KEEP_ROWS || bytes + n > NOTES_KEEP_BYTES))
      break;
    keep++;
    bytes += n;
  }
  const oldestKept = rows[keep - 1]?.version;
  if (oldestKept === undefined || keep === rows.length) return;
  tx.delete(noteChange)
    .where(and(eq(noteChange.noteId, noteId), lt(noteChange.version, oldestKept)))
    .run();
}

export class NotesRuntime {
  readonly sessions = new Map<string, Session>();
  /** Text computed by an accepted push, taken by the after-commit hook (CON-23). */
  readonly pending = new Map<string, { version: number; text: Text }>();

  constructor(private readonly s: Services) {}

  /** The cached session, (re)built from the DB when missing or behind `row.version`. */
  session(db: Reader, row: NoteRow): Session {
    const cached = this.sessions.get(row.id);
    if (cached && cached.version === row.version) return cached;
    const s: Session = {
      noteId: row.id,
      campaignId: row.campaignId,
      text: loadText(db, row),
      version: row.version,
      subs: cached?.subs ?? new Map(),
    };
    this.sessions.set(row.id, s);
    return s;
  }

  /**
   * ADR-0078 pruning, run first by every notes command: drops the campaign's subscribers whose
   * connection is gone (not in `hub.connections`), and sessions left with none. Returns the notes whose open
   * editors changed.
   */
  prune(campaignId: string): string[] {
    const hub = this.s.hub;
    if (!hub) return [];
    const live = new Set(hub.connections(campaignId).map((c) => c.connId));
    const changed: string[] = [];
    for (const [id, s] of this.sessions) {
      if (s.campaignId !== campaignId) continue;
      let lost = false;
      for (const connId of s.subs.keys()) {
        if (live.has(connId)) continue;
        s.subs.delete(connId);
        lost = true;
      }
      if (lost && s.subs.size > 0) changed.push(id);
      if (s.subs.size === 0) this.sessions.delete(id);
    }
    return changed;
  }

  /** Notes a connection has open. */
  openCount(connId: string): number {
    let n = 0;
    for (const s of this.sessions.values()) if (s.subs.has(connId)) n++;
    return n;
  }

  /** FR-NOTES-16: one entry per open editor, in a stable order. */
  here(noteId: string): NoteHere[] {
    const s = this.sessions.get(noteId);
    if (!s) return [];
    return [...s.subs.values()]
      .map((x) => ({ role: x.role, playerId: x.playerId, clientId: x.clientId }))
      .sort((a, b) =>
        `${a.role}|${a.playerId ?? ""}|${a.clientId}`.localeCompare(
          `${b.role}|${b.playerId ?? ""}|${b.clientId}`,
        ),
      );
  }

  /** Drops every session not of `campaignId` (a campaign switch closes their connections). */
  dropOtherCampaigns(campaignId: string): void {
    for (const [id, s] of this.sessions) if (s.campaignId !== campaignId) this.sessions.delete(id);
  }
}

/** Each services instance's runtime (tests read sessions through it). */
export const notesRuntimes = new WeakMap<Services, NotesRuntime>();
