import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  bundleOrder,
  countLine,
  FAILURE_LINE,
  groupSpecs,
  serialBundles,
  shardBundles,
} from "./e2e";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tree(files: Record<string, string>) {
  const root = mkdtempSync(path.join(os.tmpdir(), "pp-e2e-groups-"));
  dirs.push(root);
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    writeFileSync(path.join(root, f), body);
  }
  return root;
}

test("e2e runner: specs grouped by their `// e2e-bundle:` line, default sync-probe; support ignored", () => {
  const root = tree({
    "e2e/a.e2e.ts": "// A\nimport x;\n",
    "e2e/dice.e2e.ts": "// Dice log.\n// e2e-bundle: dice-log\nimport x;\n",
    "e2e/sub/combat.e2e.ts": "// e2e-bundle: combat\n",
    "e2e/b.e2e.ts": "const s = '// e2e-bundle: nope'; // not a header line\n",
    "e2e/support/env.ts": "// e2e-bundle: never\n",
    "e2e/notes.md": "x",
  });
  expect(Object.fromEntries(groupSpecs([], root))).toEqual({
    "sync-probe": ["e2e/a.e2e.ts", "e2e/b.e2e.ts"],
    "dice-log": ["e2e/dice.e2e.ts"],
    combat: ["e2e/sub/combat.e2e.ts"],
  });
  expect(Object.fromEntries(groupSpecs(["dice.e2e.ts", "e2e\\sub\\combat.e2e.ts"], root))).toEqual({
    "dice-log": ["e2e/dice.e2e.ts"],
    combat: ["e2e/sub/combat.e2e.ts"],
  });
});

test("e2e runner: a bundle with a spec marked `// e2e-serial: <why>` or needing software WebGL runs alone", () => {
  const root = tree({
    "e2e/a.e2e.ts": "// e2e-bundle: a\n// e2e-serial: feed batch window under load\n",
    "e2e/a2.e2e.ts": "// e2e-bundle: a\n",
    "e2e/b.e2e.ts": "// e2e-bundle: b\n// e2e-serial:\n",
    "e2e/c.e2e.ts": "// e2e-bundle: c\nconst s = '// e2e-serial: x';\n",
    "e2e/d.e2e.ts":
      '// e2e-bundle: d\ntest.use({ launchOptions: { args: ["--enable-unsafe-swiftshader"] } });\n',
  });
  expect([...serialBundles(groupSpecs([], root), root)]).toEqual(["a", "d"]);
});

test("e2e runner: bundles start longest first (recorded seconds, then spec count, then name)", () => {
  const groups = new Map([
    ["a", ["e2e/a1.e2e.ts"]],
    ["b", ["e2e/b1.e2e.ts", "e2e/b2.e2e.ts"]],
    ["c", ["e2e/c1.e2e.ts"]],
    ["d", ["e2e/d1.e2e.ts"]],
  ]);
  expect(bundleOrder(groups, {})).toEqual(["b", "a", "c", "d"]);
  expect(bundleOrder(groups, { d: 90, c: 30, gone: 500 })).toEqual(["d", "c", "b", "a"]);
});

test("e2e runner: --shard=i/n splits bundles into n balanced, disjoint, complete sets", () => {
  const groups = new Map([
    ["a", ["e2e/a1.e2e.ts"]],
    ["b", ["e2e/b1.e2e.ts", "e2e/b2.e2e.ts"]],
    ["c", ["e2e/c1.e2e.ts"]],
    ["d", ["e2e/d1.e2e.ts"]],
    ["e", ["e2e/e1.e2e.ts"]],
  ]);
  const times = { a: 100, b: 60, c: 50, d: 40 }; // e: 1 spec → 20 s
  const shards = [1, 2, 3].map((i) => shardBundles(groups, times, i, 3));
  expect(shards).toEqual([["a"], ["b", "e"], ["c", "d"]]);
  expect(shards.flat().sort()).toEqual(["a", "b", "c", "d", "e"]);
  expect(shardBundles(groups, times, 3, 3)).toEqual(shards[2]!); // same split every call
  expect(shardBundles(groups, {}, 1, 1)).toEqual(["b", "a", "c", "d", "e"]);
  expect(shardBundles(groups, times, 1, 9)).toEqual(["a"]);
  expect(shardBundles(groups, times, 9, 9)).toEqual([]);
});

test("e2e runner: Playwright list summary lines → passed / failed / flaky / skipped / did not run", () => {
  const c = { passed: 0, failed: 0, flaky: 0, skipped: 0, notRun: 0 };
  const lines = [
    "  1 failed",
    "    [chromium] › e2e/x.e2e.ts:3:1 › FR-X-01 thing",
    "  2 flaky",
    "  1 skipped",
    "  3 did not run",
    "  12 passed (1.2m)",
    "  ✓  1 [chromium] › e2e/y.e2e.ts:5:1 › 12 passed in a title (3.0s)",
  ];
  expect(lines.filter((l) => countLine(l, c)).length).toBe(5);
  expect(c).toEqual({ passed: 12, failed: 1, flaky: 2, skipped: 1, notRun: 3 });
  const failures = [
    "  1) e2e\\combat2-polish.e2e.ts:495:3 › FR-CBT-75 sim-6 N8 at 1440×900: the popup … ",
    "  2) [chromium] › e2e/x.e2e.ts:3:1 › FR-X-01 thing ",
    "    Error: Timeout 10000ms exceeded while waiting on the predicate",
    "      484 |       { timeout: 10_000 },",
    "  ok  1 e2e\\a.e2e.ts:12:1 › FR-ASSET-17 picker (1.0s)",
  ];
  expect(failures.filter((l) => FAILURE_LINE.test(l)).length).toBe(2);
});

test("e2e runner: the repo's specs all resolve to registered bundles", async () => {
  const { library } = await import("../fixtures");
  const names = new Set(library.bundles.map((b) => b.name));
  for (const bundle of groupSpecs([]).keys()) expect(names.has(bundle)).toBe(true);
});
