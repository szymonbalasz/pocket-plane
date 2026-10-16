// FR-CMP-17: lookups merge store rows (customs, characters) with the server's imported monsters,
// in FR-ENT-18 order, ranked by FR-CBT-63 (≤ 8); rows keep their shape, ids are definitions.
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
  test("FR-CMP-17 lookup merge: imported rows use the definition id; customs before imported on equal names; FR-CBT-63 tiers; ≤ 8", () => {
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
  });
});
