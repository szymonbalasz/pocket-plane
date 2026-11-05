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

/** Highlighted words of a snippet: `[start, end)` UTF-16 offsets, in order, not overlapping. */
export const NOTE_SNIPPET_MARKS_MAX = 20;
export const SnippetMark = z.tuple([z.int().min(0), z.int().min(0)]);

export const NoteSearchHit = z.strictObject({
  id: z.string(),
  title: z.string(),
  /**
   * Body text, links shown as their chips read (`[[T|label]]` → `label`, `[[T]]` → `T`): around
   * the first matching word, or the body's first line when only the title matched.
   */
  snippet: z.string(),
  /** The snippet's words a query word starts (none for a first line). */
  marks: z.array(SnippetMark).max(NOTE_SNIPPET_MARKS_MAX),
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

/** A link as stored (FR-NOTES-07): `[[Title]]` or `[[Title|label]]`. */
const LINK = /\[\[([^[\]|\n]+)(?:\|([^[\]\n]*))?\]\]/g;

/** Text as the editor shows it: each link as its chip reads, the label else the title. */
export function linkText(text: string): string {
  return text.replace(LINK, (_m, title: string, label?: string) =>
    label !== undefined && label.trim() !== "" ? label : title,
  );
}

/** A raw word as `fold` sees it (lower-cased, folded), cheaply for plain words. */
const folded = (w: string): string => {
  const lower = w.toLowerCase();
  return PLAIN.test(lower) ? lower : fold(w);
};

/** Index in `text` of the first word some form starts (as `fold` sees it), or -1. */
function firstHit(text: string, forms: readonly string[]): number {
  RAW_WORD.lastIndex = 0;
  for (let m = RAW_WORD.exec(text); m !== null; m = RAW_WORD.exec(text)) {
    const w = folded(m[0]);
    for (const f of forms) if (w.startsWith(f)) return m.index;
  }
  return -1;
}

/** The words of `snippet` some form starts. */
function marksOf(snippet: string, forms: readonly string[]): [number, number][] {
  const out: [number, number][] = [];
  if (forms.length === 0) return out;
  RAW_WORD.lastIndex = 0;
  for (let m = RAW_WORD.exec(snippet); m !== null; m = RAW_WORD.exec(snippet)) {
    const w = folded(m[0]);
    if (forms.some((f) => w.startsWith(f))) out.push([m.index, m.index + m[0].length]);
    if (out.length === NOTE_SNIPPET_MARKS_MAX) break;
  }
  return out;
}

/** `text` cut to the snippet length at a space, "…" where cut. */
function clip(text: string, start: number): string {
  let end = Math.min(text.length, start + NOTE_SNIPPET_MAX);
  if (end < text.length) {
    const cut = text.slice(start, end).search(/\s\S*$/);
    if (cut > NOTE_SNIPPET_MAX / 2) end = start + cut;
  }
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}

/**
 * FR-NOTES-22 snippet of a body for the query `words` (`queryWords(q)`), links shown as their
 * chips read (`linkText`): up to 140 characters from a little before the first word a query word
 * (≥ 3 letters, either plural form) starts, those words marked; when none does (a title match),
 * the body's first non-blank line, plain. Whitespace runs collapse; cuts fall on spaces, with "…".
 */
export function noteSnippet(
  body: string,
  words: readonly string[],
): { snippet: string; marks: [number, number][] } {
  const text = linkText(body);
  const forms = words.filter((w) => w.length >= TEXT_MATCH_MIN).flatMap((w) => wordForms(w));
  const at = forms.length > 0 ? firstHit(text, forms) : -1;
  if (at === -1) {
    const line = text.split("\n").find((l) => l.trim() !== "") ?? "";
    return { snippet: clip(line, 0), marks: [] };
  }
  let start = Math.max(0, at - NOTE_SNIPPET_LEAD);
  if (start > 0) {
    const space = text.slice(start, at).search(/\s/);
    start = space === -1 ? at : start + space + 1;
  }
  const snippet = clip(text, start);
  return { snippet, marks: marksOf(snippet, forms) };
}
