// FR-CMPX-02–11, -13, -23 (adapter side) over `fixtures/5etools-mini` (invented content, FR-CMPX-20).
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FIVE_ETOOLS_MINI_DIR, prepare5etoolsMini } from "@fixtures/5etools-mini/prepare";
import {
  ArtPath,
  EntryDraft,
  isValidArtPath,
  REPLACES_MAX,
  ReplacedRef,
} from "@shared/compendium/schemas";
import { EntityName, MonsterStatBlock } from "@shared/entities/schemas";
import { z } from "zod";
import type { AdapterRecord } from "../open5e";
import {
  ADAPTER_VERSION_5ET,
  adaptBook,
  adaptBookData,
  bookVersion,
  describeBooks,
  FolderError,
  listBooks,
  srdIndexOf,
  tokenPath,
} from ".";
import { type FolderData, readFolder, readFromDir, readLabels } from "./read";
import { entriesToMarkdown, renderTags } from "./text";

const DIR = FIVE_ETOOLS_MINI_DIR;
const read = readFromDir(DIR);
const allExist = () => true;
const tb1 = adaptBook(DIR, "TB1", { exists: allExist });
const tb2 = adaptBook(DIR, "TB2", { exists: allExist });

const rec = (key: string, list: readonly AdapterRecord[] = tb1.records) => {
  const r = list.find((x) => x.sourceKey === key);
  if (!r) throw new Error(`No record ${key}`);
  return r;
};
const monster = (key: string, list?: readonly AdapterRecord[]) => {
  const r = rec(key, list);
  if (r.kind !== "monster") throw new Error(`${key} is not a monster`);
  return r;
};
const spell = (key: string) => {
  const r = rec(key);
  if (r.data.kind !== "spell") throw new Error(`${key} is not a spell`);
  return r.data;
};
const item = (key: string, list?: readonly AdapterRecord[]) => {
  const r = rec(key, list);
  if (r.data.kind !== "item") throw new Error(`${key} is not an item`);
  return r.data;
};
const warningsOf = (key: string) => tb1.warnings.filter((w) => w.sourceKey === key);

const emptyData = (over: Partial<FolderData>): FolderData => ({
  monsters: [],
  monsterTemplates: [],
  legendaryGroups: [],
  spells: [],
  spellClasses: {},
  items: [],
  itemGroups: [],
  baseItems: [],
  itemEntries: [],
  variants: [],
  unreadable: [],
  ...over,
});

describe("FR-CMPX-02 books", () => {
  test("FR-CMPX-02 lists the folder's books with counts, keys and labels", () => {
    const list = listBooks(DIR);
    if (list.state !== "ready") throw new Error("not ready");
    expect(list.books).toEqual([
      {
        key: "5et-tb1",
        abbr: "TB1",
        name: "Test Book One",
        counts: { monster: 7, spell: 3, item: 10 },
      },
      {
        key: "5et-tb2",
        abbr: "TB2",
        name: "Test Book Two",
        counts: { monster: 3, spell: 1, item: 2 },
      },
    ]);
  });

  test("FR-CMPX-02 label from adventures.json, else the abbreviation; clipped to the source name cap", () => {
    const data = emptyData({
      monsters: [
        { name: "A", source: "ADV" },
        { name: "B", source: "XX" },
        { name: "C", source: "LONG" },
      ],
    });
    const names = new Map([
      ["ADV", "An Adventure"],
      ["LONG", "L".repeat(100)],
    ]);
    const books = describeBooks(data, { names, release: "1" });
    expect(books.find((b) => b.abbr === "ADV")?.name).toBe("An Adventure");
    expect(books.find((b) => b.abbr === "XX")?.name).toBe("XX");
    expect(books.find((b) => b.abbr === "LONG")?.name.length).toBe(80);
    expect(books.find((b) => b.abbr === "ADV")?.key).toBe("5et-adv");
  });

  test("FR-CMPX-02 no data/books.json → not-found", () => {
    expect(listBooks(path.join(DIR, "no-such-folder"))).toEqual({
      state: "not-found",
      path: path.join(DIR, "no-such-folder"),
    });
  });

  test("FR-CMPX-02 a malformed file → not-found with issues, no throw", () => {
    const list = listBooks(DIR, {
      readText: (rel) => (rel === "data/items.json" ? "{ nope" : read(rel)),
    });
    expect(list.state).toBe("not-found");
    if (list.state === "not-found")
      expect(list.issues).toEqual(["data/items.json: not valid JSON"]);
  });
});

describe("FR-CMPX-03 version", () => {
  test("FR-CMPX-03 version = SHA-256 of the last changelog ver + the adapter version", () => {
    const list = listBooks(DIR);
    if (list.state !== "ready") throw new Error("not ready");
    expect(list.release).toBe("0.0.1");
    const expected = new Bun.CryptoHasher("sha256")
      .update(`0.0.1\0${ADAPTER_VERSION_5ET}`)
      .digest("hex");
    expect(list.version).toBe(expected);
    expect(bookVersion("0.0.2")).not.toBe(list.version);
  });

  test("FR-CMPX-03 a changelog without a last ver fails the listing", () => {
    expect(() => readLabels((rel) => (rel === "data/changelog.json" ? "[]" : read(rel)))).toThrow(
      FolderError,
    );
  });
});

describe("FR-CMPX-04 reads only what's needed", () => {
  test("FR-CMPX-04 adaptBook reads exactly the listed files", () => {
    const seen: string[] = [];
    adaptBook(DIR, "TB1", {
      exists: allExist,
      readText: (rel) => {
        seen.push(rel);
        return read(rel);
      },
    });
    expect(seen.sort()).toEqual(
      [
        "data/bestiary/index.json",
        "data/bestiary/bestiary-tb1.json",
        "data/bestiary/bestiary-tb2.json",
        "data/bestiary/legendarygroups.json",
        "data/bestiary/template.json",
        "data/spells/index.json",
        "data/spells/spells-tb1.json",
        "data/spells/spells-tb2.json",
        "data/spells/sources.json",
        "data/items.json",
        "data/items-base.json",
        "data/magicvariants.json",
      ].sort(),
    );
  });

  test("FR-CMPX-04 an index can't point outside its folder", () => {
    for (const bad of ["../../secret.json", "a/b.json", "..\\x.json", "x.txt"]) {
      expect(() =>
        adaptBook(DIR, "TB1", {
          exists: allExist,
          readText: (rel) =>
            rel === "data/bestiary/index.json" ? JSON.stringify({ TB1: bad }) : read(rel),
        }),
      ).toThrow(FolderError);
    }
  });

  test("FR-CMPX-04 a malformed file fails the book with issues", () => {
    const run = () =>
      adaptBook(DIR, "TB1", {
        exists: allExist,
        readText: (rel) => (rel === "data/bestiary/bestiary-tb2.json" ? "{" : read(rel)),
      });
    expect(run).toThrow("data/bestiary/bestiary-tb2.json: not valid JSON");
  });

  test("FR-CMPX-04 a nameless row is dropped with a warning naming only its place", () => {
    const r = adaptBook(DIR, "TB2", {
      exists: allExist,
      readText: (rel) =>
        rel === "data/bestiary/bestiary-tb2.json"
          ? JSON.stringify({ monster: [{ source: "TB2" }] })
          : read(rel),
    });
    expect(r.skipped).toBe(1);
    expect(r.warnings).toContainEqual({
      sourceKey: "data/bestiary/bestiary-tb2.json#0",
      field: "",
      message: "Unreadable record",
    });
  });
});

