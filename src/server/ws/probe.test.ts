import { afterEach, expect, test } from "bun:test";
import { startTestServer, type TestServer } from "../testing/harness";

let h: TestServer;
afterEach(async () => {
  await h?.stop();
});

test("FR-SYNC-05 reconnect probe: GET /ws?probe=1 → 204, no body, no auth; plain GET /ws stays 426", async () => {
  h = await startTestServer();
  const probe = await fetch(`${h.http}/ws?probe=1`);
  expect(probe.status).toBe(204);
  expect(probe.headers.get("cache-control")).toBe("no-store");
  expect(await probe.text()).toBe("");

  const plain = await fetch(`${h.http}/ws`);
  expect(plain.status).toBe(426);
  await plain.text();

  // The WS upgrade on the same path is unaffected.
  const c = await h.connect(null);
  expect(c.isClosed()).toBe(false);
});
