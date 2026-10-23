// FR-CMP-23 (SP2 re-test step 12): the DM's own homebrew writes refetch the Rules window at once,
// from any window: a put or delete through `homebrew-rest` bumps the Rules nonce; a failed write
// doesn't.
import { expect, test } from "bun:test";
import type { AppType } from "@server/app";
import type { Api } from "@ui/api";
import { rulesNav } from "@ui/features/compendium/rules/nav";
import { hc } from "hono/client";
import { deleteEntry, putEntry } from "./homebrew-rest";

const apiAnswering = (status: number, body: unknown): Api =>
  hc<AppType>("http://127.0.0.1:1", {
    fetch: (async () =>
      new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch,
  }) as Api;

test("FR-CMP-23 a Compendium delete or save of a house rule refetches the Rules window at once; a rejected write doesn't", async () => {
  const nonce = () => rulesNav.getState().nonce;
  const start = nonce();
  await deleteEntry(apiAnswering(204, null), "e-flanking");
  expect(nonce()).toBe(start + 1);
  await putEntry(apiAnswering(201, { entryId: "e-new" }), null, {
    entry: {
      kind: "rule",
      name: "Surprise rounds",
      facets: { chapter: "House rules", section: "", order: 0 },
      body: { text: "t" },
    },
    shared: false,
    derivedFromId: null,
    imageAssetIds: [],
  });
  expect(nonce()).toBe(start + 2);
  await expect(
    deleteEntry(apiAnswering(404, { code: "not_found", message: "Entry not found" }), "x"),
  ).rejects.toThrow();
  expect(nonce()).toBe(start + 2);
});
