// Shared REST helper: errors a DM toast shows. A server dying mid-call reads as a lost
// connection (CAMP / SYNC wording), never the browser's raw "Failed to fetch".
import { describe, expect, test } from "bun:test";
import { ApiError, CONNECTION_LOST, call, NETWORK_STATUS } from "./api";

const res = (status: number, body: unknown) =>
  Promise.resolve({
    status,
    ok: status >= 200 && status < 300,
    json: () =>
      body === undefined ? Promise.reject(new SyntaxError("not json")) : Promise.resolve(body),
  });

async function errorOf(p: Promise<unknown>): Promise<ApiError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ApiError) return err;
    throw err;
  }
  throw new Error("resolved");
}

describe("call", () => {
  test("FR-CAMP-09 CAMP §11 server dies during a REST call (e.g. switch) → 'Connection lost — check …'", async () => {
    const err = await errorOf(call(Promise.reject(new TypeError("Failed to fetch"))));
    expect(err.status).toBe(NETWORK_STATUS);
    expect(err.message).toBe(CONNECTION_LOST);
    expect(err.message).toMatch(/^Connection lost — check .+ before trying again$/);
  });

  test("CAMP §11 gateway without a REST body (proxy / tunnel, server down) → connection lost", async () => {
    for (const status of [502, 503, 504]) {
      expect((await errorOf(call(res(status, undefined)))).message).toBe(CONNECTION_LOST);
    }
  });

  test("REST errors keep the server's message; other failures pass through", async () => {
    const conflict = await errorOf(call(res(409, { code: "conflict", message: "Name taken" })));
    expect([conflict.status, conflict.message]).toEqual([409, "Name taken"]);
    expect((await errorOf(call(res(500, undefined)))).message).toBe("HTTP 500");
    const abort = new DOMException("aborted", "AbortError");
    await expect(call(Promise.reject(abort))).rejects.toBe(abort);
    expect(await call(res(200, { a: 1 }))).toEqual({ a: 1 });
    expect(await call(res(204, undefined))).toBeNull();
  });
});
