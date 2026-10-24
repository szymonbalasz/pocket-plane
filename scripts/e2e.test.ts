import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { bundleOrder, countLine, groupSpecs } from "./e2e";

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
});

test("e2e runner: the repo's specs all resolve to registered bundles", async () => {
  const { library } = await import("../fixtures");
  const names = new Set(library.bundles.map((b) => b.name));
  for (const bundle of groupSpecs([]).keys()) expect(names.has(bundle)).toBe(true);
});
