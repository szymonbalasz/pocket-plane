// FR-CMP-10 client: `searchCompendium` takes an `ApiSource` told apart by its tag, never by
// `typeof`: a Hono client is a callable proxy (`typeof` "function"), so a typeof check would
// call it as a loader.
import { describe, expect, test } from "bun:test";
import type { AppType } from "@server/app";
import { hc } from "hono/client";
import type { Api } from "../../api";
import { eagerApi, lazyApi, resolveApi } from "./search";

describe("FR-CMP-10 search client source", () => {
  test("FR-CMP-10 a Hono client (a callable proxy) resolves as itself; a loader is awaited", async () => {
    const client = hc<AppType>("http://127.0.0.1:1") as Api;
    expect(typeof client).toBe("function");
    expect(await resolveApi(eagerApi(client))).toBe(client);
    let loads = 0;
    const lazy = lazyApi(async () => {
      loads++;
      return client;
    });
    expect(await resolveApi(lazy)).toBe(client);
    expect(loads).toBe(1);
  });
});
