// FR-CMP-17 / -37: lookups merge store rows (customs, characters) with the server's imported
// monsters: shared name tier, then store before imported, then the server's order (≤ 8); rows
// keep their shape, ids are definitions.
import { describe, expect, test } from "bun:test";
import type { EntrySummary } from "@shared/compendium/rest";
import type { LookupRow } from "../combat-tracker/lookup";
import { IMPORTED_BADGE, importedLookupRows, mergeLookup } from "./lookup";

const custom = (id: string, name: string): LookupRow => ({
  id,
  name,
  cr: "1/2",
  xp: 100,
  badge: "Custom",
});
const summary = (
  id: string,
  name: string,
  kind: EntrySummary["kind"] = "monster",
): EntrySummary => ({
  id: `entry-${id}`,
  kind,
  name,
  sourceLabel: "SRD 5.1",
  line: "CR 1/4 · Small humanoid",
  ...(kind === "monster" ? { definitionId: id } : {}),
});

describe("FR-CMP-17 creature lookup", () => {
  test("FR-CMP-17 FR-CMP-37 lookup merge: imported rows use the definition id; tier, then store before imported, then the server's order; ≤ 8", () => {
    const imported = importedLookupRows([
      summary("def-gob", "Goblin"),
      summary("def-hob", "Hobgoblin"),
      summary("def-boss", "Goblin Boss"),
      summary("x", "Fireball", "spell"),
    ]);
    expect(imported.map((r) => [r.id, r.badge, r.cr])).toEqual([
      ["def-gob", IMPORTED_BADGE, null],
      ["def-hob", IMPORTED_BADGE, null],
      ["def-boss", IMPORTED_BADGE, null],
    ]);
    // An entryless fixture definition (sourceLabel = its source key) reads "Fixture", not "SRD".
    expect(
      importedLookupRows([{ ...summary("fx", "Wolf"), sourceLabel: "fixture" }])[0]?.badge,
    ).toBe("Fixture");
    const store = [custom("c-gob", "goblin"), custom("c-elite", "Elite Goblin")];
    expect(mergeLookup(store, imported, "gob").map((r) => r.id)).toEqual([
      "c-gob", // prefix, custom first on the same name
      "def-gob",
      "def-boss",
      "c-elite", // word start
      "def-hob", // substring
    ]);
    // A server row already held in the store (same id) appears once, as the store row.
    const dup = mergeLookup([custom("def-gob", "Goblin")], imported, "goblin");
    expect(dup.filter((r) => r.id === "def-gob")).toHaveLength(1);
    expect(dup[0]?.badge).toBe("Custom");
    const many = importedLookupRows(
      Array.from({ length: 20 }, (_, i) => summary(`d${i}`, `Wolf ${i}`)),
    );
    expect(mergeLookup([], many, "wo")).toHaveLength(8);
    expect(mergeLookup(store, imported, "")).toEqual([]);
    // Multi-word: every word must match a store or server row's name, any order.
    expect(mergeLookup(store, imported, "boss gob").map((r) => r.id)).toEqual(["def-boss"]);
    expect(mergeLookup(store, imported, "goblin elite").map((r) => r.id)).toEqual(["c-elite"]);
    // A server row matching on its text only (no name tier) is not a suggestion.
    const worg = importedLookupRows([summary("def-worg", "Worg")]);
    expect(mergeLookup([], worg, "goblin")).toEqual([]);
  });

  test("FR-CMP-38 SRD Goblin above fixture Goblin in the lookup merge (server order kept on equal tiers)", () => {
    const fromServer = importedLookupRows([
      summary("srd-gob", "Goblin"),
      { ...summary("fx-gob", "Goblin"), sourceLabel: "fixture" },
      summary("srd-hob", "Hobgoblin"),
    ]);
    // "a-…" would sort first by id; the server's order (source rank) wins.
    const store = [custom("a-sneak", "Goblin Sneak")];
    expect(mergeLookup(store, fromServer, "gob").map((r) => [r.id, r.badge])).toEqual([
      ["a-sneak", "Custom"],
      ["srd-gob", "SRD"],
      ["fx-gob", "Fixture"],
      ["srd-hob", "SRD"],
    ]);
    expect(mergeLookup(store, fromServer, "goblin").map((r) => r.id)).toEqual([
      "srd-gob",
      "fx-gob",
      "a-sneak",
      "srd-hob",
    ]);
  });
});
