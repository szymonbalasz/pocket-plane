// FR-CMP-54 one matcher (FR-CMP-32 / -33 / -37 unit): fold, query words, plural fallback, tiers 0–5.
// `sourceRank` stays in `@shared/compendium` (its own test there).
import { describe, expect, test } from "bun:test";
import { fold, foldName, nameTier, queryWords, searchTier, textWordsOf, wordForms } from "./match";

const tier = (name: string, text: string, q: string) =>
  searchTier(foldName(name), textWordsOf(`${name}\n${text}`), queryWords(q));

describe("FR-CMP-32 fold and words", () => {
  test("FR-CMP-32 fold: case, accents, apostrophes, punctuation runs; words deduplicated, first 8; plural fallback ≥ 4 chars", () => {
    for (const q of ["hunters mark", "HUNTER'S MARK", "hunter’s mark", "  Hunter's   Mark "]) {
      expect(fold(q)).toBe("hunters mark");
      expect(nameTier("Hunter's Mark", queryWords(q))).toBe(0);
    }
    expect(fold("Mordenkainén's Sword")).toBe("mordenkainens sword");
    expect(nameTier("Mordenkainén's Sword", queryWords("mordenkainen"))).toBe(1);
    expect(queryWords("potion   heal")).toEqual(["potion", "heal"]);
    expect(queryWords('"potion" -heal')).toEqual(["potion", "heal"]);
    expect(queryWords("heal heal HEAL")).toEqual(["heal"]);
    expect(queryWords("a b c d e f g h i")).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
    expect(queryWords(" -- ' ")).toEqual([]);
    expect(fold("Cure Wounds (house)")).toBe("cure wounds house");
    expect(fold("1d6+2 fire")).toBe("1d6 2 fire");
    expect(wordForms("potions")).toEqual(["potions", "potion"]);
    expect(wordForms("gas")).toEqual(["gas"]);
    expect(nameTier("Potion of Healing", queryWords("potions"))).toBe(2);
    expect(nameTier("Gas Spore", queryWords("gas"))).toBe(1);
    expect(nameTier("Ga Spore", queryWords("gas"))).toBeNull();
  });
});

describe("FR-CMP-33 tiers", () => {
  test("FR-CMP-33 tiers: one case per tier 0–5; every word must match; 'a' never reaches the text tier", () => {
    expect(tier("Hunter's Mark", "", "hunters mark")).toBe(0);
    expect(tier("Cure Wounds", "", "cure wound")).toBe(1);
    expect(tier("Fireball", "", "fire")).toBe(1);
    expect(tier("Potion of Healing", "", "heal potion")).toBe(2);
    expect(tier("Mass Cure Wounds", "", "cure wound")).toBe(2);
    expect(tier("Hobgoblin", "", "goblin")).toBe(3);
    expect(tier("Hobgoblin Captain", "", "goblin cap")).toBe(3);
    expect(tier("Potion of Poison", "you regain no hit points, heal", "potion heal")).toBe(4);
    expect(tier("Healing Draught", "a potion that heals 2d4 + 2", "potion heal")).toBe(4);
    expect(tier("Robe of Useful Items", "a potion of healing patch", "potion heal")).toBe(5);
    expect(tier("Worg", "speaks goblin and worg", "goblin")).toBe(5);
    // AND: one word missing everywhere → no match.
    expect(tier("Potion of Healing", "drink it", "potion zzz")).toBeNull();
    // Text words need ≥ 3 chars per word: "a" matches names only.
    expect(tier("Ogre Mage", "a large giant", "a")).toBe(3);
    expect(tier("Wolf", "a beast", "a")).toBeNull();
    expect(tier("Aid", "", "a")).toBe(1);
    // Text match is a word prefix, not a substring.
    expect(tier("Wolf", "hobgoblins", "goblin")).toBeNull();
    // Plural fallback reaches the text tier, never tiers 0–1.
    expect(tier("Bag", "holds potions", "potions")).toBe(5);
    expect(tier("Potion", "", "potions")).toBe(2);
    expect(nameTier("Anything", [])).toBeNull();
    expect(searchTier(foldName("Anything"), [], [])).toBeNull();
  });
});

describe("FR-CMP-54 one matcher", () => {
  test('FR-CMP-54 one matcher: "Gob el" finds Elite Goblin (tier 2), not Hobgoblin Captain (FR-ASSET-44 case)', () => {
    for (const q of ["Gob el", "el gob", "GOB EL", "gob   el"]) {
      expect(nameTier("Elite Goblin", queryWords(q))).toBe(2);
      expect(nameTier("Goblin Elder", queryWords(q))).toBe(2);
      expect(nameTier("Hobgoblin Captain", queryWords(q))).toBeNull();
    }
    // FR-ASSET-44's form: name words plus tag words through `searchTier`.
    const words = queryWords("Gob el");
    expect(searchTier(foldName("Elite Goblin"), textWordsOf("Tokens Monsters"), words)).toBe(2);
    expect(searchTier(foldName("token-elite"), textWordsOf("Tokens"), words)).toBeNull();
  });
});
