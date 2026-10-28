import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  changedFiles,
  type Git,
  resolveImport,
  reverseGraph,
  selectTests,
  sourceFiles,
} from "./affected";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tree(files: Record<string, string>) {
  const root = mkdtempSync(path.join(os.tmpdir(), "pp-affected-"));
  dirs.push(root);
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
    writeFileSync(path.join(root, f), body);
  }
  return root;
}

test("affected: imports resolve through relative paths, tsconfig aliases, index files and .js", () => {
  const files = new Set([
    "src/server/a.ts",
    "src/server/b/index.ts",
    "src/shared/x.ts",
    "src/client/common/ui.tsx",
    "fixtures/index.ts",
  ]);
  const from = "src/server/c.ts";
  expect(resolveImport("./a", from, files)).toBe("src/server/a.ts");
  expect(resolveImport("./a.js", from, files)).toBe("src/server/a.ts");
  expect(resolveImport("./b", from, files)).toBe("src/server/b/index.ts");
  expect(resolveImport("../shared/x.ts", from, files)).toBe("src/shared/x.ts");
  expect(resolveImport("@shared/x", from, files)).toBe("src/shared/x.ts");
  expect(resolveImport("@ui/ui", from, files)).toBe("src/client/common/ui.tsx");
  expect(resolveImport("@fixtures/index", from, files)).toBe("fixtures/index.ts");
  expect(resolveImport("zod", from, files)).toBeNull();
  expect(resolveImport("./missing", from, files)).toBeNull();
});

test("affected: the reverse graph reads static, type, side-effect, re-export and dynamic imports", () => {
  const root = tree({
    "src/shared/a.ts": "export const a = 1;\n",
    "src/shared/b.ts": 'import { a } from "./a";\n',
    "src/shared/c.ts": 'import type { A } from "@shared/a";\n',
    "src/shared/d.ts": 'import "./a";\nexport * from "./b";\n',
    "src/shared/e.ts": 'const m = await import("./c");\n',
    "src/shared/f.ts": "import {\n  a,\n} from './a';\n",
  });
  const rev = reverseGraph(root, sourceFiles(root));
  expect([...(rev.get("src/shared/a.ts") ?? [])].sort()).toEqual([
    "src/shared/b.ts",
    "src/shared/c.ts",
    "src/shared/d.ts",
    "src/shared/f.ts",
  ]);
  expect([...(rev.get("src/shared/b.ts") ?? [])]).toEqual(["src/shared/d.ts"]);
  expect([...(rev.get("src/shared/c.ts") ?? [])]).toEqual(["src/shared/e.ts"]);
});

test("affected: tests nearest first — changed tests and folder tests, then importers layer by layer within max", () => {
  // core ← mid ← top; each has a test; other/ is unrelated.
  const rev = new Map<string, Set<string>>([
    [
      "src/core/core.ts",
      new Set(["src/core/core.test.ts", "src/mid/mid.ts", "src/far/far.test.ts"]),
    ],
    ["src/mid/mid.ts", new Set(["src/mid/mid.test.ts", "src/top/top.ts"])],
    ["src/top/top.ts", new Set(["src/top/top.test.ts"])],
  ]);
  const tests = [
    "src/core/core.test.ts",
    "src/core/other.test.ts",
    "src/far/far.test.ts",
    "src/mid/mid.test.ts",
    "src/other/x.test.ts",
    "src/top/top.test.ts",
  ];
  const all = selectTests(["src/core/core.ts"], tests, rev, 80);
  expect(all.tests).toEqual([
    "src/core/core.test.ts",
    "src/core/other.test.ts",
    "src/far/far.test.ts",
    "src/mid/mid.test.ts",
    "src/top/top.test.ts",
  ]);
  expect(all.deferred).toBe(0);
  // max 3: distance ≤ 1 always runs (3 files); distance 2 (mid.test) and 3 (top.test) wait for CI.
  const capped = selectTests(["src/core/core.ts"], tests, rev, 3);
  expect(capped.tests).toEqual([
    "src/core/core.test.ts",
    "src/core/other.test.ts",
    "src/far/far.test.ts",
  ]);
  expect(capped.depth).toBe(1);
  expect(capped.deferred).toBe(2);
  // A changed test alone runs alone; a lockfile change is flagged global.
  const one = selectTests(["src/other/x.test.ts", "bun.lock"], tests, rev, 80);
  expect(one.tests).toEqual(["src/other/x.test.ts"]);
  expect(one.global).toEqual(["bun.lock"]);
});

test("affected: changed files = diff against the base plus untracked, deduplicated", () => {
  const calls: string[][] = [];
  const fake: Git = (args) => {
    calls.push(args);
    return args[0] === "diff" ? "src/a.ts\nsrc/b.ts\n" : "src/b.ts\nsrc/new.ts\n";
  };
  expect(changedFiles(fake, "abc123")).toEqual(["src/a.ts", "src/b.ts", "src/new.ts"]);
  expect(calls[0]).toEqual(["diff", "--name-only", "--no-renames", "abc123"]);
});
