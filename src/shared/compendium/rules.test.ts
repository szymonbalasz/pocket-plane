// Sprint 9 rules (CMP §13.3 unit): the `rule` kind (FR-CMP-59), the pages' section list
// (FR-CMP-60, -64) and the pins parse (FR-CMP-66). Pure.
import { describe, expect, test } from "bun:test";
import { SearchQuery } from "./rest";
import { parsePins } from "./rules";
import {
  HOUSE_PAGE_ID,
  PINNED_PAGE_ID,
  RULE_PAGE_TABS,
  RULE_PAGES,
  RULE_SECTION_SLUGS,
  RULES_EXTRA,
  RULES_PINS_MAX,
  RULES_SECTIONS,
  rulesPinsKey,
} from "./rules-pages";
import {
  COMPENDIUM_KINDS,
  CompendiumEntry,
  ENTRY_TEXT_MAX,
  EntryDraft,
  entryLine,
  SourceKey,
} from "./schemas";

const card = (facets: Record<string, unknown>, text = "Half cover: +2 to AC.") => ({
  kind: "rule",
  name: "Cover",
  facets,
  body: { text },
});

describe("FR-CMP-59 rule kind", () => {
  test("FR-CMP-59 rule kind schema: kind registered; facets chapter ≤ 40, section ≤ 60, order int (strict); body text; sourceKey rule/<section>/<card>; line ‹section› · ‹chapter›; entry ≤ 32 KB", () => {
    expect(COMPENDIUM_KINDS).toContain("rule");
    const ok = card({ chapter: "Combat", section: "Cover", order: 0 });
    const d = EntryDraft.parse(ok);
    expect(entryLine(d)).toBe("Cover · Combat");
    expect(
      entryLine(EntryDraft.parse(card({ chapter: "House rules", section: "", order: 0 }))),
    ).toBe("House rules");
    for (const bad of [
      { chapter: "x".repeat(41), section: "Cover", order: 0 },
      { chapter: "Combat", section: "x".repeat(61), order: 0 },
      { chapter: "Combat", section: "Cover", order: 1.5 },
      { chapter: "", section: "Cover", order: 0 },
      { chapter: "Combat", section: "Cover", order: 0, extra: 1 },
    ]) {
      expect(EntryDraft.safeParse(card(bad)).success).toBe(false);
    }
    expect(EntryDraft.safeParse({ ...ok, body: { text: "x", more: 1 } }).success).toBe(false);
    // ENTRY_TEXT_MAX < 32 KB: the entry cap is the real bound (FR-CMP-01).
    const big = card({ chapter: "Combat", section: "Cover", order: 0 }, "é".repeat(ENTRY_TEXT_MAX));
    expect(EntryDraft.safeParse(big).success).toBe(false);
    expect(SourceKey.safeParse("rule/cover/cover").success).toBe(true);
    expect(SourceKey.safeParse("rule/Cover").success).toBe(false);
    const row = {
      id: "e1",
      campaignId: null,
      kind: "rule",
      source: "srd-5.1",
      sourceKey: "rule/cover/cover",
      name: "Cover",
      line: "Cover · Combat",
      facets: { chapter: "Combat", section: "Cover", order: 0 },
      body: { text: "Walls, trees, …" },
      definitionId: null,
      shared: false,
      derivedFromId: null,
      imageAssetIds: [],
      createdAt: "t",
      updatedAt: "t",
      importedAt: "t",
    };
    expect(CompendiumEntry.safeParse(row).success).toBe(true);
  });

  test("FR-CMP-62 filters chapter / section on kind rule only (amends FR-CMP-11)", () => {
    expect(SearchQuery.safeParse({ kind: "rule", chapter: "Combat" }).success).toBe(true);
    expect(SearchQuery.safeParse({ kind: "rule", section: "Cover" }).success).toBe(true);
    expect(SearchQuery.safeParse({ kind: "spell", chapter: "Combat" }).success).toBe(false);
    expect(SearchQuery.safeParse({ chapter: "Combat" }).success).toBe(false);
  });
});

describe("FR-CMP-60 FR-CMP-64 pages", () => {
  test("FR-CMP-60 the pages' sections: 20 + RULES_EXTRA [between-adventures]; every section a page draws on is listed and every listed one is used", () => {
    expect(RULES_SECTIONS).toHaveLength(20);
    expect([...RULES_EXTRA]).toEqual(["between-adventures"]);
    expect(RULE_SECTION_SLUGS).toHaveLength(21);
    const used = new Set(
      RULE_PAGES.flatMap((p) => p.items)
        .filter((k) => k.startsWith("rule/"))
        .map((k) => k.split("/")[1]),
    );
    expect([...used].sort()).toEqual([...RULES_SECTIONS].sort());
  });

  test("FR-CMP-64 page list: Combat · Conditions · Checks · Exploration · Spellcasting · Hazards · House rules · Pinned; keys valid and unique per page; Conditions = the 15 conditions", () => {
    expect(RULE_PAGE_TABS.map((t) => t.title)).toEqual([
      "Combat",
      "Conditions",
      "Checks",
      "Exploration",
      "Spellcasting",
      "Hazards",
      "House rules",
      "Pinned",
    ]);
    expect(RULE_PAGE_TABS.map((t) => t.id).slice(-2)).toEqual([HOUSE_PAGE_ID, PINNED_PAGE_ID]);
    for (const p of RULE_PAGES) {
      expect(new Set(p.items).size).toBe(p.items.length);
      for (const k of p.items)
        expect({ k, ok: SourceKey.safeParse(k).success }).toEqual({ k, ok: true });
    }
    const conditions = RULE_PAGES.find((p) => p.id === "conditions")?.items ?? [];
    expect(conditions).toHaveLength(15);
    expect(conditions.every((k) => k.startsWith("condition/"))).toBe(true);
  });
});

describe("FR-CMP-66 pins", () => {
  test("FR-CMP-66 pins parse: ≤ 30 unique ids, first kept; junk dropped; not an array → none; key per campaign", () => {
    expect(parsePins(["a", "b", "a", 3, "", null, "c"])).toEqual(["a", "b", "c"]);
    expect(parsePins({ a: 1 })).toEqual([]);
    expect(parsePins(null)).toEqual([]);
    const many = Array.from({ length: 40 }, (_, i) => `id${i}`);
    expect(parsePins(many)).toEqual(many.slice(0, RULES_PINS_MAX));
    expect(RULES_PINS_MAX).toBe(30);
    expect(rulesPinsKey("camp-1")).toBe("pp.rules.pins.v1.camp-1");
  });
});
