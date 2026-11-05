import { describe, expect, test } from "bun:test";
import { queryWords } from "../search/match";
import {
  NOTE_SEARCH_Q_MAX,
  NOTE_SNIPPET_MAX,
  NoteSearchQuery,
  NoteSearchResponse,
  noteSnippet,
} from "./search";

const snip = (text: string, q: string) => noteSnippet(text, queryWords(q));

describe("FR-NOTES-22 snippet", () => {
  test("FR-NOTES-22 a short body is the whole snippet, whitespace collapsed", () => {
    expect(snip("Found in the\n\n  office.", "office")).toBe("Found in the office.");
  });

  test("FR-NOTES-22 the snippet starts a little before the first matching word, on a space", () => {
    const text = `${"lorem ipsum ".repeat(30)}the dragon sleeps under the hill ${"dolor sit ".repeat(30)}`;
    const s = snip(text, "dragon");
    expect(s.startsWith("…")).toBe(true);
    expect(s.endsWith("…")).toBe(true);
    expect(s).toContain("the dragon sleeps");
    expect(s.indexOf("dragon")).toBeLessThan(50);
    // Cut on words: no half word at either end.
    expect(
      s
        .slice(1, -1)
        .split(" ")
        .every((w) => w === "" || /^(lorem|ipsum|dolor|sit|the|dragon|sleeps|under|hill)$/.test(w)),
    ).toBe(true);
    expect(s.length).toBeLessThanOrEqual(NOTE_SNIPPET_MAX + 2);
  });

  test("FR-NOTES-22 matches as the shared matcher does: word starts, plurals, folding", () => {
    const pad = "word ".repeat(40);
    expect(snip(`${pad}Hunter's Mark here`, "hunters")).toContain("Hunter's Mark");
    expect(snip(`${pad}two potion bottles`, "potions")).toContain("potion bottles");
    expect(snip(`${pad}Café Noir is open`, "cafe")).toContain("Café Noir");
    // `ledger` is inside `unledgered`, not at a word start: the body's start is shown.
    expect(snip(`${pad}unledgered`, "ledger").startsWith("word")).toBe(true);
  });

  test("FR-NOTES-22 a title-only match (or a short word) shows the body's start", () => {
    expect(snip("Keeps it close. ".repeat(20), "duke").startsWith("Keeps it close.")).toBe(true);
    expect(snip("ab cd ef", "ab")).toBe("ab cd ef");
  });

  test("FR-NOTES-22 an empty body has an empty snippet", () => {
    expect(snip("", "x")).toBe("");
    expect(snip("  \n ", "x")).toBe("");
  });

  test("FR-NOTES-22 a word after punctuation-only and mark-only runs is still found", () => {
    const text = `${"x ".repeat(60)}' ’ -- ́ then CANARY here`;
    expect(snip(text, "canary")).toContain("CANARY here");
  });
});

describe("FR-NOTES-22 REST shapes", () => {
  test("FR-NOTES-22 the query is `q` only, at most 100 characters", () => {
    expect(NoteSearchQuery.safeParse({ q: "a".repeat(NOTE_SEARCH_Q_MAX) }).success).toBe(true);
    expect(NoteSearchQuery.safeParse({ q: "a".repeat(NOTE_SEARCH_Q_MAX + 1) }).success).toBe(false);
    expect(NoteSearchQuery.safeParse({ q: "a", kind: "x" }).success).toBe(false);
  });

  test("FR-NOTES-22 at most 50 results", () => {
    const hit = { id: "n", title: "t", snippet: "" };
    expect(NoteSearchResponse.safeParse({ results: Array(50).fill(hit), more: true }).success).toBe(
      true,
    );
    expect(NoteSearchResponse.safeParse({ results: Array(51).fill(hit), more: true }).success).toBe(
      false,
    );
  });
});
