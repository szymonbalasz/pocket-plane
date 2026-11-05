// Note search (FR-NOTES-22, slice N4): `GET /api/notes/search?q=` with a DM bearer or a player
// token, the token's campaign only. Live notes' titles and bodies, matched with the shared matcher
// (`src/shared/search/`, ADR-0079); up to 50 results, each with its title and a snippet.
import { z } from "zod";
import {
  compileQuery,
  type FoldedName,
  fold,
  lowerBound,
  queryTier,
  type SearchTier,
  TEXT_MATCH_MIN,
  wordForms,
} from "../search/match";
import { parseLinks } from "./links";

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

/** Text as the editor shows it: each link (`parseLinks`) as its chip reads, the label else the title. */
export function chipText(text: string): string {
  let out = "";
  let at = 0;
  for (const l of parseLinks(text)) {
    out += text.slice(at, l.from) + (l.label ?? l.target);
    at = l.to;
  }
  return out + text.slice(at);
}

/** Markdown markers as the editor's live preview hides them: headings, list markers, `**`. */
const HEADING_MARK = /^[ \t]*#{1,3}[ \t]+/gm;
const LIST_MARK = /^[ \t]*(?:[-*]|\d+\.)[ \t]+/gm;
const BOLD_MARK = /\*\*([^*\r\n]+)\*\*/g;

/** r1: text as the editor reads off the caret's line: chips' text, no markdown markers. */
export function plainText(text: string): string {
  return stripMarks(chipText(text));
}

/** Markdown markers out of (chip-) text. */
const stripMarks = (text: string) =>
  text.replace(HEADING_MARK, "").replace(LIST_MARK, "").replace(BOLD_MARK, "$1");

/** Room around the first hit that markers are stripped in (the snippet is cut from it). */
const WINDOW = 400;

/**
 * r1 body rule per query word (the name rule is the shared matcher's): the **last** word, still
 * being typed, matches as a prefix at any length ("the ledger k" keeps "keeper"); any other word
 * under 3 letters matches a whole body word ("line of"); longer words match as prefixes, their
 * plural forms too, as the shared matcher does.
 */
export function bodyRule(words: readonly string[]): ((w: string) => boolean)[] {
  const last = words.length - 1;
  return words.map((q, i) => {
    if (i === last) {
      const forms = q.length >= TEXT_MATCH_MIN ? wordForms(q) : [q];
      return (w: string) => forms.some((f) => w.startsWith(f));
    }
    if (q.length < TEXT_MATCH_MIN) return (w: string) => w === q;
    const forms = wordForms(q);
    return (w: string) => forms.some((f) => w.startsWith(f));
  });
}

/**
 * FR-NOTES-22 (r1): the shared matcher's tiers (`queryTier`) with notes' body rule (`bodyRule`)
 * over the body's sorted, folded words.
 */
export function noteSearchTier(
  name: FoldedName,
  textWords: readonly string[],
  words: readonly string[],
): SearchTier | null {
  const q = compileQuery(words);
  const last = words.length - 1;
  return queryTier(name, q, (i) => {
    const w = words[i] as string;
    if (i !== last && w.length < TEXT_MATCH_MIN) return textWords[lowerBound(textWords, w)] === w;
    const forms = i === last && w.length < TEXT_MATCH_MIN ? [w] : (q.forms[i] as readonly string[]);
    return forms.some((f) => textWords[lowerBound(textWords, f)]?.startsWith(f) === true);
  });
}

/** A raw word as `fold` sees it (lower-cased, folded), cheaply for plain words. */
const folded = (w: string): string => {
  const lower = w.toLowerCase();
  return PLAIN.test(lower) ? lower : fold(w);
};

type Rule = (w: string) => boolean;

/** Index in `text` of the first word a rule matches (as `fold` sees it), or -1. */
function firstHit(text: string, rules: readonly Rule[]): number {
  RAW_WORD.lastIndex = 0;
  for (let m = RAW_WORD.exec(text); m !== null; m = RAW_WORD.exec(text)) {
    const w = folded(m[0]);
    if (rules.some((r) => r(w))) return m.index;
  }
  return -1;
}

/** The words of `snippet` a rule matches. */
function marksOf(snippet: string, rules: readonly Rule[]): [number, number][] {
  const out: [number, number][] = [];
  if (rules.length === 0) return out;
  RAW_WORD.lastIndex = 0;
  for (let m = RAW_WORD.exec(snippet); m !== null; m = RAW_WORD.exec(snippet)) {
    const w = folded(m[0]);
    if (rules.some((r) => r(w))) out.push([m.index, m.index + m[0].length]);
    if (out.length === NOTE_SNIPPET_MARKS_MAX) break;
  }
  return out;
}

/** `text` cut to the snippet length at a space, "…" where cut. */
function clip(text: string, start: number, before = false, after = false): string {
  let end = Math.min(text.length, start + NOTE_SNIPPET_MAX);
  if (end < text.length) {
    const cut = text.slice(start, end).search(/\s\S*$/);
    if (cut > NOTE_SNIPPET_MAX / 2) end = start + cut;
  }
  const body = text.slice(start, end).replace(/\s+/g, " ").trim();
  return `${start > 0 || before ? "…" : ""}${body}${end < text.length || after ? "…" : ""}`;
}

/**
 * FR-NOTES-22 snippet of a body for the query `words` (`queryWords(q)`), links shown as their
 * chips read (`chipText`): up to 140 characters from a little before the first word a query word
 * (≥ 3 letters, either plural form) starts, those words marked; when none does (a title match),
 * the body's first non-blank line, plain. Whitespace runs collapse; cuts fall on spaces, with "…".
 */
export function noteSnippet(
  body: string,
  words: readonly string[],
): { snippet: string; marks: [number, number][] } {
  const full = chipText(body);
  const rules = bodyRule(words);
  const hit = rules.length > 0 ? firstHit(full, rules) : -1;
  if (hit === -1) {
    const line = full.split("\n").find((l) => stripMarks(l).trim() !== "") ?? "";
    return { snippet: clip(stripMarks(line), 0), marks: [] };
  }
  // Markers stripped in a window around the hit only (a body can be 32 KiB, 50 hits a search);
  // line starts inside it lose their heading and list markers too.
  const from = Math.max(0, hit - WINDOW);
  const to = Math.min(full.length, hit + NOTE_SNIPPET_MAX + WINDOW);
  const text = stripMarks(full.slice(from, to));
  const at = Math.max(0, firstHit(text, rules));
  let start = Math.max(0, at - NOTE_SNIPPET_LEAD);
  if (start > 0) {
    const space = text.slice(start, at).search(/\s/);
    start = space === -1 ? at : start + space + 1;
  }
  const snippet = clip(text, start, from > 0, to < full.length);
  return { snippet, marks: marksOf(snippet, rules) };
}
