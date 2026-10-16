// FR-CMP-01 kind schemas and limits; FR-CMP-29 featureKey; derived line.
import { describe, expect, test } from "bun:test";
import {
  CompendiumEntry,
  ENTRY_MAX_BYTES,
  EntryDraft,
  entryLine,
  featureKey,
  isReadOnlyEntry,
} from "./schemas";

const spell = {
  kind: "spell",
  name: "Fireball",
  facets: {
    level: 3,
    school: "evocation",
    classes: ["Wizard"],
    concentration: false,
    ritual: false,
  },
  body: {
    castingTime: "1 action",
    range: "150 feet",
    components: "V, S, M",
    duration: "Instantaneous",
    text: "Boom.",
  },
};
const feature = {
  kind: "feature",
  name: "Sneak Attack",
  facets: { className: "Rogue", level: 1 },
  body: { text: "Once per turn…" },
};
const monster = {
  kind: "monster",
  name: "Goblin",
  facets: { cr: "1/4", type: "humanoid", size: "small" },
  body: {
    meta: { senses: "darkvision 60 ft." },
    traits: [{ name: "Nimble Escape", text: "Disengage or Hide." }],
    actions: [],
    bonusActions: [],
    reactions: [],
  },
};

describe("FR-CMP-01 kind schemas", () => {
  test("each kind parses; strict keys", () => {
    for (const e of [spell, feature, monster]) expect(EntryDraft.safeParse(e).success).toBe(true);
    expect(
      EntryDraft.safeParse({
        kind: "condition",
        name: "Prone",
        facets: {},
        body: { text: "- Crawl." },
      }).success,
    ).toBe(true);
    expect(
      EntryDraft.safeParse({
        kind: "item",
        name: "Bag of Holding",
        facets: { category: "magic", rarity: "uncommon", attunement: false },
        body: { typeLine: "Wondrous item", text: "Big inside." },
      }).success,
    ).toBe(true);
    expect(EntryDraft.safeParse({ ...spell, extra: 1 }).success).toBe(false);
    expect(EntryDraft.safeParse({ ...spell, facets: { ...spell.facets, x: 1 } }).success).toBe(
      false,
    );
    expect(EntryDraft.safeParse({ ...spell, kind: "race" }).success).toBe(false);
  });

  test("limits: spell level 0–9, feature level 1–20, SRD class names, meta ≤ 200, 40 blocks", () => {
    const lvl = (level: number) => ({ ...spell, facets: { ...spell.facets, level } });
    expect(EntryDraft.safeParse(lvl(0)).success).toBe(true);
    expect(EntryDraft.safeParse(lvl(10)).success).toBe(false);
    const fl = (level: number) => ({ ...feature, facets: { className: "Rogue", level } });
    expect(EntryDraft.safeParse(fl(20)).success).toBe(true);
    expect(EntryDraft.safeParse(fl(0)).success).toBe(false);
    expect(EntryDraft.safeParse({ ...feature, facets: { className: "Artificer" } }).success).toBe(
      false,
    );
    const meta = { ...monster, body: { ...monster.body, meta: { senses: "x".repeat(201) } } };
    expect(EntryDraft.safeParse(meta).success).toBe(false);
    const block = { name: "A", text: "b" };
    const many = { ...monster, body: { ...monster.body, traits: Array(41).fill(block) } };
    expect(EntryDraft.safeParse(many).success).toBe(false);
    const long = {
      ...monster,
      body: { ...monster.body, traits: [{ name: "A", text: "x".repeat(4001) }] },
    };
    expect(EntryDraft.safeParse(long).success).toBe(false);
    expect(EntryDraft.safeParse({ ...spell, name: "x".repeat(81) }).success).toBe(false);
  });

  test("entry JSON ≤ 32 KB", () => {
    const big = (n: number) => ({ ...feature, body: { text: "x".repeat(n) } });
    expect(EntryDraft.safeParse(big(20_000)).success).toBe(true);
    const over = {
      ...spell,
      body: { ...spell.body, text: "x".repeat(20_000), higherLevel: "y".repeat(20_000) },
    };
    expect(JSON.stringify(over).length).toBeGreaterThan(ENTRY_MAX_BYTES);
    expect(EntryDraft.safeParse(over).success).toBe(false);
  });

  test("feature: presetKey or preset (opaque), at most one", () => {
    const f = (body: object) => ({ ...feature, body: { text: "t", ...body } });
    expect(EntryDraft.safeParse(f({ presetKey: "sneak-attack" })).success).toBe(true);
    expect(EntryDraft.safeParse(f({ preset: { any: "rule" } })).success).toBe(true);
    expect(EntryDraft.safeParse(f({ presetKey: "sneak-attack", preset: {} })).success).toBe(false);
    expect(EntryDraft.safeParse(f({ presetKey: "Not A Key" })).success).toBe(false);
  });

  test("entry row: facets / body checked per kind; homebrew monster refused", () => {
    const row = {
      id: "e1",
      campaignId: null,
      kind: "spell",
      source: "srd-5.1",
      sourceKey: "spell/fireball",
      name: "Fireball",
      line: "Level 3 evocation",
      facets: spell.facets,
      body: spell.body,
      definitionId: null,
      shared: false,
      derivedFromId: null,
      createdAt: "2026-10-16T00:00:00.000Z",
      updatedAt: "2026-10-16T00:00:00.000Z",
      importedAt: "2026-10-16T00:00:00.000Z",
    };
    expect(CompendiumEntry.safeParse(row).success).toBe(true);
    expect(CompendiumEntry.safeParse({ ...row, body: {} }).success).toBe(false);
    expect(CompendiumEntry.safeParse({ ...row, sourceKey: null }).success).toBe(false);
    const homebrewMonster = {
      ...row,
      kind: "monster",
      source: null,
      sourceKey: null,
      campaignId: "c1",
      facets: monster.facets,
      body: monster.body,
    };
    expect(CompendiumEntry.safeParse(homebrewMonster).success).toBe(false);
    expect(isReadOnlyEntry(row)).toBe(true);
    expect(isReadOnlyEntry({ source: null })).toBe(false);
  });
});

describe("FR-CMP-29 featureKey", () => {
  test("<source>:<sourceKey>; homebrew campaign:<id>", () => {
    expect(
      featureKey({ id: "e1", source: "srd-5.1", sourceKey: "feature/rogue/sneak-attack" }),
    ).toBe("srd-5.1:feature/rogue/sneak-attack");
    expect(featureKey({ id: "e9", source: null, sourceKey: null })).toBe("campaign:e9");
  });
});

describe("CMP §8 derived line", () => {
  test("per kind", () => {
    expect(entryLine(EntryDraft.parse(monster))).toBe("CR 1/4 · Small humanoid");
    expect(entryLine(EntryDraft.parse(spell))).toBe("Level 3 evocation");
    expect(entryLine(EntryDraft.parse({ ...spell, facets: { ...spell.facets, level: 0 } }))).toBe(
      "Evocation cantrip",
    );
    expect(entryLine(EntryDraft.parse(feature))).toBe("Rogue · 1st level");
    expect(
      entryLine(
        EntryDraft.parse({
          kind: "item",
          name: "Bag of Holding",
          facets: { category: "magic", rarity: "uncommon", attunement: false },
          body: { typeLine: "Wondrous item", text: "" },
        }),
      ),
    ).toBe("Uncommon wondrous item");
  });
});
