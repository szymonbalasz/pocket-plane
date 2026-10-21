// CMP §13 sprint 7 (FU4, FR-CMP-58): the fixture Goblins' entryless Compendium rows, typed
// (`enemy-1`, "humanoid") and type-less (`cmp-goblin-untyped`), as the search index builds them.
import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { buildSearchIndex } from "@server/features/compendium/search-index";
import { loadInProcess } from "@server/features/fixtures-adapters/loader";
import { entryLine, monsterLine } from "@shared/compendium/schemas";
import { bundles } from "../../bundles";
import { units } from "../index";

const dirs: string[] = [];
afterAll(() => {
  Bun.gc(true);
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // Windows: a closed SQLite handle can linger until GC; a leftover OS temp dir is harmless.
    }
  }
});

describe("FR-CMP-58 creature rows", () => {
  test("FR-CMP-58 type-less creature label: no trailing space without a type; the typed fixture Goblin reads Small humanoid; the old entries unchanged", async () => {
    expect(monsterLine({ cr: "1/4", size: "small" })).toBe("CR 1/4 · Small");
    expect(monsterLine({ cr: "1/4", size: "small", type: "" })).toBe("CR 1/4 · Small");
    expect(monsterLine({ cr: "1/4", size: "small", type: "humanoid" })).toBe(
      "CR 1/4 · Small humanoid",
    );
    // An entry's facet always has a type (a sprint-3 import reads "unknown", `cmp-srd-mini-s3`).
    const facets = { cr: "1/4", size: "small", type: "unknown" } as const;
    expect(
      entryLine({ kind: "monster", name: "Goblin", facets } as Parameters<typeof entryLine>[0]),
    ).toBe("CR 1/4 · Small unknown");

    const lib = {
      fixtures: units,
      bundles: [
        ...bundles,
        { name: "cmp-58", includes: ["base"], fixtures: ["enemy-1", "cmp-goblin-untyped"] },
      ],
    };
    const r = await loadInProcess(lib, "cmp-58", {});
    dirs.push(r.dir);
    const lines = buildSearchIndex(r.openDb())
      .rows.filter((x) => x.entryless)
      .map((x): [string, string] => [x.name, x.line])
      .sort(([a], [b]) => a.localeCompare(b));
    expect(lines).toEqual([
      ["Goblin", "CR 1/4 · Small humanoid"],
      ["Goblin (untyped)", "CR 1/4 · Small"],
    ]);
    for (const [, line] of lines) expect(line).not.toMatch(/\s$/);
  });
});