describe("FR-CMPX-05 copies", () => {
  const goblinBase = {
    name: "Base",
    source: "TB1",
    srd: true,
    reprintedAs: ["Other|TB2"],
    page: 3,
    legendaryGroup: { name: "G", source: "TB1" },
    size: ["M"],
    type: "beast",
    ac: [10],
    hp: { average: 5, formula: "1d8 + 1" },
    cr: "1",
    str: 10,
    con: 14,
    save: { dex: "+2" },
    speed: { walk: 30, fly: 60 },
    action: [
      { name: "One", entries: ["base {@hit 2} to hit, {@dc 10} here"] },
      { name: "Two", entries: ["two"] },
    ],
    spellcasting: [
      {
        name: "Spellcasting",
        will: ["a"],
        daily: { "1e": ["b"] },
        spells: { "1": { slots: 2, spells: ["c"] } },
      },
    ],
  };
  const copyOf = (_mod: unknown, extra: object = {}) => ({
    name: "Copy",
    source: "TB1",
    _copy: { name: "Base", source: "TB1", _mod },
    ...extra,
  });
  const resolved = (_mod: unknown, extra: object = {}) => {
    const r = adaptBookData(emptyData({ monsters: [goblinBase, copyOf(_mod, extra)] }), "TB1", {
      exists: allExist,
      srd: new Map(),
    });
    return { r, copy: monster("monster/copy", r.records) };
  };
  const actionNames = (m: AdapterRecord) =>
    m.kind === "monster" ? m.data.body.actions.map((a) => a.name) : [];
  const dataOf = (m: AdapterRecord) => {
    if (m.kind !== "monster") throw new Error("not a monster");
    return m.data;
  };
  const traitText = (m: AdapterRecord, name: string) =>
    dataOf(m).body.traits.find((t) => t.name === name)?.text ?? "";

  test("FR-CMPX-05 replaceArr", () => {
    const { copy } = resolved({
      action: { mode: "replaceArr", replace: "One", items: { name: "New", entries: ["n"] } },
    });
    expect(actionNames(copy)).toEqual(["New", "Two"]);
  });
  test("FR-CMPX-05 appendArr", () => {
    const { copy } = resolved({
      action: { mode: "appendArr", items: { name: "End", entries: ["e"] } },
    });
    expect(actionNames(copy)).toEqual(["One", "Two", "End"]);
  });
  test("FR-CMPX-05 prependArr", () => {
    const { copy } = resolved({
      action: { mode: "prependArr", items: [{ name: "First", entries: ["f"] }] },
    });
    expect(actionNames(copy)).toEqual(["First", "One", "Two"]);
  });
  test("FR-CMPX-05 insertArr", () => {
    const { copy } = resolved({
      action: { mode: "insertArr", index: 1, items: { name: "Mid", entries: ["m"] } },
    });
    expect(actionNames(copy)).toEqual(["One", "Mid", "Two"]);
  });
  test("FR-CMPX-05 removeArr", () => {
    const { copy } = resolved({ action: { mode: "removeArr", names: "One" } });
    expect(actionNames(copy)).toEqual(["Two"]);
  });
  test("FR-CMPX-05 replaceTxt reaches names only when asked, `*` covers every block", () => {
    const { copy } = resolved({
      "*": { mode: "replaceTxt", replace: "base", with: "copied", flags: "i" },
    });
    expect(dataOf(copy).body.actions[0]?.text).toContain("copied");
  });
  test("FR-CMPX-05 setProp, with a dotted path", () => {
    const { copy } = resolved({ _: { mode: "setProp", prop: "speed.walk", value: 50 } });
    if (copy.kind !== "monster") throw new Error("no");
    expect(copy.definition?.statBlock.speed).toBe(50);
  });
  test("FR-CMPX-05 scalarAddProp on numbers and signed strings", () => {
    const { copy } = resolved({
      save: { mode: "scalarAddProp", prop: "dex", scalar: 2 },
      speed: { mode: "scalarAddProp", prop: "*", scalar: 10 },
    });
    if (copy.kind !== "monster") throw new Error("no");
    expect(dataOf(copy).body.meta.savesText).toBe("Dex +4");
    expect(copy.definition?.statBlock.speed).toBe(40);
  });
  test("FR-CMPX-05 scalarMultProp", () => {
    const { copy } = resolved({ speed: { mode: "scalarMultProp", prop: "walk", scalar: 2 } });
    if (copy.kind !== "monster") throw new Error("no");
    expect(copy.definition?.statBlock.speed).toBe(60);
  });
  test("FR-CMPX-05 addSpells merges levels, at-will and daily lists", () => {
    const { copy } = resolved({
      _: {
        mode: "addSpells",
        spells: { "1": { spells: ["d"] }, "2": { slots: 1, spells: ["e"] } },
        will: ["f"],
        daily: { "1e": ["g"] },
      },
    });
    const t = traitText(copy, "Spellcasting");
    expect(t).toContain("At will: a, f");
    expect(t).toContain("1/day each: b, g");
    expect(t).toContain("1st level (2 slots): c, d");
    expect(t).toContain("2nd level (1 slot): e");
  });
  test("FR-CMPX-05 replaceSpells and removeSpells (seen on real copies)", () => {
    const { copy } = resolved({
      _: [
        { mode: "replaceSpells", will: [{ replace: "a", with: "z" }] },
        { mode: "removeSpells", daily: { "1e": ["b"] } },
      ],
    });
    const t = traitText(copy, "Spellcasting");
    expect(t).toContain("At will: z");
    expect(t).not.toContain("1/day");
  });
  test("FR-CMPX-05 addSkills from CR and scores, appendIfNotExistsArr, `remove`", () => {
    const { copy } = resolved({
      _: { mode: "addSkills", skills: { athletics: 1 } },
      action: [
        { mode: "appendIfNotExistsArr", items: { name: "Two", entries: ["two"] } },
        { mode: "appendIfNotExistsArr", items: { name: "Three", entries: ["three"] } },
      ],
      save: "remove",
    });
    expect(dataOf(copy).body.meta.skillsText).toBe("Athletics +2");
    expect(actionNames(copy)).toEqual(["One", "Two", "Three"]);
    expect(dataOf(copy).body.meta.savesText).toBeUndefined();
  });
  test("FR-CMPX-05 scalarAddHit and scalarAddDc change the tags", () => {
    const { copy } = resolved({
      action: [
        { mode: "scalarAddHit", scalar: 1 },
        { mode: "scalarAddDc", scalar: 2 },
      ],
    });
    expect(dataOf(copy).body.actions[0]?.text).toBe("base +3 to hit, DC 12 here");
  });
  test("FR-CMPX-05 a copy keeps what it sets, drops what it nulls, and takes preserved props only on request", () => {
    const { r, copy } = resolved({}, { cr: "3", save: null });
    expect(dataOf(copy).facets.cr).toBe("3");
    expect(dataOf(copy).body.meta.savesText).toBeUndefined();
    // `srd`, `reprintedAs` and `legendaryGroup` need `_preserve`.
    expect(copy.replaces).toBeUndefined();
    expect(r.warnings.filter((w) => w.sourceKey === "monster/copy")).toEqual([]);
  });
  test("FR-CMPX-05 `_preserve` hands them over", () => {
    const r = adaptBookData(
      emptyData({
        monsters: [
          goblinBase,
          {
            name: "Copy",
            source: "TB1",
            _copy: { name: "Base", source: "TB1", _preserve: { srd: true } },
          },
        ],
      }),
      "TB1",
      { exists: allExist, srd: new Map([["monster\0copy", "monster/copy-in-srd"]]) },
    );
    expect(monster("monster/copy", r.records).replaces).toEqual(["srd-5.1:monster/copy-in-srd"]);
  });
  test("FR-CMPX-05 recursively, across books", () => {
    const r = adaptBookData(
      emptyData({
        monsters: [
          { ...goblinBase, source: "TB2" },
          {
            name: "Mid",
            source: "TB2",
            _copy: {
              name: "Base",
              source: "TB2",
              _mod: { action: { mode: "appendArr", items: { name: "Mid", entries: ["m"] } } },
            },
          },
          {
            name: "Copy",
            source: "TB1",
            _copy: {
              name: "Mid",
              source: "TB2",
              _mod: { action: { mode: "appendArr", items: { name: "Top", entries: ["t"] } } },
            },
          },
        ],
      }),
      "TB1",
      { exists: allExist, srd: new Map() },
    );
    expect(actionNames(monster("monster/copy", r.records))).toEqual(["One", "Two", "Mid", "Top"]);
  });
  test("FR-CMPX-05 unknown mode → skipped with a warning", () => {
    const r = adaptBookData(
      emptyData({ monsters: [goblinBase, copyOf({ action: { mode: "transmogrify" } })] }),
      "TB1",
      { exists: allExist, srd: new Map() },
    );
    expect(r.skipped).toBe(1);
    expect(r.records.map((x) => x.sourceKey)).toEqual(["monster/base"]);
    expect(r.warnings).toContainEqual({
      sourceKey: "monster/copy",
      field: "_copy",
      message: 'Unknown _mod mode "transmogrify"',
    });
  });
  test("FR-CMPX-05 missing base or a loop → skipped with a warning", () => {
    const r = adaptBookData(
      emptyData({
        monsters: [
          { name: "Orphan", source: "TB1", _copy: { name: "Nobody", source: "TB1" } },
          { name: "Ping", source: "TB1", _copy: { name: "Pong", source: "TB1" } },
          { name: "Pong", source: "TB1", _copy: { name: "Ping", source: "TB1" } },
        ],
      }),
      "TB1",
      { exists: allExist, srd: new Map() },
    );
    expect(r.records).toEqual([]);
    expect(r.skipped).toBe(3);
    expect(r.warnings.filter((w) => w.field === "_copy").map((w) => w.message)).toEqual([
      "_copy base not found",
      "_copy loop",
      "_copy loop",
    ]);
  });
  test("FR-CMPX-05 a `__proto__` path is refused, nothing polluted", () => {
    const r = adaptBookData(
      emptyData({
        monsters: [
          goblinBase,
          copyOf({ _: { mode: "setProp", prop: "__proto__.polluted", value: true } }),
        ],
      }),
      "TB1",
      { exists: allExist, srd: new Map() },
    );
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(r.skipped).toBe(1);
  });
  test("FR-CMPX-05 `_templates` over the fixture: root, mods, placeholders", () => {
    const m = monster("monster/goblin-cinderborn");
    if (m.kind !== "monster") throw new Error("no");
    // `_root` beats the base; the copy's own props would beat `_root`.
    expect(m.definition?.statBlock.abilities?.int).toBe(5);
    const text = dataOf(m).body.traits.find((t) => t.name === "Ember Blood")?.text;
    // "The goblin cinderborn", DC 8 + PB 2 + Con +1.
    expect(text).toBe(
      "The goblin cinderborn burns from within; a creature touching it makes a DC 11 Constitution save.",
    );
    expect(dataOf(m).body.meta.senses).toContain("blindsight 10 ft.");
  });
  test("FR-CMPX-05 fixture copy: replaceTxt + appendArr, own HP, no srd inherited", () => {
    const m = monster("monster/goblin-sapper");
    if (m.kind !== "monster") throw new Error("no");
    expect(m.definition?.statBlock.hpMax).toBe(13);
    expect(dataOf(m).body.traits[0]?.text).toContain("the sapper ducks");
    expect(actionNames(m)).toEqual(["Hooked Blade", "Whittled Bow", "Satchel Charge"]);
    expect(m.replaces).toBeUndefined();
  });
});

