// NOTES §12 "Editor: its own chunk, loaded when Notes opens; measured in both bundles" (N3): a real
// Vite build (in memory). Neither client's initial JS holds any `@codemirror/*` module; the
// linked-notes code in it is only the window definition, its palette commands and a tiny store
// (≤ 3 KB gz); the editor chunk (the window body + CodeMirror) is reached by dynamic import only.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { build, type Rollup } from "vite";

const ROOT = path.resolve(import.meta.dir, "../../../../..");
const KB = 1024;
const INITIAL_NOTES_MAX = 3 * KB;
const EDITOR_CHUNK_MAX = 160 * KB;

const gz = (code: string) => gzipSync(code, { level: 9 }).length;
const slash = (id: string) => id.replaceAll("\\", "/");
const isNotes = (id: string) => /\/src\/client\/common\/features\/linked-notes\//.test(slash(id));
const isCodeMirror = (id: string) => /\/node_modules\/@codemirror\//.test(slash(id));

async function bundle(): Promise<Rollup.OutputChunk[]> {
  const outDir = mkdtempSync(path.join(os.tmpdir(), "pp-notes-bundle-"));
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

describe("NOTES bundle size (N3)", () => {
  test("FR-NOTES-13 NOTES §12 the editor is its own lazy chunk: no CodeMirror in either client's initial JS, ≤ 3 KB gz of notes code there", async () => {
    const chunks = await bundle();
    const byFile = new Map(chunks.map((c) => [c.fileName, c]));
    const initial = new Set<Rollup.OutputChunk>();
    for (const name of ["dm", "player"]) {
      const entry = chunks.find((c) => c.isEntry && c.name === name);
      if (!entry) throw new Error(`no ${name} entry chunk`);
      const inEntry = closure(entry, byFile);
      for (const c of inEntry) initial.add(c);
      const ids = [...inEntry].flatMap((c) => Object.keys(c.modules));
      expect([name, ids.filter(isCodeMirror)]).toEqual([name, []]);
      const notes = [...inEntry]
        .flatMap((c) => Object.entries(c.modules))
        .filter(([id]) => isNotes(id))
        .map(([, m]) => m.code ?? "")
        .join("\n");
      console.log(`NOTES ${name}: linked-notes code in initial chunks ${gz(notes)} B gz`);
      expect(gz(notes)).toBeLessThanOrEqual(INITIAL_NOTES_MAX);
    }
    const editor = chunks.filter(
      (c) =>
        !initial.has(c) && Object.keys(c.modules).some((id) => isNotes(id) || isCodeMirror(id)),
    );
    expect(editor.length).toBeGreaterThan(0);
    const code = editor.map((c) => c.code).join("\n");
    console.log(
      `NOTES editor chunk(s): ${editor.map((c) => c.fileName).join(", ")}: ${Buffer.byteLength(code)} B raw, ${gz(code)} B gz`,
    );
    expect(editor.some((c) => c.isDynamicEntry)).toBe(true);
    expect(gz(code)).toBeLessThanOrEqual(EDITOR_CHUNK_MAX);
  }, 300_000);
});
