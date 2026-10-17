// FR-MOD-61 (S4-0): one feature-use helper. MOD's interim `feature-uses.ts` is gone; the apply
// hook (FR-MOD-38, -41) and the toggle (FR-MOD-12) import CHARX's `spendFeatureUse` /
// `refundFeatureUse` from `resources.ts`, one import site each. Behaviour is covered unchanged by
// `tier3.test.ts` and `trigger-engine.test.ts`.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = import.meta.dir;
const source = (f: string) => readFileSync(join(DIR, f), "utf8");
const IMPORT = /import\s*\{([^}]*)\}\s*from\s*"([^"]+)"/g;

/** Every import of `spendFeatureUse` / `refundFeatureUse` in a file: `[names, from]`. */
function helperImports(file: string): [string[], string][] {
  return [...source(file).matchAll(IMPORT)]
    .map((m): [string[], string] => [
      (m[1] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s === "spendFeatureUse" || s === "refundFeatureUse"),
      m[2] ?? "",
    ])
    .filter(([names]) => names.length > 0);
}

describe("FR-MOD-61 one feature-use helper", () => {
  test("FR-MOD-61 one feature-use helper: feature-uses.ts gone; apply-hook.ts and commands.ts import CHARX's helpers once each", () => {
    expect(existsSync(join(DIR, "feature-uses.ts"))).toBe(false);
    expect(helperImports("apply-hook.ts")).toEqual([
      [["refundFeatureUse", "spendFeatureUse"], "../character-sheet/resources"],
    ]);
    expect(helperImports("commands.ts")).toEqual([
      [["spendFeatureUse"], "../character-sheet/resources"],
    ]);
    // No other MOD server file imports a feature-use helper from anywhere else.
    for (const f of readdirSync(DIR).filter((x) => x.endsWith(".ts") && !x.endsWith(".test.ts"))) {
      for (const [, from] of helperImports(f)) expect(from).toBe("../character-sheet/resources");
    }
  });
});