describe("FR-CMPX-06 text", () => {
  test.each([
    ["{@hit 4}", "+4"],
    ["{@hit -1}", "-1"],
    ["{@damage 2d6 + 3}", "2d6 + 3"],
    ["{@dice 1d20}", "1d20"],
    ["{@dc 15}", "DC 15"],
    ["{@atk mw}", "*Melee Weapon Attack:*"],
    ["{@atk rw}", "*Ranged Weapon Attack:*"],
    ["{@atk ms}", "*Melee Spell Attack:*"],
    ["{@atk rs}", "*Ranged Spell Attack:*"],
    ["{@atk mw,rw}", "*Melee or Ranged Weapon Attack:*"],
    ["{@atk ms,rs}", "*Melee or Ranged Spell Attack:*"],
    ["{@h}7 damage", "*Hit:* 7 damage"],
    ["{@recharge 5}", "(Recharge 5–6)"],
    ["{@recharge}", "(Recharge 6)"],
    ["{@condition prone}", "prone"],
    ["{@creature grell}", "grell"],
    ["{@creature grell|TB1}", "grell"],
    ["{@creature grell|TB1|the thing}", "the thing"],
    ["{@creature grell||the thing}", "the thing"],
    ["{@spell glimmer dust|TB1}", "glimmer dust"],
    ["{@item fine hat|TB1|hat}", "hat"],
    ["{@filter hats|items|type=hat}", "hats"],
    ["{@book chapter one|TB1|1}", "chapter one"],
    ["{@quickref cover||3}", "cover"],
    ["{@quickref cover||3||half cover}", "half cover"],
    ["{@link the site|https://example.test}", "the site"],
    ["{@note read {@spell glimmer dust|TB1} first}", "read glimmer dust first"],
    ["{@b bold} and {@i italic}", "bold and italic"],
    ["{@scaledamage 8d6|3-9|1d6}", "1d6"],
    ["{@chance 50}", "50 percent"],
    ["{@chance 25|one in four}", "one in four"],
    ["no tags at all", "no tags at all"],
  ])("FR-CMPX-06 tag %s", (raw, want) => {
    expect(renderTags(raw)).toBe(want);
  });

  const warnings: [string, string][] = [];
  const md = (v: unknown) =>
    entriesToMarkdown(v, (f, m) => {
      warnings.push([f, m]);
    });

  test("FR-CMPX-06 strings → paragraphs; named entries → bold lead", () => {
    expect(md(["One.", { type: "entries", name: "Two", entries: ["Words.", "More."] }])).toBe(
      "One.\n\n**Two.** Words.\n\nMore.",
    );
  });
  test("FR-CMPX-06 list → `- ` items, named items bold", () => {
    expect(
      md({
        type: "list",
        items: [
          "a",
          { type: "item", name: "B", entry: "b {@dc 3}" },
          { type: "list", items: ["c"] },
        ],
      }),
    ).toBe("- a\n- **B.** b DC 3\n- c");
  });
  test("FR-CMPX-06 table → pipe table, roll cells, a pipe in a cell can't split it", () => {
    expect(
      md({
        type: "table",
        caption: "T",
        colLabels: ["d6", "Effect"],
        rows: [
          [{ roll: { min: 1, max: 3 } }, "x | y"],
          [
            { type: "cell", roll: { exact: 4 } },
            { type: "entries", entries: ["z"] },
          ],
        ],
      }),
    ).toBe("**T**\n\n| d6 | Effect |\n| --- | --- |\n| 1–3 | x / y |\n| 4 | z |");
  });
  test("FR-CMPX-06 inset and quote → `> ` quote", () => {
    expect(md({ type: "inset", name: "Lore", entries: ["a", "b"] })).toBe("> **Lore.** a\n\n> b");
    expect(md({ type: "quote", entries: ["said"], by: "Someone" })).toBe("> said\n\n> — Someone");
  });
  test("FR-CMPX-06 anything else → its plain text + a warning; never a path or a link", () => {
    warnings.length = 0;
    expect(
      md({ type: "image", title: "x", href: { type: "internal", path: "secret/path.webp" } }),
    ).toBe("");
    expect(warnings).toEqual([["entries.image", "Unknown block; kept as plain text"]]);
    warnings.length = 0;
    expect(md({ type: "section", name: "S", entries: ["a {@dc 2}"] })).toBe("S a DC 2");
    expect(warnings).toEqual([["entries.section", "Unknown block; kept as plain text"]]);
  });
  test("FR-CMPX-06 HTML stays text; the renderer never makes it markup", () => {
    expect(md(["<script>alert(1)</script>"])).toBe("<script>alert(1)</script>");
  });
  test("FR-CMPX-06 no tag or template marker survives in the fixture books", () => {
    for (const r of [...tb1.records, ...tb2.records]) {
      const s = JSON.stringify(r.data);
      expect(s).not.toContain("{@");
      expect(s).not.toContain("{=");
      expect(s).not.toContain("{#");
      expect(s).not.toContain("<$");
    }
  });
});

