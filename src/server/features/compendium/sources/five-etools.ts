// User-supplied sources (ADR-0074), next to the bundled ones: the DM's own 5etools folder. A book's
// source key maps to files here, on the server; a client only ever sends a key (FR-CMPX-02). The
// book list is cached per process until the folder's version changes; an Import / Update run reads
// the folder once, at its start, and adapts each of its books from that read (spec §11, #397).
import { existsSync } from "node:fs";
import path from "node:path";
import { BOOK_SOURCE_PREFIX, bookAbbr } from "@shared/compendium/match";
import { invalid } from "../../../commands/errors";
import type { SourceDescriptor } from "../../fixtures-adapters/import-pipeline";
import {
  adaptBookData,
  type BookList,
  bookKey,
  bookVersion,
  describeBooks,
  FolderError,
  listBooks,
} from "../adapter/5etools";
import { type FolderData, readFolder, readFromDir, readLabels } from "../adapter/5etools/read";
import type { AdapterResult } from "../adapter/open5e";

export const FIVE_ETOOLS_LICENCE = "User-supplied (5etools)";

/** FR-CMPX-18: a book's credit in the About dialog. */
export const bookAttribution = (book: string) =>
  `${book} — © Wizards of the Coast. Read from your own 5etools files for use at your table.`;

export type FiveEtoolsFolder = { state: "not-configured" } | BookList;
type ReadyList = Extract<BookList, { state: "ready" }>;

const lists = new Map<string, ReadyList>();
/** Source key → the book's real abbreviation (badges, FR-CMPX-16); labels only, a cheap read. */
const abbrs = new Map<string, ReadonlyMap<string, string>>();

/** FR-CMPX-01, -02: the folder's state and books. Costs two small files when nothing changed. */
export function fiveEtoolsFolder(dir: string | null): FiveEtoolsFolder {
  if (dir === null) return { state: "not-configured" };
  let version: string | null = null;
  try {
    version = bookVersion(readLabels(readFromDir(dir)).release);
  } catch {
    // Not there or malformed: `listBooks` says which.
  }
  const cached = lists.get(dir);
  if (cached && cached.version === version) return cached;
  const list = listBooks(dir);
  if (list.state === "ready") {
    lists.set(dir, list);
    abbrs.set(dir, new Map(list.books.map((b) => [b.key, b.abbr])));
  } else {
    lists.delete(dir);
  }
  return list;
}

function labelAbbrs(dir: string): ReadonlyMap<string, string> {
  let known = abbrs.get(dir);
  if (!known) {
    try {
      const { names } = readLabels(readFromDir(dir));
      known = new Map([...names.keys()].map((abbr) => [bookKey(abbr), abbr]));
    } catch {
      known = new Map();
    }
    abbrs.set(dir, known);
  }
  return known;
}

/** A source's badge: the book's abbreviation, or undefined for any other source. */
export type BookAbbrOf = (source: string, name: string) => string | undefined;

/**
 * FR-CMPX-16 (#396): the folder's real abbreviation ("CoS"). A book the labels don't know is named
 * after its abbreviation; with the folder gone, the key upper-cased is the best left.
 */
export const bookAbbrOf =
  (dir: string | null): BookAbbrOf =>
  (source, name) => {
    if (!source.startsWith(BOOK_SOURCE_PREFIX)) return undefined;
    const known = dir === null ? undefined : labelAbbrs(dir).get(source);
    if (known) return known;
    const abbr = source.slice(BOOK_SOURCE_PREFIX.length);
    return name.toLowerCase() === abbr ? name : (bookAbbr(source) ?? undefined);
  };

// ---------- one run, one read ----------

interface FolderRead {
  version: string;
  data: FolderData;
  books: ReturnType<typeof describeBooks>;
}

/** Parsed per run and dropped after (FR-CMPX-04): at its last book, or idle if that never comes. */
export const RUN_IDLE_MS = 60_000;
let open: { dir: string; run: string; read: FolderRead; timer: Timer } | null = null;

function dropRun() {
  if (open) clearTimeout(open.timer);
  open = null;
}

/** The client's last book of `run`: its read isn't needed any more. */
export function endFolderRun(run: string) {
  if (open?.run === run) dropRun();
}

function readBooks(dir: string): FolderRead {
  const read = readFromDir(dir);
  const labels = readLabels(read);
  const data = readFolder(read);
  return { version: bookVersion(labels.release), data, books: describeBooks(data, labels) };
}

function folderRead(dir: string, run: string | undefined): FolderRead {
  if (run !== undefined && open?.dir === dir && open.run === run) {
    const { read } = open;
    clearTimeout(open.timer);
    open.timer = setTimeout(dropRun, RUN_IDLE_MS);
    open.timer.unref();
    return read;
  }
  dropRun();
  const read = readBooks(dir);
  if (run !== undefined) {
    const timer = setTimeout(dropRun, RUN_IDLE_MS);
    timer.unref();
    open = { dir, run, read, timer };
  }
  return read;
}

export interface FiveEtoolsBook {
  source: SourceDescriptor;
  version: string;
  adapted: AdapterResult;
}

/**
 * The import of one book (FR-CMPX-02, -03, -18). No folder, or a key not in its list → `invalid`;
 * a malformed file → `invalid` with its issues, nothing written for this book (§11).
 */
export function fiveEtoolsBook(
  dir: string | null,
  key: string,
  run: string | undefined,
): FiveEtoolsBook {
  if (dir === null) throw invalid("5etools folder not configured");
  let read: FolderRead;
  try {
    read = folderRead(dir, run);
  } catch (e) {
    if (!(e instanceof FolderError)) throw e;
    throw invalid(
      "5etools folder can't be read",
      e.issues.map((message) => ({ path: ["source"], message })),
    );
  }
  const book = read.books.find((b) => b.key === key);
  if (!book) {
    throw invalid("Not a book of the 5etools folder", [
      { path: ["source"], message: "Not in the folder's list" },
    ]);
  }
  return {
    source: {
      key: book.key,
      name: book.name,
      licence: FIVE_ETOOLS_LICENCE,
      attribution: bookAttribution(book.name),
    },
    version: read.version,
    adapted: adaptBookData(read.data, book.abbr, {
      exists: (rel) => existsSync(path.join(dir, rel)),
    }),
  };
}
