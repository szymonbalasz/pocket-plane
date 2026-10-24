// Markdown-lite (FR-CMP-26): paragraphs, `**bold**`, `*italic*`, `- ` lists, pipe tables, `> `
// quotes. Pure parse into blocks of inline runs; the renderer (`MarkdownLite.tsx`) outputs text
// nodes only, never HTML. Open5e's link markup reads as its words (BL-102): `srd:<slug>` is a
// run with `ref` (the window may link it to that card), `[label](url)` is its label. Anything
// else stays literal text.

export interface Run {
  text: string;
  bold?: true;
  italic?: true;
  /** An Open5e `srd:<slug>` reference (e.g. `prone`); `text` is its words. */
  ref?: string;
}

export type Block =
  | { type: "p"; lines: Run[][] }
  | { type: "ul"; items: Run[][] }
  | { type: "table"; head: Run[][] | null; rows: Run[][][] }
  | { type: "quote"; blocks: Block[] };

/** Markers hug their text (`* b *` is not italic), so multiplication and stray stars stay text. */
const INLINE = /\*\*(\S(?:[^*\n]*?\S)?)\*\*|\*(\S(?:[^*\n]*?\S)?)\*/g;

/** `[label](target)`: the label stays, the target never renders (BL-102). */
const LINK = /\[([^\]\n]+)\]\(([^()\s]*(?:\([^()\s]*\)[^()\s]*)*)\)/g;
/** Open5e's `srd:prone` / `srd:difficult-terrain` references (BL-102). */
const REF = /\bsrd:([a-z0-9]+(?:-[a-z0-9]+)*)/g;

/** A run split at its `srd:` references; each one a run of its words with `ref`. */
function refRuns(run: Run): Run[] {
  const out: Run[] = [];
  let at = 0;
  for (const m of run.text.matchAll(REF)) {
    const i = m.index ?? 0;
    if (i > at) out.push({ ...run, text: run.text.slice(at, i) });
    const slug = m[1] as string;
    out.push({ ...run, text: slug.replaceAll("-", " "), ref: slug });
    at = i + m[0].length;
  }
  if (at === 0) return [run];
  if (at < run.text.length) out.push({ ...run, text: run.text.slice(at) });
  return out;
}

/** `**bold**` and `*italic*` runs (unmatched markers stay text), links as words. */
export function parseInline(src: string): Run[] {
  const text = src.replace(LINK, "$1");
  const out: Run[] = [];
  let at = 0;
  for (const m of text.matchAll(INLINE)) {
    const i = m.index ?? 0;
    if (i > at) out.push({ text: text.slice(at, i) });
    if (m[1] !== undefined) out.push({ text: m[1], bold: true });
    else out.push({ text: m[2] as string, italic: true });
    at = i + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out.flatMap(refRuns);
}

const LIST = /^-\s+/;
const QUOTE = /^>\s?/;
const isRow = (l: string) => l.startsWith("|");
const isSeparator = (l: string) => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);

function cells(line: string): Run[][] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => parseInline(c.trim()));
}

/** The next non-blank line after `i` (trimmed), or "". */
function nextFilled(lines: readonly string[], i: number): string {
  for (let k = i + 1; k < lines.length; k++) {
    const l = (lines[k] as string).trim();
    if (l !== "") return l;
  }
  return "";
}

/** Blocks of a markdown-lite string (blank lines separate paragraphs). */
export function parseMarkdownLite(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = (lines[i] as string).trim();
    if (line === "") {
      i++;
      continue;
    }
    if (isRow(line)) {
      const raw: string[] = [];
      while (i < lines.length && isRow((lines[i] as string).trim())) {
        raw.push((lines[i] as string).trim());
        i++;
      }
      const sep = raw.length > 1 && isSeparator(raw[1] as string);
      const body = raw.filter((r, k) => !(sep && k === 1) && !isSeparator(r));
      blocks.push({
        type: "table",
        head: sep ? cells(raw[0] as string) : null,
        rows: (sep ? body.slice(1) : body).map(cells),
      });
      continue;
    }
    if (QUOTE.test(line)) {
      // One quote across blank lines (Open5e quotes each paragraph: `> a` `` `> b`).
      const inner: string[] = [];
      while (i < lines.length) {
        const l = (lines[i] as string).trim();
        if (QUOTE.test(l)) inner.push(l.replace(QUOTE, ""));
        else if (l === "" && QUOTE.test(nextFilled(lines, i))) inner.push("");
        else break;
        i++;
      }
      blocks.push({ type: "quote", blocks: parseMarkdownLite(inner.join("\n")) });
      continue;
    }
    if (LIST.test(line)) {
      const items: Run[][] = [];
      while (i < lines.length && LIST.test((lines[i] as string).trim())) {
        items.push(parseInline((lines[i] as string).trim().replace(LIST, "")));
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }
    const para: Run[][] = [];
    while (i < lines.length) {
      const l = (lines[i] as string).trim();
      if (l === "" || isRow(l) || LIST.test(l) || QUOTE.test(l)) break;
      para.push(parseInline(l));
      i++;
    }
    blocks.push({ type: "p", lines: para });
  }
  return blocks;
}

/** Plain text of runs (labels, tests). */
export const runsText = (runs: readonly Run[]) => runs.map((r) => r.text).join("");