describe("FR-CMPX-07 monster → entry + definition", () => {
  const Definition = z.strictObject({ name: EntityName, statBlock: MonsterStatBlock });

  test("FR-CMPX-07 every record parses against the kind and creature schemas", () => {
    for (const r of [...tb1.records, ...tb2.records]) {
      expect(EntryDraft.safeParse(r.data).success).toBe(true);
      if (r.kind === "monster" && r.definition) {
        expect(Definition.safeParse(r.definition).success).toBe(true);
      }
    }
    expect(tb1.counts).toEqual({
      monster: 7,
      spell: 3,
      item: 10,
      condition: 0,
      feature: 0,
      rule: 0,
    });
    expect(tb2.counts).toEqual({
      monster: 3,
      spell: 1,
      item: 2,
      condition: 0,
      feature: 0,
      rule: 0,
    });
    expect(tb1.skipped).toBe(0);
    expect(tb2.skipped).toBe(0);
  });

  test("FR-CMPX-07 creature core: size, AC, HP + formula, speed, scores, saves, CR, type, darkvision", () => {
    const g = monster("monster/goblin");
    expect(g.definition).toEqual({
      name: "Goblin",
      statBlock: {
        size: "small",
        ac: 14,
        hpMax: 9,
        hpFormula: "2d6+2",
        initBonus: 2,
        speed: 30,
        abilities: { str: 9, dex: 15, con: 12, int: 10, wis: 8, cha: 9 },
        attacks: [
          { name: "Hooked Blade", toHit: 4, damage: "1d6+2", damageType: "slashing" },
          { name: "Whittled Bow", toHit: 4, damage: "1d6+2", damageType: "piercing" },
        ],
        cr: "1/4",
        type: "humanoid",
        senses: { darkvisionFt: 60, seesMagicalDarkness: false },
      },
    });
    const t = monster("monster/hedge-thaumaturge");
    expect(t.definition?.statBlock.saveProficiencies).toEqual(["int", "wis"]);
    expect(t.definition?.statBlock.type).toBe("humanoid");
  });

  test("FR-CMPX-07 reference text and meta", () => {
    const g = monster("monster/goblin");
    if (g.data.kind !== "monster") throw new Error("no");
    expect(g.data.facets).toEqual({ cr: "1/4", type: "humanoid", size: "small" });
    expect(g.data.body.meta).toEqual({
      subtype: "goblinoid",
      alignment: "neutral evil",
      armorNote: "reedweave armor",
      speedText: "30 ft.",
      skillsText: "Stealth +6",
      senses: "darkvision 60 ft., passive Perception 9",
      languages: "Common",
    });
    expect(g.data.body.actions[0]).toEqual({
      name: "Hooked Blade",
      text: "*Melee Weapon Attack:* +4 to hit, reach 5 ft., one target. *Hit:* 5 (1d6 + 2) slashing damage.",
    });
  });

  test("FR-CMPX-07 second damage dice stay in the text with a warning (OQ-CMPX-03 A)", () => {
    const g = monster("monster/goblin");
    if (g.data.kind !== "monster") throw new Error("no");
    expect(g.data.body.actions[1]?.text).toContain("plus 2 (1d4) poison damage");
    expect(warningsOf("monster/goblin")).toContainEqual({
      sourceKey: "monster/goblin",
      field: "attacks[1]",
      message: "Further damage kept as text only",
    });
  });

  test("FR-CMPX-07 an action without an attack tag is no attack row; damage type read after the tag", () => {
    const t = monster("monster/cindermaw-tyrant");
    expect(t.definition?.statBlock.attacks).toEqual([
      { name: "Furnace Jaws", toHit: 10, damage: "2d10+6", damageType: "fire" },
    ]);
  });

  test("FR-CMPX-07 spellcasting → one trait: header, at will, per day, slots, footer", () => {
    const t = monster("monster/hedge-thaumaturge");
    if (t.data.kind !== "monster") throw new Error("no");
    expect(t.data.body.traits).toEqual([
      {
        name: "Spellcasting",
        text: [
          "The thaumaturge casts from a much-mended notebook (spell save DC 13).",
          "At will: glimmer dust\n1/day each: quarry sign, salt ward\nCantrips (at will): glimmer dust\n1st level (4 slots): lantern hex",
          "The notebook smells faintly of rain.",
        ].join("\n\n"),
      },
    ]);
  });

  test("FR-CMPX-07 legendary → `legendary`; mythic, lair, regional → one trait each", () => {
    const t = monster("monster/cindermaw-tyrant");
    if (t.data.kind !== "monster") throw new Error("no");
    expect(t.data.body.legendary).toEqual({
      intro: "Can take 3 legendary actions.",
      actions: [
        { name: "Stoke", text: "The tyrant fans its own coals." },
        {
          name: "Crush",
          text: "It moves up to half its speed, shouldering aside anything lying down.",
        },
      ],
    });
    expect(t.data.body.traits.map((x) => x.name)).toEqual([
      "Ash Hide",
      "Mythic Actions",
      "Lair Actions",
      "Regional Effects",
    ]);
    const lair = t.data.body.traits.find((x) => x.name === "Lair Actions");
    expect(lair?.text).toBe(
      "On initiative count 20 the tyrant picks one:\n\n- Vents open underfoot.\n- Ash blots out the light.",
    );
  });

  test("FR-CMPX-07 `{cr, lair}`, damage lists, big darkvision dropped with a warning", () => {
    const t = monster("monster/cindermaw-tyrant");
    if (t.data.kind !== "monster") throw new Error("no");
    expect(t.data.facets.cr).toBe("12");
    expect(t.data.body.meta.resistances).toBe("cold; bludgeoning, piercing from mundane sources");
    expect(t.definition?.statBlock.senses).toBeUndefined();
    expect(warningsOf("monster/cindermaw-tyrant")).toContainEqual({
      sourceKey: "monster/cindermaw-tyrant",
      field: "statBlock.senses",
      message: "Darkvision 240 ft doesn't fit; dropped",
    });
  });

  test("FR-CMPX-07 an HP formula that doesn't fit is dropped; the record stays", () => {
    const r = adaptBookData(
      emptyData({
        monsters: [
          {
            name: "Odd",
            source: "TB1",
            size: ["M"],
            type: "beast",
            ac: [10],
            hp: { average: 99, formula: "1d4" },
            cr: "1",
          },
        ],
      }),
      "TB1",
      { exists: allExist, srd: new Map() },
    );
    expect(monster("monster/odd", r.records).definition?.statBlock.hpFormula).toBeUndefined();
    expect(r.warnings.map((w) => w.field)).toContain("statBlock.hpFormula");
  });

  test("FR-CMPX-07 caps clip with a warning, never drop (FR-CMP-01)", () => {
    const long = "x".repeat(5_000);
    const r = adaptBookData(
      emptyData({
        monsters: [
          {
            name: `Long ${"n".repeat(90)}`,
            source: "TB1",
            size: ["M"],
            type: "beast",
            ac: [10],
            hp: { average: 5, formula: "1d8 + 1" },
            cr: "1",
            languages: ["l".repeat(300)],
            action: [
              {
                name: `Attack ${"a".repeat(60)}`,
                entries: ["{@atk mw} {@hit 1} to hit. {@h}1 ({@damage 1d4}) cold damage."],
              },
            ],
            trait: Array.from({ length: 45 }, (_, i) => ({
              name: `${"t".repeat(90)}${i}`,
              entries: [long],
            })),
          },
        ],
      }),
      "TB1",
      { exists: allExist, srd: new Map() },
    );
    expect(r.skipped).toBe(0);
    const m = r.records[0];
    if (m?.kind !== "monster" || m.data.kind !== "monster") throw new Error("no record");
    expect(m.data.name.length).toBe(80);
    expect(m.definition?.name.length).toBe(60);
    expect(m.data.body.traits).toHaveLength(40);
    expect(m.data.body.traits[0]?.name.length).toBe(80);
    expect(m.data.body.meta.languages?.length).toBe(200);
    expect(m.definition?.statBlock.attacks[0]?.name.length).toBe(40);
    const bytes = new TextEncoder().encode(
      JSON.stringify({ facets: m.data.facets, body: m.data.body }),
    ).length;
    expect(bytes).toBeLessThanOrEqual(32 * 1024);
    const fields = new Set(r.warnings.map((w) => w.field));
    expect(fields).toContain("name");
    expect(fields).toContain("definition.name");
    expect(fields).toContain("traits");
    expect(fields).toContain("traits[0].text");
    expect(fields).toContain("body.meta.languages");
    expect(fields).toContain("attacks[0]");
    expect([...fields].some((f) => f.startsWith("body.traits["))).toBe(true);
  });

  test("FR-CMPX-07 no known CR or size → a stand-in with a warning; the record stays", () => {
    const r = adaptBookData(
      emptyData({
        monsters: [{ name: "Blank", source: "TB1", ac: [10], hp: { average: 5 }, type: "beast" }],
      }),
      "TB1",
      { exists: allExist, srd: new Map() },
    );
    const m = monster("monster/blank", r.records);
    expect(m.definition?.statBlock.cr).toBe("0");
    expect(m.definition?.statBlock.size).toBe("medium");
    expect(r.warnings.map((w) => w.field).sort()).toEqual(["cr", "size"]);
  });
});

