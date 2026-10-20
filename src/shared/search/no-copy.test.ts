// FR-CMP-54 no copy: the matcher lives only in `src/shared/search/`. A file elsewhere under `src/`
// fails if it has an exported declaration named `fold`, `queryWords` or `searchTier` (incl.
// `export { x as fold }`) or imports one of them from `@shared/compendium/match`. Local names
// (`const fold = foldOf()`, `useBelowFold`) don't count (review #24).
import { describe, expect, test } from "bun:test";

// Bun globals, not `node:*` (@shared imports zod only, AGENTS §9.1).
const ROOT = `${import.meta.dir}/../../..`;
const NAMES = ["fold", "queryWords", "searchTier"] as const;
const NAME = NAMES.join("|");

const DECL = new RegExp(
  String.raw`(?:^|\n)\s*export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|var|class)\s+(${NAME})\b`,
  "g",
);
const LIST = /(?:^|\n)\s*export\s+(?:type\s+)?\{([^}]*)\}/g;
const STAR = /(?:^|\n)\s*export\s+\*\s+from\s*["']([^"']+)["']/g;
const IMPORT = /(?:^|\n)\s*import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;

/** Names a file exports from the list, re-exports wholesale from the matcher, or imports from compendium. */
function copies(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(DECL)) out.push(`export ${m[1]}`);
  for (const m of src.matchAll(LIST)) {
    for (const part of (m[1] ?? "").split(",")) {
      const exported = part
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.replace(/^type\s+/, "");
      if ((NAMES as readonly string[]).includes(exported ?? "")) out.push(`export { ${exported} }`);
    }
  }
  for (const m of src.matchAll(STAR)) {
    if (/search\/match$/.test(m[1] ?? "")) out.push(`export * from ${m[1]}`);
  }
  for (const m of src.matchAll(IMPORT)) {
    if (!/compendium\/match$/.test(m[2] ?? "")) continue;
    for (const part of (m[1] ?? "").split(",")) {
      const imported = part
        .trim()
        .replace(/^type\s+/, "")
        .split(/\s+as\s+/)[0];
      if ((NAMES as readonly string[]).includes(imported ?? "")) out.push(`import ${imported}`);
    }
  }
  return out;
}

describe("FR-CMP-54 no copy", () => {
  test("FR-CMP-54 no copy: the scan flags exported copies and compendium imports, not local names", () => {
    expect(copies("export function fold(s: string) {}")).toEqual(["export fold"]);
    expect(copies("export const queryWords = (q: string) => [];")).toEqual(["export queryWords"]);
    expect(copies("export { foldIt as searchTier };")).toEqual(["export { searchTier }"]);
    expect(copies('export { fold } from "./x";')).toEqual(["export { fold }"]);
    expect(copies('export * from "@shared/search/match";')).toEqual([
      "export * from @shared/search/match",
    ]);
    expect(copies('import { fold, sourceRank } from "@shared/compendium/match";')).toEqual([
      "import fold",
    ]);
    expect(copies("const fold = foldOf();\nexport function useBelowFold() {}")).toEqual([]);
    expect(copies('import { fold } from "@shared/search/match";\nexport { foldName };')).toEqual(
      [],
    );
  });

  test("FR-CMP-54 no copy: no file outside src/shared/search/ exports or re-imports the matcher", async () => {
    const hits: string[] = [];
    let scanned = 0;
    for (const f of new Bun.Glob("src/**/*.{ts,tsx}").scanSync({ cwd: ROOT })) {
      const rel = f.replaceAll("\\", "/");
      if (rel.startsWith("src/shared/search/")) continue;
      scanned++;
      for (const c of copies(await Bun.file(`${ROOT}/${rel}`).text())) hits.push(`${rel}: ${c}`);
    }
    expect(scanned).toBeGreaterThan(100); // the glob found the tree
    expect(hits).toEqual([]);
  }, 30_000); // reads every file under src/: over the 5 s default while other suites run
});
