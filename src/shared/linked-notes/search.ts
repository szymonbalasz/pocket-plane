// Note search (FR-NOTES-22, slice N4): `GET /api/notes/search?q=` with a DM bearer or a player
// token, the token's campaign only. Live notes' titles and bodies, matched with the shared matcher
// (`src/shared/search/`, ADR-0079); up to 50 results, each with its title and a snippet.
import { z } from "zod";
import { fold, TEXT_MATCH_MIN, wordForms } from "../search/match";

/** FR-NOTES-22: results per search. */
export const NOTE_SEARCH_LIMIT = 50;
/** Query length, as compendium search (`SEARCH_Q_MAX`). */
export const NOTE_SEARCH_Q_MAX = 100;
/** A snippet's length in characters, ellipses excluded. */
export const NOTE_SNIPPET_MAX = 140;
/** How much text a snippet keeps before the first matching word. */
export const NOTE_SNIPPET_LEAD = 40;

export const NoteSearchQuery = z.strictObject({ q: z.string().max(NOTE_SEARCH_Q_MAX) });
export type NoteSearchQuery = z.infer<typeof NoteSearchQuery>;

export const NoteSearchHit = z.strictObject({
  id: z.string(),
  title: z.string(),
  /** Body text around the first matching word (the body's start for a title match). */
  snippet: z.string(),
});
export type NoteSearchHit = z.infer<typeof NoteSearchHit>;

export const NoteSearchResponse = z.strictObject({
  results: z.array(NoteSearchHit).max(NOTE_SEARCH_LIMIT),
  /** More notes matched than were returned. */
  more: z.boolean(),
});
export type NoteSearchResponse = z.infer<typeof NoteSearchResponse>;

/** A raw word: what `fold` keeps as one word (apostrophes and marks join, never split). */
const RAW_WORD = /[\p{L}\p{N}\p{M}'’]+/gu;
const PLAIN = /^[a-z0-9]+$/;

/** Index in `text` of the first word some form starts (as `fold` sees it), or 0. */
function firstHit(text: string, forms: readonly string[]): number {
  RAW_WORD.lastIndex = 0;
  for (let m = RAW_WORD.exec(text); m !== null; m = RAW_WORD.exec(text)) {
    const lower = m[0].toLowerCase();
    const w = PLAIN.test(lower) ? lower : fold(m[0]);
    for (const f of forms) if (w.startsWith(f)) return m.index;
  }
  return 0;
}

/**
 * FR-NOTES-22 snippet: up to 140 characters of `text` from a little before the first word that
 * a query word (`queryWords(q)`, ≥ 3 letters, either plural form) starts; the text's start when
 * none does (a title match). Whitespace runs collapse; cuts fall on spaces, marked with "…".
 */
export function noteSnippet(text: string, words: readonly string[]): string {
  if (text.trim() === "") return "";
  const forms = words.filter((w) => w.length >= TEXT_MATCH_MIN).flatMap((w) => wordForms(w));
  const at = forms.length > 0 ? firstHit(text, forms) : 0;
  let start = Math.max(0, at - NOTE_SNIPPET_LEAD);
  if (start > 0) {
    const space = text.slice(start, at).search(/\s/);
    start = space === -1 ? at : start + space + 1;
  }
  let end = Math.min(text.length, start + NOTE_SNIPPET_MAX);
  if (end < text.length) {
    const cut = text.slice(start, end).search(/\s\S*$/);
    if (cut > NOTE_SNIPPET_MAX / 2) end = start + cut;
  }
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}
