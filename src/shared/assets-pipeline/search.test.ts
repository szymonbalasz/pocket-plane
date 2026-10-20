// ASSET §13.1 unit (shared): FR-ASSET-44 image matcher over the `images` + `image-tags` library,
// FR-ASSET-46 chips (order, counts, Untagged), FR-ASSET-47 suggestions and Manage prompts.
import { describe, expect, test } from "bun:test";
import { sampleLibrary, sampleNamed } from "./sample-library";
import {
  ALL_IMAGES,
  deletePrompt,
  existingSpelling,
  liveFilter,
  matchImages,
  renamePrompt,
  tagChips,
  tagSuggestions,
} from "./search";
import { tagKey } from "./tags";

const lib = sampleLibrary();
const names = (q: string, filter = ALL_IMAGES) => matchImages(lib, q, filter).map((a) => a.name);
const tag = (t: string) => ({ kind: "tag", key: tagKey(t) }) as const;

describe("image matcher (FR-ASSET-44)", () => {
  test('FR-ASSET-44 "Gob el" finds Elite Goblin: exactly Elite Goblin + Goblin Elder; el gob, GOB EL, gob   el same; Hobgoblin Captain and token-elite not', () => {
    for (const q of ["Gob el", "el gob", "GOB EL", "gob   el"]) {
      expect(names(q).sort()).toEqual(["Elite Goblin", "Goblin Elder"]);
    }
    expect(names("Gob el")).not.toContain("Hobgoblin Captain");
    expect(names("Gob el")).not.toContain("token-elite");
  });

  test("FR-ASSET-44 tags searched: cave maps → Goblin Cave; ma (< 3) doesn't reach the tag Maps; token / tokens reach the tag; lair secret → Ruined Keep (zz < 3 never reaches it)", () => {
    expect(names("cave maps")).toEqual(["Goblin Cave"]);
    // "ma" matches inside names only (Treasure Map, battlemap …), never the tag.
    for (const n of names("ma")) expect(n.toLowerCase()).toContain("ma");
    expect(names("ma")).not.toContain("Goblin Cave");
    const tokens = lib.filter((a) => a.tags.includes("Tokens")).map((a) => a.name);
    for (const q of ["token", "tokens"]) expect(names(q).sort()).toEqual([...tokens].sort());
    expect(names("lair secret")).toEqual(["Ruined Keep"]);
    // §13.1 lists "zz lair": its "zz" is 2 chars, so by FR-ASSET-44 / FR-CMP-33 it can't match a
    // tag word (spec gap reported).
    expect(names("zz lair")).toEqual([]);
  });

  test("FR-ASSET-44 order: tier, then picker order; empty q = picker order; the filter narrows first", () => {
    expect(names("")).toEqual(lib.map((a) => a.name));
    expect(names("   ")).toEqual(lib.map((a) => a.name));
    // "goblin": tier 1 (starts with) before tier 2 (a later word) before tier 3 (inside).
    const g = names("goblin");
    const tierOf = (n: string) =>
      n.toLowerCase().startsWith("goblin") ? 1 : /\bgoblin/i.test(n) ? 2 : 3;
    expect(g.map(tierOf)).toEqual([...g.map(tierOf)].sort());
    // Within a tier: picker order (newest first).
    const t1 = g.filter((n) => tierOf(n) === 1);
    const order = lib.map((a) => a.name).filter((n) => t1.includes(n));
    expect(t1).toEqual(order);
    expect(g.at(-1)).toBe("Hobgoblin Captain");
    // Filter first: "gob" in Maps → Goblin Cave only; Untagged → Misc Sketch only.
    expect(names("gob", tag("Maps"))).toEqual(["Goblin Cave"]);
    expect(names("", { kind: "untagged" })).toEqual(["Misc Sketch"]);
    expect(names("gob", { kind: "untagged" })).toEqual([]);
  });

  test("FR-ASSET-44 records are memoised by identity: a replaced record is matched afresh", () => {
    const keep = sampleNamed(lib, "Ruined Keep");
    expect(matchImages([keep], "secret")).toHaveLength(1);
    const renamed = { ...keep, tags: ["Maps"] };
    expect(matchImages([renamed], "secret")).toHaveLength(0);
  });
});

