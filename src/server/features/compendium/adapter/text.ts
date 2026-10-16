// Open5e text → markdown-lite (FR-CMP-26): paragraphs, **bold**, *italic*, `- ` lists, pipe
// tables. Headings become bold paragraphs; Open5e's ` \n \n` spacing collapses. Pure.

export function toMarkdownLite(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) =>
      l
        .trim()
        .replace(/^#{1,6}\s+(.+)$/, "**$1**")
        .replace(/^[*•]\s+/, "- ")
        .replace(/\*\*_(.+?)_\*\*/g, "**$1**")
        .replace(/\*\*\*(.+?)\*\*\*/g, "**$1**")
        .replace(/(^|[\s(])_([^_\n]+?)_(?=[\s.,;:)!?]|$)/g, "$1*$2*"),
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** `Hunter's Prey` → `hunters-prey`. */
export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export interface Section {
  heading: string;
  text: string;
}

/** Split at headings of exactly `level` `#`s; deeper headings stay in their section's text. */
export function splitSections(raw: string, level: number): { intro: string; sections: Section[] } {
  const re = new RegExp(`^#{${level}}(?!#)\\s*(.+?)\\s*$`, "gm");
  const text = raw.replace(/\r\n?/g, "\n");
  const marks = [...text.matchAll(re)];
  const intro = text.slice(0, marks[0]?.index ?? text.length);
  const sections = marks.map((m, i) => {
    const start = (m.index ?? 0) + m[0].length;
    const end = marks[i + 1]?.index ?? text.length;
    return { heading: (m[1] ?? "").trim(), text: text.slice(start, end) };
  });
  return { intro, sections };
}