describe("FR-CMPX-08 no numeric HP or AC", () => {
  test("FR-CMPX-08 special HP → entry only, no definition", () => {
    const m = monster("monster/wobbling-fenwisp");
    expect(m.definition).toBeUndefined();
    expect(m.data.name).toBe("Wobbling Fénwisp");
    expect(warningsOf("monster/wobbling-fenwisp")).toContainEqual({
      sourceKey: "monster/wobbling-fenwisp",
      field: "definition",
      message: "No numeric HP or AC; entry only",
    });
  });
  test("FR-CMPX-08 special AC → entry only, no definition", () => {
    expect(monster("monster/mirrored-husk", tb2.records).definition).toBeUndefined();
  });
  test("FR-CMPX-08 AC over the creature core's cap → entry only, not lost", () => {
    const r = adaptBookData(
      emptyData({
        monsters: [
          {
            name: "Wall",
            source: "TB1",
            size: ["H"],
            type: "plant",
            ac: [99],
            hp: { average: 5 },
            cr: "1",
          },
        ],
      }),
      "TB1",
      { exists: allExist, srd: new Map() },
    );
    expect(monster("monster/wall", r.records).definition).toBeUndefined();
    expect(r.counts.monster).toBe(1);
  });
});

describe("FR-CMPX-09 spells", () => {
  test("FR-CMPX-09 facets and body", () => {
    expect(spell("spell/quarry-sign")).toEqual({
      kind: "spell",
      name: "Quarry Sign",
      facets: {
        level: 1,
        school: "divination",
        classes: ["Ranger"],
        concentration: true,
        ritual: false,
      },
      body: {
        castingTime: "1 bonus action",
        range: "90 feet",
        components: "V",
        duration: "Concentration, up to 1 hour",
        text: "You chalk an unseen sign on one creature you can see. Your weapon hits on it deal an extra 1d6 damage.",
        higherLevel: "The sign lasts longer at 1d6 levels.",
      },
    });
  });
  test("FR-CMPX-09 SRD twelve only: others dropped with a warning; variants count", () => {
    const s = spell("spell/lantern-hex");
    expect(s.facets.classes).toEqual(["Bard", "Wizard"]);
    expect(warningsOf("spell/lantern-hex")).toContainEqual({
      sourceKey: "spell/lantern-hex",
      field: "classes",
      message: '"Artificer" isn\'t an SRD class; dropped',
    });
  });
  test("FR-CMPX-09 material, ritual, ranges, durations, casting times", () => {
    const s = spell("spell/lantern-hex");
    expect(s.facets.ritual).toBe(true);
    expect(s.body.material).toBe("a snuffed candle");
    expect(s.body.components).toBe("V, S, M");
    expect(s.body.range).toBe("Self (15-foot radius)");
    expect(s.body.duration).toBe("Instantaneous");
    expect(s.body.castingTime).toBe("1 action or 1 reaction, which you take when a light goes out");
    const dust = spell("spell/glimmer-dust");
    expect(dust.facets.level).toBe(0);
    expect(dust.facets.classes).toEqual([]);
    expect(dust.body.range).toBe("Touch");
    expect(dust.body.duration).toBe("Up to 10 minutes");
    expect(dust.body.material).toBe("a pinch of mica");
    const ward = rec("spell/salt-ward", tb2.records).data;
    if (ward.kind !== "spell") throw new Error("no");
    expect(ward.body.range).toBe("Self");
    expect(ward.body.duration).toBe("Until dispelled or triggered");
    expect(ward.body.castingTime).toBe("10 minutes");
  });
  test("FR-CMPX-09 unknown school → skipped with a warning", () => {
    const r = adaptBookData(
      emptyData({ spells: [{ name: "Odd", source: "TB1", level: 1, school: "Q" }] }),
      "TB1",
      { exists: allExist, srd: new Map() },
    );
    expect(r.counts.spell).toBe(0);
    expect(r.skipped).toBe(1);
  });
});

