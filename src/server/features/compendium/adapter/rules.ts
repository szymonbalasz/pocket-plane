// Open5e `sections` → rule cards (FR-CMP-60, -61). Pure. Only the sections the Rules pages use
// plus `RULES_EXTRA` are kept (review-a ruling 19; the recorder filters the same way). Each
// section splits at `##` and `###` headings, one card per heading; the text before the first
// heading is an intro card named after the section; deeper headings stay inside their card.
// Wording verbatim, reformatted to markdown-lite (FR-CMP-26); a heading without text is no card.
import { RULE_SECTION_SLUGS } from "@shared/compendium/rules-pages";
import { NAME_MAX } from "@shared/compendium/schemas";
import { slugify, toMarkdownLite } from "./text";

/** FR-CMP-60: a section the bundled source keeps (the pages' sections + `RULES_EXTRA`). */
export const keepsRuleSection = (slug: string) => RULE_SECTION_SLUGS.includes(slug);

export interface RuleCard {
  /** Heading (trimmed; a name repeated in its section gets " (‹parent heading›)"). */
  name: string;
  /** `slugify(name)`: the card part of `rule/<section-slug>/<card-slug>`. */
  slug: string;
  /** Markdown-lite. */
  text: string;
}

/** Open5e's `---` between words is an em dash (reformatting only; the words stay). */
const dashes = (s: string) => s.replace(/(?<=\S)---(?=\S)/g, "—");

const clipName = (s: string) => (s.length <= NAME_MAX ? s : `${s.slice(0, NAME_MAX - 1)}…`);

/** FR-CMP-61: one section's cards in order. */
export function ruleCards(section: string, raw: string): RuleCard[] {
  const text = raw.replace(/\r\n?/g, "\n");
  const marks = [...text.matchAll(/^(#{2,3})(?!#)\s*(.+?)\s*$/gm)];
  const parts: { heading: string; parent: string; text: string }[] = [];
  const intro = text.slice(0, marks[0]?.index ?? text.length);
  parts.push({ heading: section, parent: section, text: intro });
  let h2 = section;
  marks.forEach((m, i) => {
    const heading = (m[2] ?? "").trim();
    if (m[1] === "##") h2 = heading;
    const start = (m.index ?? 0) + m[0].length;
    const end = marks[i + 1]?.index ?? text.length;
    parts.push({ heading, parent: m[1] === "##" ? section : h2, text: text.slice(start, end) });
  });
  const seen = new Map<string, number>();
  for (const p of parts) seen.set(p.heading, (seen.get(p.heading) ?? 0) + 1);
  const cards: RuleCard[] = [];
  for (const p of parts) {
    const body = dashes(toMarkdownLite(p.text));
    if (body === "") continue;
    const name = clipName(
      (seen.get(p.heading) ?? 0) > 1 && p.parent !== p.heading
        ? `${p.heading} (${p.parent})`
        : p.heading,
    );
    cards.push({ name, slug: slugify(name), text: body });
  }
  return cards;
}
