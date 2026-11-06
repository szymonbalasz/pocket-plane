// gsb:import units: preflight, mapper, diff buckets, ledger. Invented data only.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PutEntryBody } from "@shared/compendium/homebrew";
import { ENTRY_MAX_BYTES, HOMEBREW_TEXT_MAX } from "@shared/compendium/schemas";
import { parseFlags } from "../../gsb-import";
import { EXPORTER_ENV, exporterRoot, GsbError, Item, readDataset } from "./dataset";
import { diff } from "./diff";
import { emptyLedger, ledgerPath, loadLedger, saveLedger } from "./ledger";
import { canonicalJson, entryHash, mapItem, TRUNCATED, uniqueNames } from "./map";
import { patchOf, runImport } from "./run";
import { type RawItem, rawItem, testExport, uidOf } from "./testing";
import { type ToolCaller, ToolFailure } from "./tools";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const exp = () => {
  const e = testExport();
  dirs.push(e.root);
  return e;
};
const item = (key: string, over = {}) => Item.parse(rawItem(key, over));

describe("GSB preflight", () => {
  test("GSB unset exporter path names the variable and .env", () => {
    expect(() => exporterRoot({}, "/x")).toThrow(GsbError);
    expect(() => exporterRoot({ [EXPORTER_ENV]: "  " }, "/x")).toThrow(
      new RegExp(`${EXPORTER_ENV} is not set.*\\.env`),
    );
  });

  test("GSB missing manifest prints the quoted path, spaces and all", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "pp gsb empty "));
    dirs.push(root);
    const err = await readDataset(root).catch((e) => e);
    expect(err).toBeInstanceOf(GsbError);
    expect(err.message).toContain(`"${path.join(root, "data", "manifest.json")}"`);
  });

  test("GSB a path with spaces (and quotes in .env) reads fine", async () => {
    const e = exp();
    e.write([rawItem("a"), rawItem("b")]);
    const root = exporterRoot({ [EXPORTER_ENV]: `"${e.root}"` }, "/elsewhere");
    expect(root).toBe(path.resolve(e.root));
    const d = await readDataset(root);
    expect(d.items.map((i) => i.uid)).toEqual([uidOf("a"), uidOf("b")]);
  });

  test("GSB wrong schemaVersion is refused", async () => {
    const e = exp();
    e.write([rawItem("a")], { schemaVersion: 2 });
    await expect(readDataset(e.root)).rejects.toThrow(/schemaVersion 2 isn't supported/);
  });

  test("GSB an item off schema is refused with its index", async () => {
    const e = exp();
    e.write([rawItem("a"), rawItem("b", { uid: "nope" })]);
    await expect(readDataset(e.root)).rejects.toThrow(/#1: uid/);
  });
});