describe("FR-CMPX-10 items", () => {
  test("FR-CMPX-10 weapon from a base item: category, damage, properties, cost, weight", () => {
    expect(item("item/thornpike")).toEqual({
      kind: "item",
      name: "Thornpike",
      facets: { category: "weapon", attunement: false },
      body: {
        typeLine: "Martial melee weapon",
        cost: "15 gp",
        weight: "6 lb.",
        damage: "1d8 piercing",
        properties: "versatile (1d10), heavy",
        text: "",
      },
    });
  });
  test("FR-CMPX-10 armor: AC text, strength and stealth notes; shield", () => {
    const a = item("item/reedweave-armor");
    expect(a.facets.category).toBe("armor");
    expect(a.body.typeLine).toBe("Light armor");
    expect(a.body.ac).toBe("12 + Dex modifier");
    expect(a.body.text).toBe("Requires Strength 11. Disadvantage on Dexterity (Stealth) checks.");
    const s = item("item/tin-buckler", tb2.records);
    expect(s.facets.category).toBe("armor");
    expect(s.body.ac).toBe("+1");
  });
  test("FR-CMPX-10 magic item: rarity, attunement, wondrous", () => {
    expect(item("item/lantern-of-quiet-hours")).toEqual({
      kind: "item",
      name: "Lantern of Quiet Hours",
      facets: { category: "magic", rarity: "uncommon", attunement: true },
      body: {
        typeLine: "Wondrous item (requires attunement)",
        weight: "2 lb.",
        text: "While lit, footsteps make no sound within 2d6 feet.",
      },
    });
  });
  test("FR-CMPX-10 a magic item takes its base's stats; the type code decides the category", () => {
    const p = item("item/ashen-thornpike");
    expect(p.facets).toEqual({ category: "weapon", rarity: "rare", attunement: true });
    expect(p.body.typeLine).toBe("Martial melee weapon (requires attunement by a ranger)");
    expect(p.body.damage).toBe("1d8 piercing");
  });
  test("FR-CMPX-10 mundane gear: no rarity; `none` is not magic", () => {
    const g = item("item/old-spyglass");
    expect(g.facets).toEqual({ category: "gear", attunement: false });
    expect(g.body.cost).toBe("15 sp");
  });
  test("FR-CMPX-10 shared item text filled from the item", () => {
    const m = item("item/mantle-of-emberward");
    expect(m.body.text).toBe("You resist fire damage while wearing this.");
    expect(m.body.typeLine).toBe("Wondrous item (attunement optional)");
    expect(m.facets.attunement).toBe(true);
  });
  test("FR-CMPX-10 `_copy` on items", () => {
    const g = item("item/greater-lantern-of-quiet-hours");
    expect(g.facets.rarity).toBe("rare");
    expect(g.body.text).toBe(
      "While lit, footsteps make no sound within 2d6 feet.\n\nIts light cannot be seen from outside.",
    );
  });
  test("FR-CMPX-10 a generic variant is one entry, not expanded", () => {
    const v = item("item/etched-weapon");
    expect(v.name).toBe("Etched Weapon");
    expect(v.facets).toEqual({ category: "magic", rarity: "uncommon", attunement: false });
    expect(v.body.typeLine).toBe("Any weapon");
    expect(v.body.text).toBe("You have a +1 bonus to attack and damage rolls with this weapon.");
  });
  test("FR-CMPX-10 an item group is one entry, naming its members", () => {
    const g = item("item/tideglass-charm");
    expect(g.facets).toEqual({ category: "magic", rarity: "uncommon", attunement: false });
    expect(g.body.text).toBe(
      "A bead of sea-worn glass on a cord.\n\nIncludes: Tideglass Charm (Gull), Tideglass Charm (Crab).",
    );
  });
});

