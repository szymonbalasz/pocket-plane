import { describe, expect, test } from "bun:test";
import { findNotation, splitNotation } from "./notation";

const exprs = (text: string) => findNotation(text).map((m) => m.expression);

describe("FR-DICEX-28 notation parser", () => {
  test.each([
    ["1d12+5", "1d12+5"],
    ["1d12 + 5", "1d12+5"],
    ["1d12 +5", "1d12+5"],
    ["1D12+5", "1d12+5"],
    ["d20", "1d20"],
    ["7 (2d6 + 3) slashing", "2d6+3"],
    ["2d6 − 1", "2d6-1"],
    ["2d6 – 1", "2d6-1"],
    ["4d6kh3", "4d6kh3"],
    ["2d20kl1+5", "2d20kl1+5"],
    ["4D6KH3", "4d6kh3"],
    ["1d6+1d4+2", "1d6+1d4+2"],
    ["1d6 +", "1d6"],
    ["1d6+3days", "1d6"],
    ["1d6+3.", "1d6+3"],
    ["1d6\n+ 2", "1d6"],
    ["1d6\t+\t2", "1d6+2"],
    ["Greataxe 1d12 + 5 slashing", "1d12+5"],
    ["-1d6", "1d6"],
  ])("%p → %p (one match)", (text, expression) => {
    expect(exprs(text)).toEqual([expression]);
  });

  test("two matches: 1d8 plus 1d6", () => {
    expect(exprs("1d8 plus 1d6")).toEqual(["1d8", "1d6"]);
  });

  test.each([
    "51d6",
    "1d1",
    "0d6",
    "1d1001",
    "2d6/2",
    "2d6 / 2",
    "2d6*2",
    "2d6×2",
    "4d6x2",
    "abc1d6",
    "2d6x",
    "1 d 6",
    "+5 to hit",
    "d%",
    "1d6kh",
    "x1d6",
    "1d6_",
    "11d6d",
  ])("not matched: %p", (text) => {
    expect(findNotation(text)).toEqual([]);
  });

  test("over the FR-DICE-01 limits stays text: > 10 terms, > 60 chars", () => {
    expect(findNotation(Array(11).fill("1d6").join("+"))).toEqual([]);
    const long = Array(10).fill("1d1000").join("+");
    expect(long.length).toBeGreaterThan(60);
    expect(findNotation(long)).toEqual([]);
    expect(exprs(Array(10).fill("1d6").join("+"))).toEqual([Array(10).fill("1d6").join("+")]);
  });

  test("positions are exact", () => {
    const text = "Hit: 7 (2d6 − 1). Second Wind d10+1.";
    const ms = findNotation(text);
    expect(ms.map((m) => text.slice(m.start, m.end))).toEqual(["2d6 − 1", "d10+1"]);
    expect(ms.map((m) => m.expression)).toEqual(["2d6-1", "1d10+1"]);
  });

  test("the notation fixture text: links and plain text (walkthrough step 2)", () => {
    const text =
      "Greataxe 1d12 + 5 slashing. Second Wind d10+1. Hit: 7 (2d6 − 1). Adv: 1d20+3. Not dice: 51d6, 1d1, 2d6/2, 4d6x2, abc1d6.";
    expect(exprs(text)).toEqual(["1d12+5", "1d10+1", "2d6-1", "1d20+3"]);
  });

  test("splitNotation keeps every character, in order", () => {
    const text = "Roll 1d12 + 5 then d6.";
    const parts = splitNotation(text);
    expect(parts.map((p) => p.text).join("")).toBe(text);
    expect(parts.filter((p) => p.expression).map((p) => p.expression)).toEqual(["1d12+5", "1d6"]);
    expect(splitNotation("")).toEqual([]);
  });

  // "a 4,000-char note parses in < 1 ms": ./notation.bench.ts (`bun run bench`).
});
