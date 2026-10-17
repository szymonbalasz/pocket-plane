// FR-CMP-10 / -11 / -33 / -35 unit: tiers and ties over the index, cursor paging and
// validation, groups, query schema (incl. `sameAs`).
import { describe, expect, test } from "bun:test";
import { SEARCH_PAGE, SearchQuery } from "@shared/compendium/rest";
import { entryNameKey } from "@shared/compendium/schemas";
import { CommandError } from "../../commands/errors";
import { campaign, compendiumEntry, compendiumSource } from "../../db/schema";
import { openTestDb } from "../../db/testing";
import { decodeCursor, encodeCursor, groupLine, searchEntries } from "./search";
import { buildSearchIndex } from "./search-index";
import type { EntryViewer } from "./visibility";

const AT = "2026-01-01T00:00:00.000Z";
const DM: EntryViewer = { role: "dm", campaignId: "camp", playerId: null };
const PLAYER: EntryViewer = { role: "player", campaignId: "camp", playerId: "p" };

interface Seed {
  id: string;
  name: string;
  text?: string;
  kind?: "condition" | "feature";
  /** Imported source key; absent = homebrew of "camp". */
  source?: string;
  className?: string;
  shared?: boolean;
}

function seed(rows: Seed[]) {
  const db = openTestDb();
  db.insert(campaign)
    .values({ id: "camp", name: "Camp", active: true, createdAt: AT, updatedAt: AT })
    .run();
  for (const key of new Set(rows.flatMap((r) => (r.source ? [r.source] : [])))) {
    db.insert(compendiumSource)
      .values({
        key,
        name: key === "srd-5.1" ? "SRD 5.1" : key,
        licence: "CC BY 4.0",
        attribution: "a",
        url: null,
        version: "v",
        importedAt: AT,
        counts: {},
      })
      .run();
  }
  for (const r of rows) {
    const nameKey = entryNameKey(r.name);
    const line = r.className ? `${r.className} · 4th level` : "Condition";
    db.insert(compendiumEntry)
      .values({
        id: r.id,
        campaignId: r.source ? null : "camp",
        kind: r.kind ?? "condition",
        source: r.source ?? null,
        sourceKey: r.source ? `x/${r.id}` : null,
        name: r.name,
        nameKey,
        line,
        facets: r.className ? { className: r.className, level: 4 } : {},
        body: { text: r.text ?? "" },
        searchText: `${nameKey}\n${line.toLowerCase()}\n${(r.text ?? "").toLowerCase()}`,
        dataHash: r.id,
        definitionId: null,
        shared: r.shared ?? true,
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
const ids = (r: { results: { id: string }[] }) => r.results.map((x) => x.id);

describe("FR-CMP-33 search ranking", () => {
  test("FR-CMP-10 FR-CMP-33 tiers 0–5 over the index; AND words in any order; ties by source rank, shorter name, name, id", () => {
    const db = seed([
      { id: "e1", name: "Hobgoblin", source: "srd-5.1" },
      { id: "e2", name: "Goblin Boss", source: "srd-5.1" },
      { id: "e3", name: "Elite Goblin", source: "srd-5.1" },
      { id: "e4", name: "Ogre", text: "Often keeps goblins as slaves.", source: "srd-5.1" },
      { id: "e5", name: "Goblin", source: "srd-5.1" },
      { id: "e6", name: "goblin", kind: "feature", source: "fixture" },
      { id: "e7", name: "Goblin" },
      { id: "e8", name: "Goblin", source: "open5e-x" },
      { id: "e9", name: "Wolf" },
    ]);
    const r = searchEntries(db, DM, q({ q: "  GOBLIN " }));
    // Tier 0 (homebrew, SRD, other import, fixture), tier 1, tier 2, tier 3, tier 5 (text).
    expect(ids(r)).toEqual(["e7", "e5", "e8", "e6", "e2", "e3", "e1", "e4"]);
    expect(r.nextCursor).toBeNull();
    // "gob" is a prefix: every Goblin is tier 1; the text tier needs ≥ 3 chars per word.
    expect(names(searchEntries(db, DM, q({ q: "gob" })))).toContain("Ogre");
    expect(names(searchEntries(db, DM, q({ q: "go" })))).not.toContain("Ogre");
    // Word order never matters; every word must match.
    expect(ids(searchEntries(db, DM, q({ q: "boss goblin" })))).toEqual(["e2"]);
    expect(ids(searchEntries(db, DM, q({ q: "goblin boss" })))).toEqual(["e2"]);
    expect(searchEntries(db, DM, q({ q: "goblin zzz" })).results).toEqual([]);
    // Empty q (FR-CMP-36): by folded name, then source rank, then id; duplicates grouped.
    const all = searchEntries(db, DM, q({}));
    expect(names(all)[0]).toBe("Elite Goblin");
    expect(searchEntries(db, DM, q({ q: "%" })).results).toHaveLength(all.results.length);
  });

  test("FR-CMP-10 FR-CMP-33 cursor: ≤ 50 per page, pages join to the full order without repeats; tuple round-trip; tamper → invalid", () => {
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
    for (const bad of [
      "not-base64!",
      encodeCursor([0, 1, 2, "x", "y"]).slice(2),
      "W10",
      encodeCursor([6, 0, 0, "x", "y"] as unknown as Parameters<typeof encodeCursor>[0]),
      Buffer.from(JSON.stringify([0, "x", "y"])).toString("base64url"),
    ]) {
      expect(() => searchEntries(db, DM, q({ cursor: bad }))).toThrow(CommandError);
    }
    expect(decodeCursor(encodeCursor([2, 1, 6, "goblin", "b"]))).toEqual([2, 1, 6, "goblin", "b"]);
  });

  test("FR-CMP-35 groups: same kind + folded name + source collapse (≥ 2 matching visible); id = best member; sameAs lists exactly count rows; pages never split a group", () => {
    const classes = ["Wizard", "Bard", "Fighter", "Barbarian", "Cleric"];
    const db = seed([
      ...classes.map((c, i) => ({
        id: `asi${i}`,
        name: "Ability Score Improvement",
        kind: "feature" as const,
        source: "srd-5.1",
        className: c,
        text: c === "Fighter" ? "fighters gain more" : "",
      })),
      { id: "x1", name: "Ability Drain", kind: "feature", source: "srd-5.1", className: "Monk" },
      { id: "h1", name: "Extra Attack", kind: "feature", className: "Fighter" },
      // Homebrew names are unique per campaign by `nameKey`; "Extra-Attack" folds the same.
      { id: "h2", name: "Extra-Attack", kind: "feature", className: "Monk", shared: false },
      { id: "s1", name: "Extra Attack", kind: "feature", source: "srd-5.1", className: "Ranger" },
    ]);
    const r = searchEntries(db, DM, q({ q: "ability" }));
    expect(r.results.map((x) => [x.id, x.group?.count, x.line])).toEqual([
      ["x1", undefined, "Monk · 4th level"],
      ["asi0", 5, "5 entries · Barbarian, Bard, Cleric, Fighter, Wizard"],
    ]);
    const members = searchEntries(db, DM, q({ sameAs: "asi3", q: "ability" }));
    expect(members.results.map((m) => m.line)).toEqual([
      "Barbarian · 4th level",
      "Bard · 4th level",
      "Cleric · 4th level",
      "Fighter · 4th level",
      "Wizard · 4th level",
    ]);
    expect(members.results.every((m) => m.group === undefined)).toBe(true);
    // Only the matching members count; one match → a plain row.
    const fighter = searchEntries(db, DM, q({ q: "ability fighter" }));
    expect(fighter.results.map((x) => [x.id, x.group])).toEqual([["asi2", undefined]]);
    expect(ids(searchEntries(db, DM, q({ sameAs: "asi0", q: "ability fighter" })))).toEqual([
      "asi2",
    ]);
    // Homebrew groups per campaign; different sources never group. The player's hidden
    // member is not counted, so the player's homebrew row is plain.
    const dmExtra = searchEntries(db, DM, q({ q: "extra attack" }));
    expect(dmExtra.results.map((x) => [x.id, x.group?.count])).toEqual([
      ["h1", 2],
      ["s1", undefined],
    ]);
    const pExtra = searchEntries(db, PLAYER, q({ q: "extra attack" }));
    expect(pExtra.results.map((x) => [x.id, x.group?.count])).toEqual([
      ["h1", undefined],
      ["s1", undefined],
    ]);
    expect(ids(searchEntries(db, PLAYER, q({ sameAs: "h1" })))).toEqual(["h1"]);
    // Unknown or hidden id → empty page, never an error.
    expect(searchEntries(db, PLAYER, q({ sameAs: "h2" })).results).toEqual([]);
    expect(searchEntries(db, DM, q({ sameAs: "nope" })).results).toEqual([]);
    // Page size 2 over the default list: the group row once, no repeat, no skip.
    const joined: string[] = [];
    let cursor: string | undefined;
    do {
      const p = searchEntries(db, DM, q(cursor ? { cursor } : {}), 2);
      joined.push(...ids(p));
      cursor = p.nextCursor ?? undefined;
    } while (cursor);
    expect(joined).toEqual(ids(searchEntries(db, DM, q({}))));
    expect(joined).toEqual(["x1", "asi0", "h1", "s1"]);
  });

  test("FR-CMP-35 group line: features list distinct classes, ≤ 80 chars with …; other kinds the count only", () => {
    const db = seed(
      ["Barbarian", "Bard", "Cleric", "Druid", "Fighter", "Monk", "Paladin", "Ranger", "Rogue"].map(
        (c, i) => ({
          id: `f${i}`,
          name: "Spellcasting",
          kind: "feature",
          className: c,
          source: "srd-5.1",
        }),
      ),
    );
    const line = groupLine(buildSearchIndex(db).rows);
    expect(line.length).toBeLessThanOrEqual(80);
    expect(line).toStartWith("9 entries · Barbarian, Bard, Cleric");
    expect(line).toEndWith("…");
    const conds = seed([
      { id: "c1", name: "Dazed", source: "srd-5.1" },
      { id: "c2", name: "Dazed", source: "srd-5.1" },
    ]);
    expect(groupLine(buildSearchIndex(conds).rows)).toBe("2 entries");
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

  test("FR-CMP-35 sameAs takes q only: kind, cursor or a filter with it → invalid", () => {
    expect(SearchQuery.safeParse({ sameAs: "e1" }).success).toBe(true);
    expect(SearchQuery.safeParse({ sameAs: "e1", q: "fighter" }).success).toBe(true);
    for (const bad of [
      { sameAs: "e1", kind: "feature" },
      { sameAs: "e1", cursor: "abc" },
      { sameAs: "e1", kind: "feature", className: "Fighter" },
      { sameAs: "" },
    ]) {
      expect({ bad, ok: SearchQuery.safeParse(bad).success }).toEqual({ bad, ok: false });
    }
  });
});
