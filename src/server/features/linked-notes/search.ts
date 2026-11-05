// Note search (FR-NOTES-22, slice N4; ADR-0078 "Limits and load", ADR-0079 option A). One indexed
// read of the token's campaign's live notes (binned skipped), matched in memory with the shared
// matcher (`searchTier`). Nothing outside the campaign is read, so another campaign's notes cost
// a search nothing.
//
// Per note a cached entry: its folded title and sorted body words, so a search folds nothing it
// folded before. Body words come from the live text: an open note's session text; else the stored
// `bodyFold` when the body is folded up to `version`; else the body plus the change rows past it
// (a note closed before its next fold). Each campaign's list of live notes (ID, title) is cached
// too, so a warm search reads the DB only for its hits' snippets: reading `version` per note
// would walk 64 KiB of body pages at the caps, and 1,000 row reads go through SQLite's small page
// cache, which another campaign's notes would then make slower. So nothing is re-checked per
// search; caches are dropped instead: after the commit of every `NoteEdited` / `NoteChanged`
// (`searchCommitHook`), and an entry when an open note's session has moved past it. A server
// start begins empty; `notes.seedBody` (fixtures, before a server runs) emits nothing.
import { NoteChanged, NoteEdited } from "@shared/linked-notes/events";
import {
  NOTE_SEARCH_LIMIT,
  type NoteSearchHit,
  type NoteSearchResponse,
  noteSnippet,
} from "@shared/linked-notes/search";
import { type FoldedName, fold, foldName, queryWords, searchTier } from "@shared/search/match";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { CommitHook } from "../../commands/commands";
import type { Db } from "../../db/client";
import { note } from "../../db/schema";
import type { Services } from "../../services";
import { loadText, type NotesRuntime, notesRuntimes } from "./collab";

interface Entry {
  campaignId: string;
  /** The note version the words are of. */
  version: number;
  title: string;
  name: FoldedName;
  /** Sorted unique folded body words (`textWordsOf`), interned. */
  words: readonly string[];
  /** The stored `body` is the text at `version` (else the snippet needs the live text). */
  stored: boolean;
  /** The live text when it was rebuilt from change rows (no session, body behind), for snippets. */
  tail?: string;
}

/** Interned words above this many are dropped and re-interned (typing churns the vocabulary). */
const VOCAB_MAX = 500_000;

export class NoteSearchIndex {
  readonly entries = new Map<string, Entry>();
  /** Per campaign its live notes' heads, by folded title (dropped on every `NoteChanged`). */
  readonly heads = new Map<string, Head[]>();
  private vocab = new Map<string, string>();

  /** Sorted unique words of a folded text, each the one shared string for that word. */
  wordsOf(folded: string): string[] {
    if (folded === "") return [];
    if (this.vocab.size > VOCAB_MAX) this.vocab = new Map();
    const seen = new Set<string>();
    for (const w of folded.split(" ")) {
      let k = this.vocab.get(w);
      if (k === undefined) {
        k = w;
        this.vocab.set(w, w);
      }
      seen.add(k);
    }
    return [...seen].sort();
  }
}

const indexes = new WeakMap<Services, NoteSearchIndex>();

export function noteSearchIndex(s: Services): NoteSearchIndex {
  let i = indexes.get(s);
  if (!i) {
    i = new NoteSearchIndex();
    indexes.set(s, i);
  }
  return i;
}

/** Forgets the cache (as a server restart does; the bench's cold search). */
export function dropNoteSearchIndex(s: Services): void {
  indexes.delete(s);
}

/**
 * Drops the entry of every note a committed `NoteEdited` / `NoteChanged` touched, and on a
 * `NoteChanged` (create, rename, delete, restore) its campaign's heads.
 */
export function searchCommitHook(s: Services): CommitHook {
  return ({ event }) => {
    if (event.type !== NoteEdited.type && event.type !== NoteChanged.type) return;
    const idx = indexes.get(s);
    if (!idx) return;
    idx.entries.delete((event.payload as { noteId: string }).noteId);
    if (event.type === NoteChanged.type && event.campaignId !== null)
      idx.heads.delete(event.campaignId);
  };
}

/** The columns stored before `body`: cheap to read for every note, and all a match needs. */
interface Head {
  id: string;
  title: string;
  titleFold: string;
}

