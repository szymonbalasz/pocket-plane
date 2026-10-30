// BL-160: the inverted text index finds exactly what `searchTier` finds over `textWordsOf`.
import { describe, expect, test } from "bun:test";
import { compileQuery, foldName, queryWords, searchTier, textWordsOf } from "./match";
import { buildTextIndex, textMasks } from "./text-index";

const TEXTS = [
  "The goblin's potions",
  "goblin goblin goblin",
  "",
  "---",
  "Élan vital, l'esprit",
  "potion of healing",
  "zzz zzzz",
  "fire firebolt fireball",
  "aaa",
  "日本語 テキスト",
];

/** The documents whose text has each query word, through the index. */
function viaIndex(q: string): number[][] {
  const compiled = compileQuery(queryWords(q));
  return textMasks(buildTextIndex(TEXTS), compiled, TEXTS.length).map((m) =>
    m === null ? [] : TEXTS.flatMap((_, doc) => (m[doc] === 1 ? [doc] : [])),
  );
}

/** The same through `searchTier`, one word at a time on a name that never matches. */
function viaSearchTier(q: string): number[][] {
  const name = foldName("\u0001");
  return queryWords(q).map((w) =>
    TEXTS.flatMap((text, doc) => (searchTier(name, textWordsOf(text), [w]) === 5 ? [doc] : [])),
  );
}

describe("BL-160 text index", () => {
  test("BL-160 words are sorted, unique, as `textWordsOf`; a document is listed once per word", () => {
    const index = buildTextIndex(TEXTS);
    expect(index.words).toEqual(textWordsOf(TEXTS.join(" ")));
    const goblin = index.words.indexOf("goblin");
    expect(Array.from(index.docs.subarray(index.starts[goblin], index.starts[goblin + 1]))).toEqual(
      [1],
    );
    expect(index.starts.at(-1)).toBe(index.docs.length);
  });

  test("BL-160 prefixes, plural fallback, short words, first and last word, none: = `searchTier`", () => {
    for (const q of [
      "gob",
      "goblin",
      "goblins",
      "goblinss",
      "potions",
      "potion",
      "fire",
      "fireb",
      "fir",
      "fi",
      "a",
      "aa",
      "aaa",
      "aaaa",
      "zzz",
      "zzzz",
      "zzzzz",
      "elan",
      "Élan",
      "esprit",
      "lesprit",
      "日本語",
      "テキ",
      "the goblin xyzzy",
      "bass",
      "xyzzy",
    ]) {
      expect({ q, docs: viaIndex(q) }).toEqual({ q, docs: viaSearchTier(q) });
    }
    expect(viaIndex("potions")).toEqual([[0, 5]]);
    expect(viaIndex("fi")).toEqual([[]]);
  });

  test("BL-160 a word under `TEXT_MATCH_MIN` has no mask; an empty set of texts matches nothing", () => {
    const empty = buildTextIndex([]);
    expect(empty.words).toEqual([]);
    expect(textMasks(empty, compileQuery(["fi", "fire"]), 0)[0]).toBeNull();
    expect(textMasks(empty, compileQuery(["fire"]), 0)[0]).toEqual(new Uint8Array(0));
  });
});