describe("tag chips (FR-ASSET-46)", () => {
  test("FR-ASSET-46 tag filter: built-ins in FR-ASSET-40 order, then DM tags A–Z, counts; Untagged only when ≥ 1", () => {
    const chips = tagChips(lib);
    expect(chips.tags.map((c) => [c.label, c.count])).toEqual([
      ["Tokens", 12],
      ["Portraits", 4],
      ["Maps", 6],
      ["Handouts", 3],
      ["Props", 4],
      ["Items", 3],
      ["zz-lair-secret", 1],
    ]);
    expect(chips.untagged).toBe(1);
    expect(chips.tags.at(-1)?.builtIn).toBe(false);
    // DM tags A–Z regardless of case; a built-in nobody holds has no chip.
    const more = [
      ...lib.filter((a) => !a.tags.includes("Handouts")),
      { ...sampleNamed(lib, "Misc Sketch"), id: "x1", tags: ["dungeon"] },
      { ...sampleNamed(lib, "Misc Sketch"), id: "x2", tags: ["Crypt"] },
    ];
    const c2 = tagChips(more);
    expect(c2.tags.map((c) => c.label)).toEqual([
      "Tokens",
      "Portraits",
      "Maps",
      "Props",
      "Items",
      "Crypt",
      "dungeon",
      "zz-lair-secret",
    ]);
    expect(tagChips(lib.filter((a) => a.tags.length > 0)).untagged).toBe(0);
  });

  test("FR-ASSET-46 a chip whose last image lost the tag falls back to All", () => {
    const chips = tagChips(lib.filter((a) => a.name !== "Ruined Keep"));
    expect(liveFilter(tag("zz-lair-secret"), chips)).toEqual(ALL_IMAGES);
    expect(liveFilter(tag("Maps"), chips)).toEqual(tag("Maps"));
    expect(liveFilter({ kind: "untagged" }, tagChips([]))).toEqual(ALL_IMAGES);
  });
});

describe("tag editor helpers (FR-ASSET-47)", () => {
  const chips = tagChips(lib);

  test("FR-ASSET-47 edit tags: suggestions are the campaign's tags + built-ins minus the image's, ranked by the shared matcher", () => {
    expect(tagSuggestions(chips, "por", ["Tokens"])).toEqual(["Portraits"]);
    expect(tagSuggestions(chips, "zz", [])).toEqual(["zz-lair-secret"]);
    // Held tags never suggested; a word inside a tag still matches (tier 3).
    expect(tagSuggestions(chips, "tok", ["Tokens"])).toEqual([]);
    expect(tagSuggestions(chips, "ems", [])).toEqual(["Items"]);
    // Empty q → chip order, at most 8.
    expect(tagSuggestions(chips, "", ["Maps"])).toEqual([
      "Tokens",
      "Portraits",
      "Handouts",
      "Props",
      "Items",
      "zz-lair-secret",
    ]);
  });

  test("FR-ASSET-47 typed tags take an existing spelling; Rename to an existing tag is a merge", () => {
    expect(existingSpelling(chips, "maps")).toBe("Maps");
    expect(existingSpelling(chips, "ZZ Lair Secret")).toBe("zz-lair-secret");
    expect(existingSpelling(chips, "Dungeon")).toBeNull();
    const withDungeon = tagChips([
      ...lib.filter((a) => a.name !== "Misc Sketch"),
      { ...sampleNamed(lib, "Misc Sketch"), tags: ["Dungeon"] },
    ]);
    const dungeon = withDungeon.tags.find((c) => c.label === "Dungeon");
    if (!dungeon) throw new Error("no Dungeon chip");
    expect(renamePrompt(withDungeon, dungeon, "maps")).toBe("Merge Dungeon into Maps? 1 image");
    expect(renamePrompt(withDungeon, dungeon, "Crypt")).toBeNull();
    // Same tag, new spelling: a respell, not a merge.
    expect(renamePrompt(withDungeon, dungeon, "DUNGEON")).toBeNull();
    const maps = withDungeon.tags.find((c) => c.label === "Maps");
    if (!maps) throw new Error("no Maps chip");
    expect(deletePrompt(maps)).toBe("Remove Maps from 6 images?");
    expect(deletePrompt(dungeon)).toBe("Remove Dungeon from 1 image?");
  });
});
