import { expect, test } from "bun:test";
import { RENAME_RETRIES, type RenameIo, renameRetrying } from "./rename";

function failing(codes: (string | undefined)[]) {
  const calls: string[] = [];
  const sleeps: number[] = [];
  const io: RenameIo = {
    rename(from, to) {
      calls.push(`${from}->${to}`);
      const code = codes.shift();
      if (code) throw Object.assign(new Error(`${code}: rename`), { code });
    },
    sleep: (ms) => sleeps.push(ms),
  };
  return { io, calls, sleeps };
}

test("transient EPERM / EACCES / EBUSY: retried with backoff until the rename succeeds", () => {
  const f = failing(["EPERM", "EACCES", "EBUSY", undefined]);
  renameRetrying("a.tmp", "a", f.io);
  expect(f.calls).toHaveLength(4);
  expect(f.sleeps).toEqual([10, 20, 30]);
});

test("still held after the bound: the last error is thrown", () => {
  const f = failing(Array(RENAME_RETRIES + 5).fill("EPERM"));
  expect(() => renameRetrying("a.tmp", "a", f.io)).toThrow(/EPERM/);
  expect(f.calls).toHaveLength(RENAME_RETRIES + 1);
  expect(Math.max(...f.sleeps)).toBe(100);
});

test("any other error is thrown at once", () => {
  const f = failing(["ENOENT"]);
  expect(() => renameRetrying("a.tmp", "a", f.io)).toThrow(/ENOENT/);
  expect(f.calls).toHaveLength(1);
  expect(f.sleeps).toEqual([]);
});
