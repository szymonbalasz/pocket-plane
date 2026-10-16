// FR-CMP-04 version, FR-CMP-05 adapter over the bundled source (no network).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { srdMini } from "@fixtures/srd/open5e";
import { EntryDraft } from "@shared/compendium/schemas";
import { CreatureSenses } from "@shared/compendium/senses";
import { MonsterStatBlock } from "@shared/entities/schemas";
import { loadSrd51 } from "../sources/srd-5.1";
import { ADAPTER_VERSION, type AdapterRecord, type AdapterResult, adaptOpen5e } from "./open5e";
import { toMarkdownLite } from "./text";
import { sourceVersion } from "./version";

const realFetch = globalThis.fetch;
let result: AdapterResult;
let adaptMs = 0;

beforeAll(() => {
  globalThis.fetch = (() => {
    throw new Error("No network in tests (FR-CMP-06)");
  }) as unknown as typeof fetch;
  const bundled = loadSrd51();
  const t0 = performance.now();
  result = adaptOpen5e(bundled.responses);
  adaptMs = performance.now() - t0;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

const rec = (key: string) => result.records.find((r) => r.sourceKey === key);
const monsterDef = (key: string) => {
  const r = rec(key);
  if (r?.kind !== "monster") throw new Error(`${key} is not a monster record`);
  return r.definition;
};

describe("FR-CMP-05 adapter", () => {
  test("bundled source: every record maps; counts per kind", () => {
    console.log(`FR-CMP-05 adapter: ${result.records.length} records in ${adaptMs.toFixed(0)} ms`);
    expect(result.skipped).toBe(0);
    expect(result.counts).toEqual({
      monster: 322,
      spell: 319,
      item: 237 + 37 + 18,
      condition: 15,
      feature: 202,
    });
    for (const r of result.records) expect(EntryDraft.safeParse(r.data).success).toBe(true);
    expect(new Set(result.records.map((r) => r.sourceKey)).size).toBe(result.records.length);
  });

  test("322 / 322 SRD monsters map to the creature core", () => {
    const monsters = result.records.filter(
      (r): r is Extract<AdapterRecord, { kind: "monster" }> => r.kind === "monster",
    );
    expect(monsters).toHaveLength(322);
    for (const m of monsters) {
      const { senses, ...core } = m.definition.statBlock;
      expect(MonsterStatBlock.safeParse(core).success).toBe(true);
      if (senses) expect(CreatureSenses.safeParse(senses).success).toBe(true);
      expect(m.definition.name).toBe(m.data.name);
    }
  });

  test("goblin: creature core, reference text, senses.darkvisionFt", () => {
    const goblin = monsterDef("monster/goblin");
    expect(goblin.statBlock).toEqual({
      size: "small",
      ac: 15,
      hpMax: 7,
      hpFormula: "2d6",
      initBonus: 2,
      speed: 30,
      abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
      attacks: [
        { name: "Scimitar", toHit: 4, damage: "1d6+2", damageType: "slashing" },
        { name: "Shortbow", toHit: 4, damage: "1d6+2", damageType: "piercing" },
      ],
      cr: "1/4",
      senses: { visionFt: 0, darkvisionFt: 60, seesMagicalDarkness: false },
    });
    const entry = rec("monster/goblin")?.data;
    expect(entry?.kind === "monster" && entry.body.traits.map((t) => t.name)).toEqual([
      "Nimble Escape",
    ]);
    expect(entry?.kind === "monster" && entry.body.meta.senses).toBe(
      "darkvision 60 ft., passive Perception 9",
    );
  });

  test("darkvision: Goblin 60, Ogre 60, Wolf absent; see-through false", () => {
    expect(monsterDef("monster/goblin").statBlock.senses?.darkvisionFt).toBe(60);
    expect(monsterDef("monster/ogre").statBlock.senses?.darkvisionFt).toBe(60);
    expect(monsterDef("monster/ogre").statBlock.senses?.seesMagicalDarkness).toBe(false);
    expect(monsterDef("monster/wolf").statBlock.senses).toBeUndefined();
  });

  test("HP formula with the CON constant; saves; legendary", () => {
    const ogre = monsterDef("monster/ogre").statBlock;
    expect(ogre.hpFormula).toBe("7d10+21");
    const dragon = monsterDef("monster/adult-red-dragon").statBlock;
    expect(dragon.saveProficiencies).toEqual(["dex", "con", "wis", "cha"]);
    const entry = rec("monster/adult-red-dragon")?.data;
    expect(entry?.kind === "monster" && entry.body.legendary?.actions.length).toBe(3);
  });

  test("features split at headings; level parsed (Sneak Attack 1, Rage 1)", () => {
    expect(rec("feature/rogue/sneak-attack")?.data.facets).toEqual({
      className: "Rogue",
      level: 1,
    });
    expect(rec("feature/barbarian/rage")?.data.facets).toEqual({
      className: "Barbarian",
      level: 1,
    });
    expect(rec("feature/barbarian/reckless-attack")?.data.facets).toMatchObject({ level: 2 });
    expect(rec("feature/barbarian/frenzy")?.data.facets).toEqual({
      className: "Barbarian",
      subclass: "Path of the Berserker",
      level: 3,
    });
    expect(rec("feature/barbarian/path-of-the-berserker")?.data.facets).toEqual({
      className: "Barbarian",
      subclass: "Path of the Berserker",
    });
    // Warlock's second "Eldritch Invocations" heading (the list) joins the first.
    const inv = rec("feature/warlock/eldritch-invocations")?.data.body as { text: string };
    expect(inv.text).toContain("**Agonizing Blast**");
  });

  test("spells and items", () => {
    expect(rec("spell/fireball")?.data.facets).toEqual({
      level: 3,
      school: "evocation",
      classes: ["Sorcerer", "Wizard"],
      concentration: false,
      ritual: false,
    });
    expect(rec("item/longsword")?.data.body).toEqual({
      typeLine: "Martial melee weapon",
      cost: "15 gp",
      weight: "3 lb.",
      damage: "1d8 slashing",
      properties: "versatile (1d10)",
      text: "",
    });
    expect(rec("item/chain-mail")?.data.body).toMatchObject({ typeLine: "Heavy armor", ac: "16" });
    expect(rec("item/bag-of-holding")?.data.facets).toEqual({
      category: "magic",
      rarity: "uncommon",
      attunement: false,
    });
  });

  test("non-SRD records and archetypes dropped (defence in depth)", () => {
    const r = adaptOpen5e({
      monsters: [{ slug: "x", name: "X", document__slug: "tob" }],
      classes: [
        {
          slug: "rogue",
          name: "Rogue",
          desc: "### Sneak Attack \n \nBeginning at 1st level, you strike.",
          table: "",
          document__slug: "wotc-srd",
          archetypes: [
            {
              slug: "thief",
              name: "Thief",
              desc: "##### Fast Hands\n\nAt 3rd level…",
              document__slug: "wotc-srd",
            },
            {
              slug: "soulspy",
              name: "Soulspy",
              desc: "##### Spy\n\nAt 3rd level…",
              document__slug: "toh",
            },
          ],
        },
      ],
    });
    expect(r.skipped).toBe(2);
    expect(r.records.map((x) => x.sourceKey)).toEqual([
      "feature/rogue/sneak-attack",
      "feature/rogue/fast-hands",
    ]);
  });

  test("a field that doesn't fit is dropped with a warning; the record stays", () => {
    const goblin = loadSrd51().responses.monsters?.find(
      (m) => (m as { slug: string }).slug === "goblin",
    ) as Record<string, unknown>;
    const r = adaptOpen5e({
      monsters: [
        {
          ...goblin,
          hit_dice: "2d7",
          senses: "darkvision 300 ft.",
          languages: "x".repeat(201),
          actions: [
            {
              name: "Claw",
              desc: "Hit: 5 (1d6+1d4) fire damage.",
              attack_bonus: 4,
              damage_dice: "1d6+1d4",
            },
            { name: "Bad", desc: "Hit: 1.", attack_bonus: 99, damage_dice: "1d6" },
          ],
        },
      ],
    });
    expect(r.records).toHaveLength(1);
    const def = r.records[0]?.kind === "monster" ? r.records[0].definition.statBlock : null;
    expect(def?.hpFormula).toBeUndefined();
    expect(def?.senses).toBeUndefined();
    expect(def?.attacks).toEqual([{ name: "Claw", toHit: 4, damage: "1d6", damageType: "fire" }]);
    expect(r.warnings.map((w) => w.field).sort()).toEqual([
      "attacks[0]",
      "attacks[1]",
      "body.meta.languages",
      "statBlock.hpFormula",
      "statBlock.senses",
    ]);
  });

  test("text → markdown-lite", () => {
    expect(
      toMarkdownLite("**_Colossus Slayer._** Tenacity. \n \n* one\n* two\n\n\n#### Cantrips"),
    ).toBe("**Colossus Slayer.** Tenacity.\n\n- one\n- two\n\n**Cantrips**");
  });
});

describe("FR-CMP-04 version", () => {
  const files = [
    { name: "monsters.json", text: "[]\n" },
    { name: "ATTRIBUTION.md", text: "SRD\n" },
  ];

  test("SHA-256 over files + ADAPTER_VERSION; ADAPTER_VERSION alone changes it", () => {
    const v = sourceVersion(files);
    expect(v).toMatch(/^[0-9a-f]{64}$/);
    expect(sourceVersion([...files].reverse())).toBe(v);
    expect(sourceVersion(files, ADAPTER_VERSION)).toBe(v);
    expect(sourceVersion(files, `${ADAPTER_VERSION}+1`)).not.toBe(v);
    expect(sourceVersion([{ ...files[0]!, text: "[1]\n" }, files[1]!])).not.toBe(v);
  });

  test("CRLF checkout hashes the same; bundled version is the files' hash", () => {
    const crlf = files.map((f) => ({ ...f, text: f.text.replace(/\n/g, "\r\n") }));
    expect(sourceVersion(crlf)).toBe(sourceVersion(files));
    const b = loadSrd51();
    expect(b.version).toBe(sourceVersion(b.files));
    expect(b.files.map((f) => f.name)).toContain("ATTRIBUTION.md");
  });
});

describe("FR-CMP-05 adapter: mini fixture set", () => {
  test("fixtures/srd/open5e maps; only the dragon's Bite fire rider warns", () => {
    const r = adaptOpen5e(srdMini);
    expect(r.warnings.map((w) => `${w.sourceKey} ${w.field}`)).toEqual([
      "monster/adult-red-dragon attacks[1]",
    ]);
    expect(r.counts).toMatchObject({ monster: 5, spell: 4, item: 4, condition: 3 });
    expect(r.records.map((x) => x.sourceKey)).toContain("feature/rogue/sneak-attack");
    expect(r.records.map((x) => x.sourceKey)).toContain("spell/hunters-mark");
  });
});
