// Markdown-lite (FR-CMP-26): paragraphs, `**bold**`, `*italic*`, `- ` lists, pipe tables. Pure
// parse into blocks of inline runs; the renderer (`MarkdownLite.tsx`) outputs text nodes only,
// never HTML. Anything else stays literal text.

export interface Run {
  text: string;
  bold?: true;
  italic?: true;
}

export type Block =
  | { type: "p"; lines: Run[][] }
  | { type: "ul"; items: Run[][] }
  | { type: "table"; head: Run[][] | null; rows: Run[][][] };

/** Markers hug their text (`* b *` is not italic), so multiplication and stray stars stay text. */
const INLINE = /\*\*(\S(?:[^*\n]*?\S)?)\*\*|\*(\S(?:[^*\n]*?\S)?)\*/g;

/** `**bold**` and `*italic*` runs; unmatched markers stay text. */
export function parseInline(text: string): Run[] {
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
  return out;
}

const LIST = /^-\s+/;
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
      if (l === "" || isRow(l) || LIST.test(l)) break;
      para.push(parseInline(l));
      i++;
    }
    blocks.push({ type: "p", lines: para });
  }
  return blocks;
}

/** Plain text of runs (labels, tests). */
export const runsText = (runs: readonly Run[]) => runs.map((r) => r.text).join("");
