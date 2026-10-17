import { describe, expect, test } from "bun:test";
import { LOOKUP_MAX, lookupMatches, noMatchText } from "./lookup";

// FR-ENT-18 order (as `creatureRows` returns them).
const rows = [
  "Bugbear",
  "Dire Wolf",
  "Elite Goblin Warrior",
  "Goblin",
  "Goblin Boss",
  "Hobgoblin",
  "Wolf",
  "Worg",
].map((name, i) => ({ id: `id-${i}`, name }));
const names = (q: string) => lookupMatches(rows, q).map((r) => r.name);

describe("FR-CBT-63 lookup", () => {
  test("FR-CBT-63 FR-CMP-37 multi-word tiers (exact, starts, every word starts a word, inside); ties in rows' order", () => {
    expect(names("gob")).toEqual(["Goblin", "Goblin Boss", "Elite Goblin Warrior", "Hobgoblin"]);
    expect(names("wo")).toEqual(["Wolf", "Worg", "Dire Wolf"]);
    expect(names("WOLF")).toEqual(["Wolf", "Dire Wolf"]);
    // Every word must match, in any order; folded (case, apostrophes, punctuation).
    expect(names("wolf dire")).toEqual(["Dire Wolf"]);
    expect(names("goblin boss")).toEqual(["Goblin Boss"]);
    expect(names("boss gob")).toEqual(["Goblin Boss"]);
    expect(names("gob war")).toEqual(["Elite Goblin Warrior"]);
    expect(names("gob zzz")).toEqual([]);
    expect(names("lin")).toEqual(["Elite Goblin Warrior", "Goblin", "Goblin Boss", "Hobgoblin"]);
    expect(names("DIRE-wolf")).toEqual(["Dire Wolf"]);
  });

  test("FR-CBT-63 empty input → no list; at most 8; no match text", () => {
    expect(names("")).toEqual([]);
    expect(names("   ")).toEqual([]);
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `${i}`, name: `Goblin ${i}` }));
    expect(lookupMatches(many, "g")).toHaveLength(LOOKUP_MAX);
    expect(names("zzz")).toEqual([]);
    expect(noMatchText(" zzz ")).toBe("No creature matches ‘zzz’");
  });
});
