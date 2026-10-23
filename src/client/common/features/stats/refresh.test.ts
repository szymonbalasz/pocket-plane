// The window's query controller with fake timers and a manual sender (FR-STATS-17, -23, -24).
import { describe, expect, test } from "bun:test";
import { REFRESH_MS } from "./logic";
import { CONFLICT_RETRY_MS, createStatsQuery, type QueryState, type Timers } from "./refresh";

function fakeTimers() {
  let now = 0;
  let next = 1;
  const due = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    setTimeout: (fn, ms) => {
      const id = next++;
      due.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (h) => void due.delete(h as number),
  };
  const advance = (ms: number) => {
    now += ms;
    for (const [id, t] of [...due].sort((a, b) => a[1].at - b[1].at)) {
      if (t.at > now) continue;
      due.delete(id);
      t.fn();
    }
  };
  return { timers, advance, pending: () => due.size };
}

type In = { scope: string; n?: number };

function harness() {
  const t = fakeTimers();
  const sent: { input: In; resolve(r: string): void; reject(e: unknown): void }[] = [];
  const states: QueryState<In, string>[] = [];
  const q = createStatsQuery<In, string>({
    send: (input) =>
      new Promise<string>((resolve, reject) => {
        sent.push({ input, resolve, reject });
      }),
    onChange: (s) => states.push(s),
    timers: t.timers,
  });
  const last = () => states.at(-1) as QueryState<In, string>;
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return { q, t, sent, states, last, flush };
}

describe("FR-STATS-17 refresh", () => {
  test("FR-STATS-17 refresh debounce: pokes ask once, 1 s after the first (trailing); none before", async () => {
    const h = harness();
    h.q.set({ scope: "fight" });
    expect(h.sent).toHaveLength(1);
    h.sent[0]?.resolve("a");
    await h.flush();
    expect(h.last()).toMatchObject({ status: "ok", result: "a" });
    h.q.poke();
    h.t.advance(400);
    h.q.poke();
    h.q.poke();
    h.t.advance(REFRESH_MS - 401);
    expect(h.sent).toHaveLength(1);
    h.t.advance(1);
    expect(h.sent).toHaveLength(2);
    h.sent[1]?.resolve("b");
    await h.flush();
    expect(h.last()).toMatchObject({ status: "ok", result: "b" });
    // Nothing more queued.
    h.t.advance(5000);
    expect(h.sent).toHaveLength(2);
  });

  test("FR-STATS-17 refresh minimised: no query while hidden; a poke while hidden asks once on restore; no poke → none", async () => {
    const h = harness();
    h.q.set({ scope: "fight" });
    h.sent[0]?.resolve("a");
    await h.flush();
    h.q.setShown(false);
    h.q.setShown(true);
    expect(h.sent).toHaveLength(1);
    h.q.setShown(false);
    h.q.poke();
    h.q.snapshot();
    h.t.advance(5000);
    expect(h.sent).toHaveLength(1);
    h.q.setShown(true);
    expect(h.sent).toHaveLength(2);
  });

  test("FR-STATS-17 refresh minimised mid-wait: the pending poke waits for the restore", async () => {
    const h = harness();
    h.q.set({ scope: "fight" });
    h.sent[0]?.resolve("a");
    await h.flush();
    h.q.poke();
    h.q.setShown(false);
    h.t.advance(5000);
    expect(h.sent).toHaveLength(1);
    expect(h.t.pending()).toBe(0);
    h.q.setShown(true);
    expect(h.sent).toHaveLength(2);
  });

  test("FR-STATS-17 refresh after each snapshot: asks at once (no 1 s wait); during a request, right after it", async () => {
    const h = harness();
    h.q.set({ scope: "session" });
    h.sent[0]?.resolve("a");
    await h.flush();
    h.q.snapshot();
    expect(h.sent).toHaveLength(2);
    h.q.snapshot();
    expect(h.sent).toHaveLength(2);
    h.sent[1]?.resolve("b");
    await h.flush();
    expect(h.sent).toHaveLength(3);
  });

  test("FR-STATS-17 one request in flight: an ask meanwhile follows the answer; a picker change drops the older answer", async () => {
    const h = harness();
    h.q.set({ scope: "fight" });
    h.q.set({ scope: "fight", n: 2 });
    expect(h.sent).toHaveLength(1);
    h.sent[0]?.resolve("old");
    await h.flush();
    expect(h.last().result).toBeNull();
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]?.input).toEqual({ scope: "fight", n: 2 });
    h.sent[1]?.resolve("new");
    await h.flush();
    expect(h.last()).toMatchObject({ status: "ok", result: "new", resultFor: { n: 2 } });
  });
});

