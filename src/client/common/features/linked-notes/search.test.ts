// FR-NOTES-22 client side (N4): the search request (path, query, credential header) and its
// parsed answer; which box contents search at all.
import { describe, expect, test } from "bun:test";
import type { AppType } from "@server/app";
import { hc } from "hono/client";
import { isSearch, searchNotes } from "./search";

describe("FR-NOTES-22 notes search client", () => {
  test("FR-NOTES-22 GET /api/notes/search?q= with the page's credential, answer parsed", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const answer = {
      results: [{ id: "n1", title: "Burnt Ledger", snippet: "Found in…", marks: [] }],
      more: false,
    };
    const api = hc<AppType>("http://127.0.0.1:1", {
      headers: { Authorization: "Player tok" },
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const req = new Request(input, init);
        seen.push({ url: req.url, auth: req.headers.get("Authorization") });
        return Response.json(answer);
      },
    });
    expect(await searchNotes(api, "burnt ledger")).toEqual(answer);
    expect(seen).toEqual([
      { url: "http://127.0.0.1:1/api/notes/search?q=burnt+ledger", auth: "Player tok" },
    ]);
  });

  test("FR-NOTES-22 a malformed answer is an error, not results", async () => {
    const api = hc<AppType>("http://127.0.0.1:1", {
      fetch: async () => Response.json({ results: [{ id: 1 }], more: false }),
    });
    await expect(searchNotes(api, "x")).rejects.toThrow();
  });

  test("FR-NOTES-22 only a query with a word searches; blanks and punctuation show the list", () => {
    expect(isSearch("ledger")).toBe(true);
    expect(isSearch(" a ")).toBe(true);
    expect(isSearch("")).toBe(false);
    expect(isSearch("  ")).toBe(false);
    expect(isSearch("' -- !")).toBe(false);
  });
});