describe("GSB mapper", () => {
  const dataDir = "/no/such/dir";

  test("GSB flavour first in italics, then description, info line, footer with url and uid", () => {
    const it = item("a", {
      flavor: "It hums.\nQuietly.",
      description: "Line one.\n\n* point\n\n***Bold Name.*** text",
      tags: ["Charges", "Druid"],
      treasureTheme: ["Arcana"],
      bookVolume: 2,
    });
    const { entry, warnings } = mapItem(it, dataDir);
    expect(warnings).toEqual([]);
    expect(entry.body.text).toBe(
      [
        "*It hums.*\n*Quietly.*",
        "Line one.\n\n- point\n\n**Bold Name.** text",
        "Tags: Charges, Druid · Theme: Arcana · Book 2",
        `Source: The Griffon's Saddlebag — https://example.test/items/a · ${it.uid}`,
      ].join("\n\n"),
    );
    expect(PutEntryBody.safeParse({ entry }).success).toBe(true);
  });

  test("GSB no flavour, no tags: description then footer only", () => {
    const { entry } = mapItem(item("a"), dataDir);
    expect(entry.body.text).toBe(
      `A made-up item called a.\n\nSource: The Griffon's Saddlebag — https://example.test/items/a · ${uidOf("a")}`,
    );
  });

  test("GSB one rarity → the SRD word; several → the author's text, lower case; facets", () => {
    expect(mapItem(item("a"), dataDir).entry.facets).toEqual({
      category: "magic",
      rarity: "rare",
      attunement: false,
    });
    const multi = item("b", { rarity: "Uncommon (+1), Rare (+2)", rarities: ["uncommon", "rare"] });
    expect(mapItem(multi, dataDir).entry.facets.rarity).toBe("uncommon (+1), rare (+2)");
    const none = item("c", { rarity: " ", rarities: [] });
    expect(mapItem(none, dataDir).entry.facets).toEqual({ category: "magic", attunement: false });
  });

  test("GSB attunement: facet + the SRD-style type line note; no rarity repeated", () => {
    const it = item("a", {
      typeLabel: "Weapon (longsword)",
      attunement: { required: true, requirement: "by a druid" },
    });
    const { entry } = mapItem(it, dataDir);
    expect(entry.facets.attunement).toBe(true);
    expect(entry.body.typeLine).toBe("Weapon (longsword) (requires attunement by a druid)");
    const bare = item("c", {
      attunement: { required: true, requirement: " Requires Attunement " },
    });
    expect(mapItem(bare, dataDir).entry.body.typeLine).toBe("Wondrous item (requires attunement)");
    const full = item("d", {
      attunement: { required: true, requirement: "requires attunement by a bard" },
    });
    expect(mapItem(full, dataDir).entry.body.typeLine).toBe(
      "Wondrous item (requires attunement by a bard)",
    );
    const plain = item("b", { attunement: { required: true }, typeLabel: null, type: null });
    expect(mapItem(plain, dataDir).entry.body.typeLine).toBe("Magic item (requires attunement)");
  });

  test("GSB images: main first, medium else the largest size, at most 4, missing file skipped", async () => {
    const e = exp();
    const imgs = [
      await e.image("one", 1, ["tiny", "medium", "original"]),
      await e.image("two", 2, ["tiny", "original"]),
      await e.image("three", 3, ["small"]),
      await e.image("four", 4),
      await e.image("five", 5),
    ];
    (imgs[2] as RawItem).files.small.path = "assets/images/three/gone.png";
    const it = item("a", { images: imgs, image: "assets/images/two/original.png" });
    const m = mapItem(it, e.dataDir);
    expect(m.images.map((i) => [i.id, path.basename(i.path)])).toEqual([
      ["two", "original.png"],
      ["one", "medium.png"],
      ["four", "medium.png"],
      ["five", "medium.png"],
    ]);
    expect(m.images.every((i) => path.isAbsolute(i.path))).toBe(true);
    expect(m.warnings).toEqual([
      "image three: file missing (assets/images/three/gone.png), skipped",
    ]);
  });

  test("GSB an image path escaping the data folder is skipped", () => {
    const it = item("a", {
      images: [{ id: "x", files: { medium: { path: "../../etc/x.png", sha256: "aa" } } }],
    });
    const m = mapItem(it, "/data", () => true);
    expect(m.images).toEqual([]);
    expect(m.warnings[0]).toContain("outside the data folder");
  });

  test("GSB text caps: a long description is cut with a marker and still fits", () => {
    const long = "word ".repeat(4_000);
    const { entry, warnings } = mapItem(
      item("a", { description: long, name: `  ${"N".repeat(90)} ` }),
      dataDir,
    );
    expect(entry.name).toBe("N".repeat(80));
    expect(entry.body.text.length).toBeLessThanOrEqual(HOMEBREW_TEXT_MAX);
    expect(
      Buffer.byteLength(JSON.stringify({ facets: entry.facets, body: entry.body })),
    ).toBeLessThanOrEqual(ENTRY_MAX_BYTES);
    expect(entry.body.text).toContain(TRUNCATED);
    expect(entry.body.text).toContain(uidOf("a"));
    expect(warnings.some((w) => w.startsWith("description cut"))).toBe(true);
    expect(warnings).toContain("name cut to 80 characters");
  });

  test("GSB text caps: a huge flavour and tag list are cut too; the footer stays", () => {
    const it = item("a", {
      flavor: "murmur ".repeat(3_000),
      description: "Short.",
      tags: Array.from({ length: 2_000 }, (_, i) => `tag${i}`),
    });
    const { entry, warnings } = mapItem(it, dataDir);
    expect(entry.body.text.length).toBeLessThanOrEqual(HOMEBREW_TEXT_MAX);
    expect(PutEntryBody.safeParse({ entry }).success).toBe(true);
    expect(entry.body.text).toEndWith(it.uid);
    expect(warnings.some((w) => w.startsWith("description cut"))).toBe(true);
    expect(warnings.some((w) => w.startsWith("flavour cut"))).toBe(true);
    expect(entry.body.text).toContain(TRUNCATED);
  });

  test("GSB names shared in the dataset (any case): later uids get (2), (3), cut to fit, never a taken name", () => {
    const [a, b, c] = ["n1", "n2", "n3"].sort((x, y) => (uidOf(x) < uidOf(y) ? -1 : 1)) as [
      string,
      string,
      string,
    ];
    const long = "L".repeat(80);
    const all = [
      item(c, { name: "Twin" }),
      item(a, { name: "twin" }),
      item(b, { name: "TWIN " }),
      item("taken", { name: "Twin (2)" }),
      item("x", { name: long }),
      item("y", { name: long.toLowerCase() }),
    ];
    const m = uniqueNames(all);
    expect(m.get(uidOf(a))).toBeUndefined();
    expect(m.get(uidOf(b))).toBe("TWIN (3)");
    expect(m.get(uidOf(c))).toBe("Twin (4)");
    expect(m.get(uidOf("taken"))).toBeUndefined();
    const later = uidOf("x") < uidOf("y") ? "y" : "x";
    expect(m.get(uidOf(later))?.length).toBe(80);
    expect(m.get(uidOf(later))).toEndWith(" (2)");
    expect(m.size).toBe(3);
  });

  test("GSB entry hash ignores key order, not image order", () => {
    const a = {
      kind: "item",
      name: "x",
      facets: { b: 1, a: 2 },
      body: { t: "y" },
      imageAssetIds: ["1", "2"],
    };
    const b = {
      kind: "item",
      name: "x",
      facets: { a: 2, b: 1 },
      body: { t: "y" },
      imageAssetIds: ["1", "2"],
    };
    expect(entryHash(a)).toBe(entryHash(b));
    expect(entryHash({ ...a, imageAssetIds: ["2", "1"] })).not.toBe(entryHash(a));
    expect(canonicalJson({ z: [{ b: 1, a: 0 }] })).toBe('{"z":[{"a":0,"b":1}]}');
  });

  test("GSB edit patch replaces the whole entry: stored keys the mapping lacks become null", () => {
    const { entry } = mapItem(item("a", { rarities: [], rarity: "" }), dataDir);
    const stored = {
      id: "e1",
      kind: "item",
      name: "Old",
      source: null,
      imageAssetIds: [],
      facets: { category: "magic", rarity: "rare", attunement: true },
      body: { typeLine: "x", text: "y", cost: "5 gp" },
    };
    expect(patchOf(stored, entry, ["i1"])).toEqual({
      name: entry.name,
      facets: { rarity: null, category: "magic", attunement: false },
      body: { cost: null, typeLine: entry.body.typeLine, text: entry.body.text },
      imageAssetIds: ["i1"],
    });
  });
});

