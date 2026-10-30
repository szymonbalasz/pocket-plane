// FR-CMPX-17's panel logic, pure: the book search, what **Update all** takes, and the run: one
// import per book, one after another, each failure kept apart from the books that went through.
import {
  type BookStatus,
  bookPanelState,
  type FiveEtoolsStatus,
  type ImportResponse,
} from "@shared/compendium/import";

/** Name or abbreviation, any case. */
export function filterBooks(books: readonly BookStatus[], q: string): readonly BookStatus[] {
  const text = q.trim().toLowerCase();
  if (text === "") return books;
  return books.filter(
    (b) => b.name.toLowerCase().includes(text) || b.abbr.toLowerCase().includes(text),
  );
}

/** FR-CMPX-03: the imported books whose stored version isn't the folder's. */
export const updatableBooks = (s: FiveEtoolsStatus): readonly BookStatus[] =>
  s.books.filter((b) => bookPanelState(b, s.version) === "outdated");

export interface BooksResult {
  done: ImportResponse[];
  failed: { book: BookStatus; error: unknown }[];
}

/** The id all of a run's books send: the server adapts them from one folder read (#397). */
export const newRunId = () =>
  `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/** FR-CMPX-12: never in parallel, one command and one transaction per book. */
export async function importBooks(
  books: readonly BookStatus[],
  post: (key: string, run: string) => Promise<ImportResponse>,
  onBook: (index: number) => void,
  run = newRunId(),
): Promise<BooksResult> {
  const out: BooksResult = { done: [], failed: [] };
  for (const [i, book] of books.entries()) {
    onBook(i + 1);
    try {
      out.done.push(await post(book.key, run));
    } catch (error) {
      out.failed.push({ book, error });
    }
  }
  return out;
}
