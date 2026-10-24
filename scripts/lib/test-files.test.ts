import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseJunit } from "../check";
import { listTestFiles, pool, SLOW_TEST, shard } from "./test-files";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

test("check: test files found like `bun test` does; node_modules, dist, data, dot dirs skipped; slow set by name", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "pp-test-files-"));
  dirs.push(root);
  for (const f of [
    "src/a.test.ts",
    "src/b.slow.test.ts",
    "src/c.test.tsx",
    "src/d_test.ts",
    "src/e.spec.ts",
    "src/f.bench.ts",
    "src/g.e2e.ts",
    "src/h.ts",
    "node_modules/x/i.test.ts",
    "dist/j.test.ts",
    "data/k.test.ts",
    ".verify/l.test.ts",
  ]) {
    mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    writeFileSync(path.join(root, f), "");
  }
  const files = listTestFiles(root);
  expect(files).toEqual([
    "src/a.test.ts",
    "src/b.slow.test.ts",
    "src/c.test.tsx",
    "src/d_test.ts",
    "src/e.spec.ts",
  ]);
  expect(files.filter((f) => SLOW_TEST.test(f))).toEqual(["src/b.slow.test.ts"]);
});

test("check: shards balance by recorded time (unknown = median), by count without timings; every file once", () => {
  const files = ["a", "b", "c", "d", "e", "f"];
  const times = new Map([
    ["a", 10],
    ["b", 6],
    ["c", 4],
    ["d", 1],
    ["e", 1],
  ]);
  const split = shard(files, 2, times);
  expect(split.flat().sort()).toEqual(files);
  const total = (s: string[]) => s.reduce((t, f) => t + (times.get(f) ?? 4), 0);
  // 10 + 1 + 1 vs 6 + 4 + 4 (f weighs the median, 4).
  expect(split.map(total).sort()).toEqual([12, 14]);
  expect(shard(files, 4, new Map()).map((s) => s.length)).toEqual([2, 2, 1, 1]);
  expect(shard(["a"], 3, new Map())).toEqual([["a"]]);
});

test("check: junit report → counts and failed tests with their file", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="3" assertions="3" failures="1" skipped="1" time="1">
  <testsuite name="src\\a.test.ts" file="src\\a.test.ts" tests="3" failures="1" skipped="1">
    <testsuite name="group" file="src\\a.test.ts" tests="3">
      <testcase name="ok" classname="group" time="0.1" file="src\\a.test.ts" line="2" assertions="1" />
      <testcase name="FR-X-01 it&apos;s &lt;red&gt;" classname="group" time="0.1" file="src\\a.test.ts" line="3" assertions="1">
        <failure type="AssertionError" />
      </testcase>
      <testcase name="later" classname="group" time="0" file="src\\a.test.ts" line="4" assertions="0">
        <skipped />
      </testcase>
    </testsuite>
  </testsuite>
</testsuites>`;
  expect(parseJunit(xml)).toEqual({
    tests: 3,
    failures: 1,
    skipped: 1,
    failed: ["src/a.test.ts > group > FR-X-01 it's <red>"],
  });
});

test("check: pool keeps at most n in flight, results in input order", async () => {
  let live = 0;
  let peak = 0;
  const out = await pool([5, 1, 3, 2, 4], 2, async (x) => {
    live++;
    peak = Math.max(peak, live);
    await Bun.sleep(x);
    live--;
    return x * 10;
  });
  expect(out).toEqual([50, 10, 30, 20, 40]);
  expect(peak).toBe(2);
});