describe("FR-CMPX-11 keys", () => {
  test("FR-CMPX-11 `<kind>/<slug(name)>`; accents and apostrophes fold", () => {
    expect(tb1.records.map((r) => r.sourceKey)).toContain("monster/wobbling-fenwisp");
    expect(rec("monster/goblin").kind).toBe("monster");
    expect(rec("spell/quarry-sign").kind).toBe("spell");
    expect(rec("item/old-spyglass").kind).toBe("item");
    expect(new Set(tb1.records.map((r) => r.sourceKey)).size).toBe(tb1.records.length);
  });
  test("FR-CMPX-11 a duplicate key in one book → later record skipped with a warning", () => {
    const r = adaptBookData(
      emptyData({
        spells: [
          { name: "Same Name", source: "TB1", level: 1, school: "A", entries: ["first"] },
          { name: "same name", source: "TB1", level: 2, school: "A", entries: ["second"] },
        ],
      }),
      "TB1",
      { exists: allExist, srd: new Map() },
    );
    expect(r.records).toHaveLength(1);
    expect(r.records[0]?.data.name).toBe("Same Name");
    expect(r.skipped).toBe(1);
    expect(r.warnings).toContainEqual({
      sourceKey: "spell/same-name",
      field: "sourceKey",
      message: "Duplicate; later record dropped",
    });
  });
  test("FR-CMPX-11 a name with no usable key → skipped with a warning", () => {
    const r = adaptBookData(
      emptyData({ spells: [{ name: "???", source: "TB1", level: 1, school: "A" }] }),
      "TB1",
      { exists: allExist, srd: new Map() },
    );
    expect(r.skipped).toBe(1);
    expect(r.warnings[0]?.field).toBe("sourceKey");
  });
});

describe("FR-CMPX-13 replaces", () => {
  test("FR-CMPX-13 `srd: true` → the SRD entry of that kind and name, against the bundled source", () => {
    expect(rec("monster/goblin").replaces).toEqual(["srd-5.1:monster/goblin"]);
    expect(rec("item/longsword").replaces).toEqual(["srd-5.1:item/longsword"]);
  });
  test('FR-CMPX-13 `srd: "<name>"` → that name, case-insensitively', () => {
    expect(rec("spell/quarry-sign").replaces).toEqual(["srd-5.1:spell/hunters-mark"]);
    const r = adaptBookData(
      emptyData({
        spells: [{ name: "X", source: "TB1", level: 1, school: "A", srd: "HUNTER’S MARK" }],
      }),
      "TB1",
      { exists: allExist },
    );
    expect(r.records[0]?.replaces).toEqual(["srd-5.1:spell/hunters-mark"]);
  });
  test("FR-CMPX-13 kind matters; unresolved → a warning, no ref", () => {
    const r = adaptBookData(
      emptyData({ spells: [{ name: "Goblin", source: "TB1", level: 1, school: "A", srd: true }] }),
      "TB1",
      { exists: allExist },
    );
    expect(r.records[0]?.replaces).toBeUndefined();
    expect(r.warnings).toContainEqual({
      sourceKey: "spell/goblin",
      field: "replaces",
      message: "SRD entry not found; no ref",
    });
  });
  test("FR-CMPX-13 an SRD entry's other names resolve; exact names win", () => {
    const srd = srdIndexOf([
      { kind: "item", sourceKey: "item/crossbow-hand", data: { name: "Crossbow, hand" } },
      { kind: "item", sourceKey: "item/leather", data: { name: "Leather" } },
      { kind: "item", sourceKey: "item/ioun-stone", data: { name: "Ioun Stone" } },
      { kind: "item", sourceKey: "item/stone", data: { name: "Stone of Luck (Lucky)" } },
      { kind: "monster", sourceKey: "monster/a-b", data: { name: "Alpha/Beta" } },
      { kind: "monster", sourceKey: "monster/alpha", data: { name: "Alpha" } },
    ]);
    const items = ["Hand Crossbow", "Leather Armor", "Ioun Stone (Agility)", "Stone of Luck"];
    const r = adaptBookData(
      emptyData({
        items: items.map((name) => ({ name, source: "TB1", srd: true })),
        monsters: ["Alpha", "Beta"].map((name) => ({ name, source: "TB1", srd: true })),
      }),
      "TB1",
      { exists: allExist, srd },
    );
    expect(r.records.flatMap((x) => x.replaces ?? [])).toEqual([
      "srd-5.1:monster/alpha",
      "srd-5.1:monster/a-b",
      "srd-5.1:item/crossbow-hand",
      "srd-5.1:item/leather",
      "srd-5.1:item/ioun-stone",
      "srd-5.1:item/stone",
    ]);
  });
  test("FR-CMPX-13 `reprintedAs` → the reprint lists the older entry's ref", () => {
    expect(rec("monster/gnasher", tb2.records).replaces).toEqual(["5et-tb1:monster/gnasher"]);
    expect(rec("monster/gnasher").replaces).toBeUndefined();
    expect(rec("item/old-spyglass", tb2.records).replaces).toEqual(["5et-tb1:item/old-spyglass"]);
  });
  test("FR-CMPX-13 every ref and art path passes core's import rule (a bad one fails the book)", () => {
    const Refs = z.array(ReplacedRef).max(REPLACES_MAX);
    for (const r of [...tb1.records, ...tb2.records]) {
      expect(Refs.safeParse(r.replaces ?? []).success).toBe(true);
      if (r.kind === "monster" && r.artPath != null) {
        expect(ArtPath.safeParse(r.artPath).success).toBe(true);
      }
    }
  });
  test("FR-CMPX-13 more than 20 refs → clipped to 20 with a warning; the record stays", () => {
    const r = adaptBookData(
      emptyData({
        monsters: [
          ...Array.from({ length: 25 }, (_, i) => ({
            name: `Old ${i}`,
            source: "TB1",
            reprintedAs: ["Newer|TB2"],
          })),
          { name: "Newer", source: "TB2" },
        ],
      }),
      "TB2",
      { exists: allExist, srd: new Map() },
    );
    expect(r.records[0]?.replaces).toHaveLength(20);
    expect(r.warnings).toContainEqual({
      sourceKey: "monster/newer",
      field: "replaces",
      message: "More than 20 refs; clipped",
    });
  });
  test("FR-CMPX-13 an older entry with no usable key gives no ref (a bad ref would fail the book)", () => {
    const r = adaptBookData(
      emptyData({
        monsters: [
          { name: "???", source: "TB1", reprintedAs: ["Newer|TB2"] },
          { name: "Newer", source: "TB2" },
        ],
      }),
      "TB2",
      { exists: allExist, srd: new Map() },
    );
    expect(r.records[0]?.replaces).toBeUndefined();
    expect(r.warnings.map((w) => w.message)).toContain("Older entry gives no usable ref; dropped");
  });
  test("FR-CMPX-13 a copy that preserves `reprintedAs` counts, from any book", () => {
    const r = adaptBookData(
      emptyData({
        monsters: [
          { name: "Old", source: "TB1", reprintedAs: ["Newer|TB2"] },
          {
            name: "Old Copy",
            source: "TB1",
            _copy: { name: "Old", source: "TB1", _preserve: { reprintedAs: true } },
          },
          { name: "Newer", source: "TB2" },
        ],
      }),
      "TB2",
      { exists: allExist, srd: new Map() },
    );
    expect(r.records[0]?.replaces).toEqual(["5et-tb1:monster/old", "5et-tb1:monster/old-copy"]);
  });
  test("FR-CMPX-13 `{uid}` reprints, any case; a reprint outside the folder is nothing", () => {
    const r = adaptBookData(
      emptyData({
        monsters: [
          {
            name: "Old",
            source: "TB1",
            reprintedAs: [{ uid: "new one|tb2", tag: "creature" }, "Gone|ZZZ"],
          },
          { name: "New One", source: "TB2" },
        ],
      }),
      "TB2",
      { exists: allExist, srd: new Map() },
    );
    expect(r.records[0]?.replaces).toEqual(["5et-tb1:monster/old"]);
  });
});

