import { describe, expect, test } from "bun:test";
import { queryWords } from "../search/match";
import {
  linkText,
  NOTE_SEARCH_Q_MAX,
  NOTE_SNIPPET_MARKS_MAX,
  NOTE_SNIPPET_MAX,
  NoteSearchQuery,
  NoteSearchResponse,
  noteSnippet,
} from "./search";

const snip = (text: string, q: string) => noteSnippet(text, queryWords(q)).snippet;
/** The marked words of the snippet for `q`. */
const marked = (text: string, q: string) => {
  const r = noteSnippet(text, queryWords(q));
  return r.marks.map(([a, b]) => r.snippet.slice(a, b));
};

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
  });

  test("FR-NOTES-22 links read as their chips: the label, else the title", () => {
    expect(linkText("See [[Quest log]] and [[Burnt Ledger|the ledger]].")).toBe(
      "See Quest log and the ledger.",
    );
    expect(linkText("[[Duke Varen|]] [[not a link] [[a|b|c]]")).toBe(
      "Duke Varen [[not a link] b|c",
    );
    expect(snip("Keeps [[Burnt Ledger|the ledger]] close.", "ledger")).toBe(
      "Keeps the ledger close.",
    );
    expect(snip("Found in [[Duke Varen]]'s office.", "office")).toBe(
      "Found in Duke Varen's office.",
    );
  });

  test("FR-NOTES-22 the matching words are marked: every word a query word starts", () => {
    expect(marked("The dragon and the Dragons' hoard; undragon.", "dragons hoard")).toEqual([
      "dragon",
      "Dragons'",
      "hoard",
    ]);
    expect(marked("Café noir, CAFÉS", "cafe")).toEqual(["Café", "CAFÉS"]);
    // Words under 3 letters never match a body, so never marked.
    expect(marked("an ox and an ant", "an ant")).toEqual(["ant"]);
    const many = noteSnippet("x ".concat("gold ".repeat(40)), queryWords("gold"));
    expect(many.marks).toHaveLength(NOTE_SNIPPET_MARKS_MAX);
  });

  test("FR-NOTES-22 a title-only match shows the body's first line, plainly", () => {
    // "Duke Varen" found by its title; its body never says "duke".
    const r = noteSnippet(
      "\n  \nKeeps [[Burnt Ledger|the ledger]]  close.\nMore",
      queryWords("duke"),
    );
    expect(r).toEqual({ snippet: "Keeps the ledger close.", marks: [] });
    // `ledger` is inside `unledgered`, not at a word start: no body hit.
    expect(noteSnippet("unledgered goods\nmore", queryWords("ledger"))).toEqual({
      snippet: "unledgered goods",
      marks: [],
    });
    // A long first line is cut on a space.
    const long = snip(`${"word ".repeat(60)}\nsecond`, "duke");
    expect(long.endsWith("…")).toBe(true);
    expect(long.length).toBeLessThanOrEqual(NOTE_SNIPPET_MAX + 1);
    expect(snip("ab cd ef", "ab")).toBe("ab cd ef");
  });

  test("FR-NOTES-22 an empty body has an empty snippet", () => {
    expect(noteSnippet("", queryWords("x"))).toEqual({ snippet: "", marks: [] });
    expect(snip("  \n ", "x")).toBe("");
  });

  test("FR-NOTES-22 a word after punctuation-only and mark-only runs is still found", () => {
    const text = `${"x ".repeat(60)}' ’ -- ́ then CANARY here`;
    expect(snip(text, "canary")).toContain("CANARY here");
    expect(marked(text, "canary")).toEqual(["CANARY"]);
  });
});

describe("FR-NOTES-22 REST shapes", () => {
  test("FR-NOTES-22 the query is `q` only, at most 100 characters", () => {
    expect(NoteSearchQuery.safeParse({ q: "a".repeat(NOTE_SEARCH_Q_MAX) }).success).toBe(true);
    expect(NoteSearchQuery.safeParse({ q: "a".repeat(NOTE_SEARCH_Q_MAX + 1) }).success).toBe(false);
    expect(NoteSearchQuery.safeParse({ q: "a", kind: "x" }).success).toBe(false);
  });

  test("FR-NOTES-22 at most 50 results", () => {
    const hit = { id: "n", title: "t", snippet: "", marks: [] };
    expect(NoteSearchResponse.safeParse({ results: Array(50).fill(hit), more: true }).success).toBe(
      true,
    );
    expect(NoteSearchResponse.safeParse({ results: Array(51).fill(hit), more: true }).success).toBe(
      false,
    );
  });
});
