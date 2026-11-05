// Note links (FR-NOTES-07, ADR-0078 "Links"): stored text has one link form, `[[Title]]` or
// `[[Title|label]]`. `@` is only an editor gesture that inserts one, so `@Duke` is plain text.
// Pure; the server keeps `note_link` rows from it, the editor draws chips from it.
import { isNoteTitle, titleFold } from "./titles";

export interface NoteLink {
  /** Offsets of the whole `[[…]]` in the text. */
  from: number;
  to: number;
  /** The title as written (trimmed). */
  target: string;
  /** The shown label (`[[Title|label]]`), or null. */
  label: string | null;
  /** `titleFold(target)`: the live note it points to has this folded title. */
  fold: string;
}

/** `[[` target (no `[`, `]`, `|`, line break), optional `|label` (no `[`, `]`, `|`, line break), `]]`. */
const LINK = /\[\[([^[\]|\r\n]+)(?:\|([^[\]|\r\n]*))?\]\]/g;

/**
 * FR-NOTES-07: every well-formed link, in order. A target that isn't a valid title (empty,
 * over 100 characters) stays plain text; so do unclosed, nested or line-broken brackets.
 */
export function parseLinks(text: string): NoteLink[] {
  const out: NoteLink[] = [];
  for (const m of text.matchAll(LINK)) {
    const target = (m[1] ?? "").trim();
    if (!isNoteTitle(target)) continue;
    const label = (m[2] ?? "").trim();
    const from = m.index ?? 0;
    out.push({
      from,
      to: from + m[0].length,
      target,
      label: m[2] === undefined || label === "" ? null : label,
      fold: titleFold(target),
    });
  }
  return out;
}

/** The distinct folded targets of a text (`note_link` rows), sorted. */
export function linkFolds(text: string): string[] {
  return [...new Set(parseLinks(text).map((l) => l.fold))].sort();
}

/** `[[Title]]`, what the picker inserts (FR-NOTES-08). */
export const linkText = (title: string): string => `[[${title}]]`;