describe("FR-CMPX-23 art path", () => {
  test("FR-CMPX-23 the rule: tokens/<SOURCE>/<name>.webp, ASCII name, kept if the file exists", () => {
    const seen: string[] = [];
    const r = adaptBook(DIR, "TB1", {
      exists: (p) => {
        seen.push(p);
        return p !== "img/bestiary/tokens/TB1/Hedge Thaumaturge.webp";
      },
    });
    expect(seen).toContain("img/bestiary/tokens/TB1/Wobbling Fenwisp.webp");
    expect(monster("monster/goblin", r.records).artPath).toBe(
      "img/bestiary/tokens/TB1/Goblin.webp",
    );
    expect(monster("monster/goblin-sapper", r.records).artPath).toBe(
      "img/bestiary/tokens/TB1/Goblin Sapper.webp",
    );
    expect(monster("monster/wobbling-fenwisp", r.records).artPath).toBe(
      "img/bestiary/tokens/TB1/Wobbling Fenwisp.webp",
    );
  });
  test("FR-CMPX-23 a missing file → null with a warning", () => {
    const r = adaptBook(DIR, "TB1", {
      exists: (p) => p !== "img/bestiary/tokens/TB1/Hedge Thaumaturge.webp",
    });
    expect(monster("monster/hedge-thaumaturge", r.records).artPath).toBeNull();
    expect(r.warnings).toContainEqual({
      sourceKey: "monster/hedge-thaumaturge",
      field: "artPath",
      message: "Token file missing; none",
    });
  });
  test("FR-CMPX-23 `token {name, source}` override first, `_copy` resolved", () => {
    expect(monster("monster/gnasher-whelp", tb2.records).artPath).toBe(
      "img/bestiary/tokens/TB1/Gnasher.webp",
    );
    const r = adaptBookData(
      emptyData({
        monsters: [
          { name: "Base", source: "TB1", token: { name: "Marked", source: "TB2" } },
          { name: "Copy", source: "TB1", _copy: { name: "Base", source: "TB1" } },
        ],
      }),
      "TB1",
      { exists: allExist, srd: new Map() },
    );
    expect(monster("monster/copy", r.records).artPath).toBe("img/bestiary/tokens/TB2/Marked.webp");
  });
  test.each([
    ["img/bestiary/tokens/TB1/Goblin.webp", true],
    ["img/x.webp", true],
    ["/img/x.webp", false],
    ["data/x.webp", false],
    ["img/../secret.webp", false],
    ["img\\x.webp", false],
    ["C:/img/x.webp", false],
    [`img/${"x".repeat(200)}.webp`, false],
  ])("FR-CMPX-23 path rule: %s → %s", (p, ok) => {
    expect(isValidArtPath(p)).toBe(ok);
  });
  test("FR-CMPX-23 a path that breaks the rule is never checked on disk", () => {
    const asked: string[] = [];
    const r = adaptBookData(
      emptyData({
        monsters: [
          { name: "Evil", source: "TB1", token: { name: "../../../secret", source: "TB1" } },
          { name: "Long", source: "TB1", token: { name: "x".repeat(300), source: "TB1" } },
        ],
      }),
      "TB1",
      {
        exists: (p) => {
          asked.push(p);
          return true;
        },
        srd: new Map(),
      },
    );
    expect(asked).toEqual([]);
    expect(monster("monster/evil", r.records).artPath).toBeNull();
    expect(monster("monster/long", r.records).artPath).toBeNull();
    expect(r.warnings.filter((w) => w.field === "artPath").map((w) => w.message)).toEqual([
      "Token path not allowed; none",
      "Token path not allowed; none",
    ]);
  });
  test("FR-CMPX-23 tokenPath folds accents and drops double quotes", () => {
    expect(tokenPath({ name: 'Æther "Big" Moth é', source: "TB1" })).toBe(
      "img/bestiary/tokens/TB1/AEther Big Moth e.webp",
    );
  });
  test("FR-CMPX-23 prepare: SVGs rasterised to real .webp; one monster has no file", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pp-5et-"));
    try {
      await prepare5etoolsMini(dir);
      const r = adaptBook(dir, "TB1");
      expect(monster("monster/goblin", r.records).artPath).toBe(
        "img/bestiary/tokens/TB1/Goblin.webp",
      );
      expect(monster("monster/hedge-thaumaturge", r.records).artPath).toBeNull();
      const webp = await Bun.file(path.join(dir, "img/bestiary/tokens/TB1/Goblin.webp")).bytes();
      expect(new TextDecoder().decode(webp.slice(8, 12))).toBe("WEBP");
      expect(listBooks(dir).state).toBe("ready");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("FR-CMPX-20 the committed fixture holds no rendered image", () => {
    const committed = [...new Bun.Glob("**/*.webp").scanSync(DIR)];
    expect(committed).toEqual([]);
  });
});

test("adaptBook leaves the read data reusable (no book's copies leak into the next)", () => {
  const data = readFolder(read);
  const a = adaptBookData(data, "TB1", { exists: allExist });
  const b = adaptBookData(data, "TB1", { exists: allExist });
  expect(JSON.stringify(b.records)).toBe(JSON.stringify(a.records));
});
