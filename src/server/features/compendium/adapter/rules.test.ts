// Sprint 9 rules (CMP §13.3 unit): the recorder filter (FR-CMP-60), the card split (FR-CMP-61)
// and every page key against the bundled source (FR-CMP-64). Pure: recorded files only.
import { describe, expect, test } from "bun:test";
import { RULE_PAGES, RULE_SECTION_SLUGS } from "@shared/compendium/rules-pages";
import { loadSrd51 } from "../sources/srd-5.1";
import { recordFilter } from "../sources/srd-5.1/record";
import { adaptOpen5e } from "./open5e";
import { ruleCards } from "./rules";

const rec = (slug: string, extra: Record<string, unknown> = {}) => ({
  slug,
  name: slug,
  desc: "x",
  document__slug: "wotc-srd",
  ...extra,
});

describe("FR-CMP-60 recorder filter", () => {
  test("FR-CMP-60 recorder filter: sections keep only the pages' sections + RULES_EXTRA (wotc-srd), sorted; races, backgrounds, feats, legal text, conditions out; other endpoints unfiltered by section", () => {
    const records = [
      rec("races"),
      rec("cover"),
      rec("backgrounds"),
      rec("feats"),
      rec("legal-information"),
      rec("conditions"),
      rec("between-adventures"),
      rec("attacking", { document__slug: "tob" }),
      rec("actions-in-combat"),
    ];
    expect(recordFilter("sections", records).map((r) => r.slug)).toEqual([
      "actions-in-combat",
      "between-adventures",
      "cover",
    ]);
    expect(recordFilter("conditions", [rec("races"), rec("prone")]).map((r) => r.slug)).toEqual([
      "prone",
      "races",
    ]);
    // The adapter skips an unlisted section too (defence in depth).
    const r = adaptOpen5e({ sections: [{ ...rec("races"), desc: "## Dwarf\nStout." }] });
    expect(r.records).toEqual([]);
    expect(r.skipped).toBe(1);
  });
});

describe("FR-CMP-61 cards", () => {
  test("FR-CMP-61 cards: split at ## and ###; intro card named after the section; deeper headings stay inside; a repeated name gets (‹parent heading›); a heading without text is no card; wording kept", () => {
    const raw = [
      "Intro words.",
      "",
      "## Melee",
      "",
      "Melee words.",
      "",
      "### Attack Rolls and Damage",
      "",
      "Melee damage words.",
      "",
      "#### Deep heading",
      "",
      "Deep words stay.",
      "",
      "## Ranged",
      "",
      "### Attack Rolls and Damage",
      "",
      "Ranged damage words---with a dash.",
      "",
      "## Empty",
      "",
      "### After empty",
      "",
      "Words.",
    ].join("\n");
    const cards = ruleCards("Fighting", raw);
    // "Ranged" and "Empty" have only subheadings: no text of their own, no card.
    expect(cards.map((c) => c.name)).toEqual([
      "Fighting",
      "Melee",
      "Attack Rolls and Damage (Melee)",
      "Attack Rolls and Damage (Ranged)",
      "After empty",
    ]);
    expect(cards.map((c) => c.slug)).toEqual([
      "fighting",
      "melee",
      "attack-rolls-and-damage-melee",
      "attack-rolls-and-damage-ranged",
      "after-empty",
    ]);
    expect(cards[0]?.text).toBe("Intro words.");
    expect(cards[2]?.text).toBe("Melee damage words.\n\n**Deep heading**\n\nDeep words stay.");
    expect(cards[3]?.text).toBe("Ranged damage words—with a dash.");
  });

  test("FR-CMP-61 cards: the bundled 21 sections → 160 cards (161 headings, one without text), unique keys, each ≤ 8,000 chars, `line` = ‹section› · ‹chapter›; words verbatim", () => {
    const { responses } = loadSrd51();
    const t0 = performance.now();
    const r = adaptOpen5e({ sections: responses.sections });
    const rules = r.records.filter((x) => x.kind === "rule");
    expect(r.warnings).toEqual([]);
    expect(rules).toHaveLength(160);
    expect(new Set(rules.map((x) => x.sourceKey)).size).toBe(160);
    const longest = Math.max(...rules.map((x) => (x.data.body as { text: string }).text.length));
    expect(longest).toBeLessThan(8_000);
    console.log(
      `FR-CMP-61: ${rules.length} cards, longest ${longest} chars, ${(performance.now() - t0).toFixed(0)} ms`,
    );
    const cover = rules.find((x) => x.sourceKey === "rule/cover/cover");
    expect(cover?.data).toMatchObject({
      kind: "rule",
      name: "Cover",
      facets: { chapter: "Combat", section: "Cover", order: 0 },
    });
    // Verbatim: every word of the recorded Cover section is in its card.
    const raw = (responses.sections as { slug: string; desc: string }[]).find(
      (s) => s.slug === "cover",
    )?.desc;
    const words = (s: string) => s.toLowerCase().match(/[a-z0-9']+/g) ?? [];
    const coverText = (cover?.data.body as { text: string } | undefined)?.text ?? "";
    expect(words(coverText)).toEqual(words(raw ?? ""));
    const sections = new Set(rules.map((x) => (x.data.facets as { section: string }).section));
    expect(sections.size).toBe(RULE_SECTION_SLUGS.length);
  });
});

describe("FR-CMP-64 page keys", () => {
  test("FR-CMP-64 every page key resolves against the bundled source (rule cards + the 15 conditions)", () => {
    const { responses } = loadSrd51();
    const keys = new Set(adaptOpen5e(responses).records.map((x) => x.sourceKey));
    const missing = RULE_PAGES.flatMap((p) =>
      p.items.filter((k) => !keys.has(k)).map((k) => `${p.id}: ${k}`),
    );
    expect(missing).toEqual([]);
    console.log(
      `FR-CMP-64: ${RULE_PAGES.map((p) => `${p.title} ${p.items.length}`).join(", ")} cards`,
    );
  });
});
