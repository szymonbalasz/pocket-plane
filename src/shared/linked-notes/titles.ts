// Note titles (FR-NOTES-02, -05): validity, the folded key (the shared matcher's `fold`) and the
// "(restored)" names. Pure; used by the server commands and, later, the client.
import { fold } from "@shared/search/match";

/** FR-NOTES-02: at most this many characters (code points, so an emoji is one). */
export const NOTE_TITLE_MAX = 100;

/** `[[`, `]]`, `|` or a line break (CR, LF, U+2028, U+2029). */
const FORBIDDEN = /\[\[|\]\]|\||[\r\n\u2028\u2029]/;

/** Length in code points (never splits a surrogate pair). */
export const titleLength = (s: string): number => [...s].length;

/** FR-NOTES-02 on an already trimmed title. */
export function isNoteTitle(title: string): boolean {
  const n = titleLength(title);
  return n >= 1 && n <= NOTE_TITLE_MAX && !FORBIDDEN.test(title);
}

/** FR-NOTES-02: the key titles are compared on (and links resolve by, FR-NOTES-07). */
export function titleFold(title: string): string {
  return fold(title);
}

/** "(restored)", then "(restored 2)", "(restored 3)"… (FR-NOTES-05). */
export const restoredSuffix = (n: number): string => (n <= 1 ? " (restored)" : ` (restored ${n})`);

/**
 * FR-NOTES-05: the title a restored note comes back with. `taken(fold)` is true when a live note
 * (other than this one) holds that folded title. The original title if free; else the first free
 * "Title (restored)", "Title (restored 2)"…, the title cut (and its end trimmed) so the whole
 * stays within 100 characters. Ends: at most one more try than there are live notes.
 */
export function restoredTitle(title: string, taken: (fold: string) => boolean): string {
  if (!taken(titleFold(title))) return title;
  const chars = [...title];
  for (let n = 1; ; n++) {
    const suffix = restoredSuffix(n);
    const room = NOTE_TITLE_MAX - titleLength(suffix);
    const base = chars.length > room ? chars.slice(0, room).join("").trimEnd() : title;
    const candidate = `${base}${suffix}`;
    if (!taken(titleFold(candidate))) return candidate;
  }
}
