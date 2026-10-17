// FR-CMP-35 client: an expanded group's members are one `sameAs` search with the list's q (no
// kind, filters or cursor), parsed by the shared response schema.
import { describe, expect, test } from "bun:test";
import type { AppType } from "@server/app";
import type { EntrySummary } from "@shared/compendium/rest";
import { hc } from "hono/client";
import type { Api } from "../../api";
import { fetchGroupMembers } from "./fetch";

const member = (id: string, line: string): EntrySummary => ({
  id,
  kind: "feature",
  name: "Ability Score Improvement",
  sourceLabel: "SRD 5.1",
  line,
});

function fakeApi(results: EntrySummary[]) {
  const urls: URL[] = [];
  const fetch = (async (input: RequestInfo | URL) => {
    urls.push(new URL(input instanceof Request ? input.url : String(input)));
    return Response.json({ results, nextCursor: null });
  }) as typeof globalThis.fetch;
  return { api: hc<AppType>("http://127.0.0.1:1", { fetch }) as Api, urls };
}

describe("FR-CMP-35 group members", () => {
  test("FR-CMP-35 members: GET /search?sameAs=<id>[&q] only; the page's rows in the server's order", async () => {
    const rows = [
      member("asi-barbarian", "Barbarian · 4th level"),
      member("asi-bard", "Bard · 4th level"),
    ];
    const { api, urls } = fakeApi(rows);
    expect(await fetchGroupMembers(api, "asi-barbarian", " ")).toEqual(rows);
    expect(await fetchGroupMembers(api, "asi-barbarian", "ability score")).toEqual(rows);
    expect(urls.map((u) => u.pathname)).toEqual([
      "/api/compendium/search",
      "/api/compendium/search",
    ]);
    expect(Object.fromEntries(urls[0]?.searchParams ?? [])).toEqual({ sameAs: "asi-barbarian" });
    expect(Object.fromEntries(urls[1]?.searchParams ?? [])).toEqual({
      sameAs: "asi-barbarian",
      q: "ability score",
    });
  });
});
