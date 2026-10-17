// DICEX §13 "Bundle" (FR-DICEX-22, §12): a real Vite build (in memory, no `dist/` write). Each
// client's initial JS carries ≤ 15 KB gz of dice-extras code (parser, tray, flat dice, the 3D
// loader), measured as the gzip of exactly the dice-extras modules in the initial chunks (an
// upper bound on the growth vs `main`, which doesn't drift as other features land). `three` and
// `cannon-es` sit only in the lazy 3D chunk, reached by dynamic import only; it's ≤ 170 KB gz.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { build, type Rollup } from "vite";

const ROOT = path.resolve(import.meta.dir, "../../../../..");
const KB = 1024;
const INITIAL_DICEX_MAX = 15 * KB;
const CHUNK_3D_MAX = 170 * KB;

const gz = (code: string) => gzipSync(code, { level: 9 }).length;
const slash = (id: string) => id.replaceAll("\\", "/");
const isDicex = (id: string) =>
  /\/src\/(client\/common\/features|shared)\/dice-extras\//.test(slash(id));
const is3dLib = (id: string) => /\/node_modules\/(three|cannon-es)\//.test(slash(id));

async function bundle(): Promise<Rollup.OutputChunk[]> {
  const outDir = mkdtempSync(path.join(os.tmpdir(), "pp-bundle-"));
  // `bun test` sets NODE_ENV=test, which would give React's dev build: measure what ships.
  const env = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const out = await build({
      configFile: path.join(ROOT, "vite.config.ts"),
      mode: "production",
      logLevel: "silent",
      build: { write: false, outDir, emptyOutDir: false },
    });
    const outputs = (Array.isArray(out) ? out : [out]) as Rollup.RollupOutput[];
    return outputs.flatMap((o) => o.output.filter((c) => c.type === "chunk"));
  } finally {
    process.env.NODE_ENV = env;
    rmSync(outDir, { recursive: true, force: true });
  }
}

/** A chunk and everything it imports statically. */
function closure(start: Rollup.OutputChunk, byFile: Map<string, Rollup.OutputChunk>) {
  const seen = new Set<Rollup.OutputChunk>();
  const walk = (c: Rollup.OutputChunk) => {
    if (seen.has(c)) return;
    seen.add(c);
    for (const f of c.imports) {
      const next = byFile.get(f);
      if (next) walk(next);
    }
  };
  walk(start);
  return seen;
}

describe("DICEX bundle size", () => {
  test("FR-DICEX-22 initial chunks ≤ 15 KB gz of dice-extras per client; 3D only in a lazy chunk ≤ 170 KB gz", async () => {
    const chunks = await bundle();
    const byFile = new Map(chunks.map((c) => [c.fileName, c]));
    const initial = new Set<Rollup.OutputChunk>();
    const report: string[] = [];

    for (const name of ["dm", "player"]) {
      const entry = chunks.find((c) => c.isEntry && c.name === name);
      if (!entry) throw new Error(`no ${name} entry chunk`);
      const chunksIn = closure(entry, byFile);
      for (const c of chunksIn) initial.add(c);
      const ids = [...chunksIn].flatMap((c) => Object.keys(c.modules));
      // The 3D library and the 3D renderer never load up front.
      expect(ids.filter(is3dLib)).toEqual([]);
      expect(ids.filter((id) => slash(id).includes("/dice-extras/dice3d/"))).toEqual([]);
      const code = [...chunksIn]
        .flatMap((c) => Object.entries(c.modules))
        .filter(([id]) => isDicex(id))
        .map(([, m]) => m.code ?? "")
        .join("\n");
      const total = [...chunksIn].reduce((s, c) => s + gz(c.code), 0);
      report.push(
        `${name}: initial ${(total / KB).toFixed(1)} KB gz, dice-extras ${(gz(code) / KB).toFixed(1)} KB gz`,
      );
      expect(gz(code)).toBeLessThanOrEqual(INITIAL_DICEX_MAX);
    }

    // The 3D chunk: a dynamic entry holding three + cannon-es + the renderer, plus whatever it
    // imports that no client loads up front.
    const entry3d = chunks.find(
      (c) =>
        c.isDynamicEntry &&
        Object.keys(c.modules).some((id) => slash(id).includes("/dice3d/index")),
    );
    if (!entry3d) throw new Error("no lazy 3D chunk");
    const lazy = [...closure(entry3d, byFile)].filter((c) => !initial.has(c));
    const ids = lazy.flatMap((c) => Object.keys(c.modules));
    expect(ids.some((id) => /\/node_modules\/three\//.test(slash(id)))).toBe(true);
    expect(ids.some((id) => /\/node_modules\/cannon-es\//.test(slash(id)))).toBe(true);
    // Reached from the initial chunks by dynamic import only.
    for (const c of initial) expect(c.imports).not.toContain(entry3d.fileName);
    expect([...initial].some((c) => c.dynamicImports.includes(entry3d.fileName))).toBe(true);
    const size3d = lazy.reduce((s, c) => s + gz(c.code), 0);
    report.push(`3D chunk: ${(size3d / KB).toFixed(1)} KB gz (${lazy.length} chunk)`);
    expect(size3d).toBeLessThanOrEqual(CHUNK_3D_MAX);

    // The throw views (dice layer, zone, 3D runs, D6): a lazy chunk preloaded at idle, outside
    // the initial budget, without the 3D library.
    const views = chunks.find(
      (c) =>
        c.isDynamicEntry &&
        Object.keys(c.modules).some((id) => slash(id).endsWith("/dice-extras/ThrowViews.tsx")),
    );
    if (!views) throw new Error("no lazy throw-views chunk");
    for (const c of initial) expect(c.imports).not.toContain(views.fileName);
    const viewsOwn = [...closure(views, byFile)].filter((c) => !initial.has(c));
    expect(viewsOwn.flatMap((c) => Object.keys(c.modules)).filter(is3dLib)).toEqual([]);
    report.push(`throw views: ${(gz(views.code) / KB).toFixed(1)} KB gz`);
    console.log(`[bundle] ${report.join("; ")}`);
  }, 60_000);
});
