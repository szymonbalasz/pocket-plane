import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { groupSpecs } from "./e2e";

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

test("e2e runner: the repo's specs all resolve to registered bundles", async () => {
  const { library } = await import("../fixtures");
  const names = new Set(library.bundles.map((b) => b.name));
  for (const bundle of groupSpecs([]).keys()) expect(names.has(bundle)).toBe(true);
});