describe("FR-STATS-23 / -24 states", () => {
  test("FR-STATS-23 reconnect → re-query, the last result kept (muted by the window) until the answer", async () => {
    const h = harness();
    h.q.set({ scope: "fight" });
    h.sent[0]?.resolve("a");
    await h.flush();
    h.q.snapshot();
    expect(h.sent).toHaveLength(2);
    expect(h.last()).toMatchObject({ status: "loading", result: "a" });
    h.sent[1]?.resolve("b");
    await h.flush();
    expect(h.last()).toMatchObject({ status: "ok", result: "b" });
  });

  test("FR-STATS-24 states: error keeps the code and message; Retry asks again and clears it", async () => {
    const h = harness();
    h.q.set({ scope: "fight" });
    h.sent[0]?.reject({ code: "not_found", message: "Fight not found" });
    await h.flush();
    expect(h.last()).toMatchObject({
      status: "error",
      result: null,
      error: { code: "not_found", message: "Fight not found" },
    });
    h.q.retry();
    expect(h.sent).toHaveLength(2);
    expect(h.last().status).toBe("loading");
    h.sent[1]?.resolve("a");
    await h.flush();
    expect(h.last()).toMatchObject({ status: "ok", error: null });
  });

  test("FR-STATS-23 a disposed query (window closed) asks nothing and reports nothing", async () => {
    const h = harness();
    h.q.set({ scope: "fight" });
    h.q.poke();
    const n = h.last();
    h.q.dispose();
    h.sent[0]?.resolve("a");
    await h.flush();
    h.t.advance(5000);
    expect(h.sent).toHaveLength(1);
    expect(h.last()).toBe(n);
  });
});

// Sprint 9 (FX1, BL-74): the server answers an over-limit query with no memo `conflict`.
describe("FR-STATS-69 conflict retried quietly", () => {
  const conflict = { code: "conflict", message: "Too many stats queries, try again in a moment" };

  test("FR-STATS-69 conflict retried quietly: a `conflict` keeps the last result, shows no error and re-asks once 1 s later with the latest input", async () => {
    const h = harness();
    h.q.set({ scope: "fight" });
    h.sent[0]?.resolve("a");
    await h.flush();
    // The picker moves twice; the first answers `conflict`, the second asks after it.
    h.q.set({ scope: "fight", n: 1 });
    h.sent[1]?.reject(conflict);
    await h.flush();
    expect(h.states.some((s) => s.status === "error")).toBe(false);
    expect(h.last()).toMatchObject({ status: "loading", result: "a", error: null });
    h.q.set({ scope: "fight", n: 2 });
    h.sent[2]?.reject(conflict);
    await h.flush();
    expect(h.last()).toMatchObject({ status: "loading", result: "a" });
    h.t.advance(CONFLICT_RETRY_MS - 1);
    expect(h.sent).toHaveLength(3);
    h.t.advance(1);
    expect(h.sent).toHaveLength(4);
    expect(h.sent[3]?.input).toEqual({ scope: "fight", n: 2 });
    h.sent[3]?.resolve("c");
    await h.flush();
    expect(h.last()).toMatchObject({
      status: "ok",
      result: "c",
      resultFor: { scope: "fight", n: 2 },
    });
    expect(h.states.some((s) => s.status === "error")).toBe(false);
    expect(CONFLICT_RETRY_MS).toBe(1000);
  });

  test("FR-STATS-69 conflict retried quietly: a second `conflict` → 'Couldn't load stats' (status error) + Retry asks again", async () => {
    const h = harness();
    h.q.set({ scope: "session" });
    h.sent[0]?.reject(conflict);
    await h.flush();
    expect(h.last().status).toBe("loading");
    h.t.advance(CONFLICT_RETRY_MS);
    h.sent[1]?.reject(conflict);
    await h.flush();
    expect(h.last()).toMatchObject({ status: "error", error: { code: "conflict" } });
    // Nothing else queued; Retry asks (and gets its own quiet retry again).
    h.t.advance(5000);
    expect(h.sent).toHaveLength(2);
    h.q.retry();
    expect(h.sent).toHaveLength(3);
    // Any other reject is an error at once, as before.
    h.sent[2]?.reject({ code: "not_found", message: "Unknown fight" });
    await h.flush();
    expect(h.last()).toMatchObject({ status: "error", error: { code: "not_found" } });
  });
});