describe("GSB diff", () => {
  const row = (contentHash: string, extra = {}) => ({
    entryId: "e",
    contentHash,
    writtenHash: "w",
    imageAssetIds: [],
    imageSha256s: [],
    ...extra,
  });

  test("GSB buckets: new, changed, unchanged, removed (unfiltered only, once)", () => {
    const [a, b, c] = ["a", "b", "c"].map((k) => item(k));
    const ledger = emptyLedger();
    ledger.items[uidOf("a")] = row(a?.contentHash as string);
    ledger.items[uidOf("b")] = row("sha256:old");
    ledger.items[uidOf("gone")] = row("sha256:x");
    ledger.items[uidOf("gone-before")] = row("sha256:x", { removedAt: "2026-01-01" });
    const all = [a, b, c] as Item[];
    const d = diff(all, ledger, {});
    expect(d.unchanged.map((i) => i.uid)).toEqual([uidOf("a")]);
    expect(d.changed.map((i) => i.uid)).toEqual([uidOf("b")]);
    expect(d.new.map((i) => i.uid)).toEqual([uidOf("c")]);
    expect(d.removed).toEqual([uidOf("gone")]);
    const f = diff(all, ledger, { name: "test b" });
    expect([f.new.length, f.changed.length, f.unchanged.length, f.removed.length]).toEqual([
      0, 1, 0, 0,
    ]);
  });

  test("GSB a row written by an older mapper version is changed; absent version = 1", () => {
    const a = item("a");
    const ledger = emptyLedger();
    ledger.items[a.uid] = row(a.contentHash);
    expect(diff([a], ledger, {}).unchanged).toHaveLength(1);
    expect(diff([a], ledger, {}, 2).changed).toHaveLength(1);
    ledger.items[a.uid] = row(a.contentHash, { mapperVersion: 2 });
    expect(diff([a], ledger, {}, 2).unchanged).toHaveLength(1);
    expect(diff([a], ledger, {}, 1).changed).toHaveLength(1);
  });

  test("GSB --limit keeps the first n filtered items, so a rerun picks the same ones", () => {
    const all = ["a", "b", "c", "d"].map((k) => item(k, k === "b" ? { type: "Ring" } : {}));
    const names = (f: object) => diff(all, emptyLedger(), f).new.map((i) => i.name.slice(5));
    expect(names({ limit: 2 })).toEqual(["a", "b"]);
    expect(names({ limit: 2, type: "wondrous item" })).toEqual(["a", "c"]);
  });

  test("GSB filters: type, rarity, tag, theme, uid fold case", () => {
    const all = [
      item("a", { type: "Ring", tags: ["Druid"] }),
      item("b", { rarities: ["very rare"], treasureTheme: ["Relics"] }),
      item("c"),
    ];
    const keys = (f: object) => diff(all, emptyLedger(), f).new.map((i) => i.name.slice(5));
    expect(keys({ type: "ring" })).toEqual(["a"]);
    expect(keys({ tag: "druid" })).toEqual(["a"]);
    expect(keys({ rarity: "Very Rare" })).toEqual(["b"]);
    expect(keys({ theme: "relics" })).toEqual(["b"]);
    expect(keys({ uids: [uidOf("c"), uidOf("a")] })).toEqual(["a", "c"]);
  });
});

