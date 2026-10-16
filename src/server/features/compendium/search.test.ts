// FR-CMP-10 / -11 unit: ranking tiers, ties, cursor paging and validation, query schema.
import { describe, expect, test } from "bun:test";
import { SEARCH_PAGE, SearchQuery } from "@shared/compendium/rest";
import { CommandError } from "../../commands/errors";
import { campaign, compendiumEntry } from "../../db/schema";
import { openTestDb } from "../../db/testing";
import { decodeCursor, encodeCursor, normalizeQ, rankOf, searchEntries } from "./search";
import type { EntryViewer } from "./visibility";

const AT = "2026-01-01T00:00:00.000Z";
const DM: EntryViewer = { role: "dm", campaignId: "camp", playerId: null };

function seed(rows: { id: string; name: string; text?: string; kind?: "condition" | "feature" }[]) {
  const db = openTestDb();
  db.insert(campaign)
    .values({ id: "camp", name: "Camp", active: true, createdAt: AT, updatedAt: AT })
    .run();
  for (const r of rows) {
    const nameKey = normalizeQ(r.name);
    db.insert(compendiumEntry)
      .values({
        id: r.id,
        campaignId: "camp",
        kind: r.kind ?? "condition",
        source: null,
        sourceKey: null,
        name: r.name,
        nameKey,
        line: "Condition",
        facets: {},
        body: { text: r.text ?? "" },
        searchText: `${nameKey}\ncondition\n${(r.text ?? "").toLowerCase()}`,
        dataHash: r.id,
        definitionId: null,
        shared: true,
        derivedFromId: null,
        createdAt: AT,
        updatedAt: AT,
        importedAt: null,
      })
      .run();
  }
  return db;
}

const q = (v: Record<string, string>) => SearchQuery.parse(v);
const names = (r: { results: { name: string }[] }) => r.results.map((x) => x.name);

describe("FR-CMP-10 search ranking", () => {
  test("FR-CMP-10 ranking: name prefix > word start > substring > text (q ≥ 3); ties by name, id", () => {
    expect(rankOf("goblin", "gob", false)).toBe(0);
    expect(rankOf("elite goblin", "gob", false)).toBe(1);
    expect(rankOf("hobgoblin", "gob", false)).toBe(2);
    // A later word-start occurrence wins over an earlier substring one.
    expect(rankOf("hobgoblin goblin", "gob", false)).toBe(1);
    expect(rankOf("ogre", "gob", true)).toBe(3);
    expect(rankOf("ogre", "go", true)).toBeNull();
    expect(rankOf("ogre", "gob", false)).toBeNull();
    expect(rankOf("anything", "", false)).toBe(0);

    const db = seed([
      { id: "e1", name: "Hobgoblin" },
      { id: "e2", name: "Goblin Boss" },
      { id: "e3", name: "Elite Goblin" },
      { id: "e4", name: "Ogre", text: "Often keeps goblins as slaves." },
      { id: "e5", name: "Goblin" },
      { id: "e6", name: "goblin", kind: "feature" },
      { id: "e7", name: "Wolf" },
    ]);
    const r = searchEntries(db, DM, q({ q: "  GOB " }));
    expect(names(r)).toEqual([
      "Goblin",
      "goblin",
      "Goblin Boss",
      "Elite Goblin",
      "Hobgoblin",
      "Ogre",
    ]);
    // Same name key: tie broken by id.
    expect(r.results.slice(0, 2).map((x) => x.id)).toEqual(["e5", "e6"]);
    expect(r.nextCursor).toBeNull();
    // Below 3 chars the text tier is off.
    expect(names(searchEntries(db, DM, q({ q: "go" })))).not.toContain("Ogre");
    // Empty q lists by name.
    expect(names(searchEntries(db, DM, q({})))[0]).toBe("Elite Goblin");
    expect(searchEntries(db, DM, q({})).results).toHaveLength(7);
    expect(searchEntries(db, DM, q({ q: "%" })).results).toEqual([]);
  });

  test("FR-CMP-10 cursor: ≤ 50 per page, pages join to the full order without repeats; a bad cursor is invalid", () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({
      id: `e${String(i).padStart(3, "0")}`,
      name: `Thing ${String(119 - i).padStart(3, "0")}`,
    }));
    const db = seed(rows);
    const all: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const r = searchEntries(db, DM, q(cursor ? { q: "thing", cursor } : { q: "thing" }));
      expect(r.results.length).toBeLessThanOrEqual(SEARCH_PAGE);
      all.push(...names(r));
      cursor = r.nextCursor ?? undefined;
      pages++;
    } while (cursor);
    expect(pages).toBe(3);
    expect(all).toEqual(rows.map((r) => r.name).sort());
    for (const bad of ["not-base64!", encodeCursor([0, "x", "y"]).slice(2), "W10"]) {
      expect(() => searchEntries(db, DM, q({ cursor: bad }))).toThrow(CommandError);
    }
    expect(decodeCursor(encodeCursor([2, "a", "b"]))).toEqual([2, "a", "b"]);
  });
});

describe("FR-CMP-11 query schema", () => {
  test("FR-CMP-11 filters per kind; unknown key, a filter without kind or of another kind, a bad value → invalid", () => {
    expect(SearchQuery.safeParse({ kind: "spell", level: "3", school: "evocation" }).success).toBe(
      true,
    );
    expect(SearchQuery.parse({ kind: "spell", level: "3" }).level).toBe(3);
    expect(SearchQuery.safeParse({ kind: "monster", crMin: "1/4", crMax: "5" }).success).toBe(true);
    expect(SearchQuery.safeParse({ kind: "feature", className: "Rogue" }).success).toBe(true);
    for (const bad of [
      { kind: "spell", colour: "red" },
      { level: "3" },
      { kind: "item", level: "3" },
      { kind: "spell", level: "10" },
      { kind: "monster", crMin: "1/3" },
      { kind: "spell", school: "pyromancy" },
      { kind: "dragon" },
      { q: "x".repeat(101) },
      { q: ["a", "b"] },
    ]) {
      expect({ bad, ok: SearchQuery.safeParse(bad).success }).toEqual({ bad, ok: false });
    }
  });
});