/** A closed note's text: the body, then the change rows past it. */
function liveTextOf(db: Db, id: string): string {
  const row = db.select().from(note).where(eq(note.id, id)).get();
  return row ? loadText(db, row).toString() : "";
}

function build(db: Db, rt: NotesRuntime | undefined, idx: NoteSearchIndex, cid: string, h: Head) {
  const row = db
    .select({ version: note.version, bodyVersion: note.bodyVersion, bodyFold: note.bodyFold })
    .from(note)
    .where(eq(note.id, h.id))
    .get();
  let folded = "";
  let tail: string | undefined;
  let version = row?.version ?? 0;
  const session = rt?.sessions.get(h.id);
  if (row && session && session.version === row.version) {
    folded = fold(session.text.toString());
  } else if (row && row.version === row.bodyVersion) {
    folded = row.bodyFold;
  } else if (row) {
    tail = liveTextOf(db, h.id);
    folded = fold(tail);
  } else {
    version = -1;
  }
  const e: Entry = {
    campaignId: cid,
    version,
    title: h.title,
    name: foldName(h.title),
    words: idx.wordsOf(folded),
    stored: row !== undefined && row.version === row.bodyVersion,
    ...(tail === undefined ? {} : { tail }),
  };
  idx.entries.set(h.id, e);
  return e;
}

function entryFor(
  db: Db,
  rt: NotesRuntime | undefined,
  idx: NoteSearchIndex,
  cid: string,
  h: Head,
) {
  const e = idx.entries.get(h.id);
  const session = rt?.sessions.get(h.id);
  if (e && e.title === h.title && (!session || session.version === e.version)) return e;
  return build(db, rt, idx, cid, h);
}

export interface NoteSearchRun {
  response: NoteSearchResponse;
  /** Notes the search looked at: the campaign's live notes, nothing else (isolation tests). */
  scanned: number;
}

/** FR-NOTES-22: campaign `cid`'s live notes matching `q`, best tier first, then by title. */
export function runNoteSearch(s: Services, cid: string, q: string): NoteSearchRun {
  const words = queryWords(q);
  if (words.length === 0) return { response: { results: [], more: false }, scanned: 0 };
  const db = s.db;
  const rt = notesRuntimes.get(s);
  const idx = noteSearchIndex(s);
  let heads = idx.heads.get(cid);
  if (!heads) {
    heads = db
      .select({ id: note.id, title: note.title, titleFold: note.titleFold })
      .from(note)
      .where(and(eq(note.campaignId, cid), isNull(note.deletedAt)))
      .orderBy(asc(note.titleFold), asc(note.id))
      .all();
    idx.heads.set(cid, heads);
  }
  const hits: { h: Head; e: Entry; tier: number }[] = [];
  for (const h of heads) {
    const e = entryFor(db, rt, idx, cid, h);
    const tier = searchTier(e.name, e.words, words);
    if (tier !== null) hits.push({ h, e, tier });
  }
  // Already by title: a stable sort by tier keeps that order within a tier.
  hits.sort((a, b) => a.tier - b.tier);
  const top = hits.slice(0, NOTE_SEARCH_LIMIT);
  // Snippets: the live text of each hit (the stored body when it is current).
  const texts = new Map<string, string>();
  const stored: string[] = [];
  for (const { h, e } of top) {
    const session = rt?.sessions.get(h.id);
    if (session && session.version === e.version) texts.set(h.id, session.text.toString());
    else if (e.stored) stored.push(h.id);
    else {
      // Built from a session that has closed since, its body not folded yet.
      if (e.tail === undefined) e.tail = liveTextOf(db, h.id);
      texts.set(h.id, e.tail);
    }
  }
  if (stored.length > 0) {
    // By ID alone (the IDs come from this campaign's heads): with the campaign in the WHERE,
    // SQLite walks the campaign's index and reads every one of its rows.
    for (const r of db
      .select({ id: note.id, campaignId: note.campaignId, body: note.body })
      .from(note)
      .where(inArray(note.id, stored))
      .all())
      if (r.campaignId === cid) texts.set(r.id, r.body);
  }
  const results: NoteSearchHit[] = top.map(({ h }) => ({
    id: h.id,
    title: h.title,
    ...noteSnippet(texts.get(h.id) ?? "", words),
  }));
  return { response: { results, more: hits.length > top.length }, scanned: heads.length };
}
