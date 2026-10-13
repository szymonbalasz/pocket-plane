import { expect, test } from "bun:test";
import {
  handleDmRejection,
  RECHECK_MS,
  type RejectionDeps,
  rejectionOutcome,
  THROTTLED_RETRY_MS,
} from "./rejection";

function fake(status: number | Error) {
  const calls: string[] = [];
  const timers: { fn: () => void; ms: number; cleared: boolean }[] = [];
  const deps: RejectionDeps = {
    probe: () => (status instanceof Error ? Promise.reject(status) : Promise.resolve(status)),
    logout: () => calls.push("logout"),
    throttled: () => calls.push("throttled"),
    reconnect: () => calls.push("reconnect"),
    setTimeout: (fn, ms) => {
      const t = { fn, ms, cleared: false };
      timers.push(t);
      return t;
    },
    clearTimeout: (h) => {
      (h as { cleared: boolean }).cleared = true;
    },
  };
  return { deps, calls, timers };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

test("FR-CAMP-04 4401 + login probe 401 (secret changed) → wipe the secret, no retry", async () => {
  const f = fake(401);
  handleDmRejection(f.deps);
  await settle();
  expect(f.calls).toEqual(["logout"]);
  expect(f.timers).toHaveLength(0);
});

test("FR-CAMP-05 4401 + login probe 429 (lockout) → keep the secret, CAMP §7 wording, retry after 60 s", async () => {
  const f = fake(429);
  handleDmRejection(f.deps);
  await settle();
  expect(f.calls).toEqual(["throttled"]);
  expect(f.timers.map((t) => t.ms)).toEqual([THROTTLED_RETRY_MS]);
  expect(THROTTLED_RETRY_MS).toBe(60_000);
  f.timers[0]?.fn();
  expect(f.calls).toEqual(["throttled", "reconnect"]);
});

test("FR-CAMP-04 4401 + probe ok / 5xx / network error → keep the secret, reconnect soon", async () => {
  for (const s of [204, 500, new Error("offline")]) {
    const f = fake(s);
    handleDmRejection(f.deps);
    await settle();
    expect(f.calls).toEqual([]);
    expect(f.timers.map((t) => t.ms)).toEqual([RECHECK_MS]);
    f.timers[0]?.fn();
    expect(f.calls).toEqual(["reconnect"]);
  }
});

test("FR-CAMP-05 cancel (unmount) before the probe answers or during the wait → nothing happens", async () => {
  const early = fake(401);
  handleDmRejection(early.deps)();
  await settle();
  expect(early.calls).toEqual([]);
  const late = fake(429);
  const cancel = handleDmRejection(late.deps);
  await settle();
  cancel();
  expect(late.timers[0]?.cleared).toBe(true);
  late.timers[0]?.fn();
  expect(late.calls).toEqual(["throttled"]);
});

test("rejectionOutcome maps only 401 to logout", () => {
  expect([401, 429, 204, 500, null].map(rejectionOutcome)).toEqual([
    "logout",
    "throttled",
    "retry",
    "retry",
    "retry",
  ]);
});