describe("GSB ledger", () => {
  test("GSB ledger round-trips atomically; missing → empty; corrupt → refused", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "pp gsb ledger "));
    dirs.push(dir);
    const file = ledgerPath(path.join(dir, "sub"), "dev", "camp/1");
    expect(path.basename(file)).toBe("dev-camp_1.json");
    expect(loadLedger(file)).toEqual(emptyLedger());
    const l = emptyLedger();
    l.datasetHash = "sha256:x";
    l.items[uidOf("a")] = {
      entryId: "e1",
      contentHash: "sha256:c",
      writtenHash: "sha256:w",
      imageAssetIds: ["i1"],
      imageSha256s: ["s1"],
    };
    saveLedger(file, l);
    expect(loadLedger(file)).toEqual(l);
    expect(readdirSync(path.dirname(file))).toEqual(["dev-camp_1.json"]);
    writeFileSync(file, "{not json");
    expect(() => loadLedger(file)).toThrow(GsbError);
  });
});

describe("GSB stops", () => {
  const campaign = (id: string) => ({ campaigns: [{ id, name: id, active: true }] });
  function fake(handle: (name: string, n: number) => unknown): ToolCaller & { calls: string[] } {
    const calls: string[] = [];
    return {
      calls,
      async call<T>(name: string): Promise<T> {
        calls.push(name);
        return (await handle(name, calls.filter((c) => c === name).length)) as T;
      },
      close: async () => {},
    };
  }
  const opts = (caller: ToolCaller) => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "pp gsb stops "));
    dirs.push(dir);
    return {
      caller,
      dataset: {
        root: dir,
        dataDir: dir,
        manifest: { schemaVersion: 1, datasetHash: "sha256:x" },
        items: [item("a"), item("b")],
      },
      target: "dev",
      ledgerDir: dir,
      filters: {},
      apply: true,
      overwrite: false,
    };
  };

  test("GSB the active campaign switching mid-run stops it before any write", async () => {
    const c = fake((name, n) => {
      if (name === "campaigns_list") return campaign(n === 1 ? "camp-a" : "camp-b");
      return { entryId: "e" };
    });
    const s = await runImport(opts(c));
    expect(s.stopped?.code).toBe("campaign_changed");
    expect(s.result).toMatchObject({ created: 0, failed: 1, skipped: 1 });
    expect(c.calls).not.toContain("homebrew_create");
  });

  test("GSB 'no active campaign' during the run is fatal, not one failure per item", async () => {
    const c = fake((name) => {
      if (name === "campaigns_list") return campaign("camp-a");
      throw new ToolFailure("conflict", "No active campaign: open one in the DM client.");
    });
    const s = await runImport(opts(c));
    expect(s.stopped).toEqual({
      code: "conflict",
      message: "No active campaign: open one in the DM client.",
    });
    expect(c.calls.filter((x) => x === "homebrew_create")).toHaveLength(1);
    expect(s.result).toMatchObject({ failed: 1, skipped: 1 });
  });
});

describe("GSB flags", () => {
  test("GSB flags parse filters; unknown and valueless flags are usage errors", () => {
    expect(
      parseFlags(["--apply", "--name", "x y", "--uid", "a, b", "--limit", "3", "--json"]),
    ).toEqual({
      apply: true,
      overwrite: false,
      json: true,
      filters: { name: "x y", uids: ["a", "b"], limit: 3 },
    });
    expect(() => parseFlags(["--bogus"])).toThrow(/unknown argument/);
    expect(() => parseFlags(["--name"])).toThrow(/needs a value/);
    expect(() => parseFlags(["--limit", "0"])).toThrow(/whole number/);
  });
});
