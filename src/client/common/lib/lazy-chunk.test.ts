// FR-SHELL-176 (BL-91): one loader, retry once, no loop; the source scan keeps every dynamic
// import in `src/client` on it (no `biome.json` rule).
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  chunkName,
  failedCopy,
  isChunkError,
  pressReload,
  RELOAD_GUARD_MS,
  type ReloadEnv,
  StaleChunkError,
  staleCopy,
} from "./chunk-stale";
import { loadChunk } from "./lazy-chunk";

const chunkErr = () =>
  new TypeError(
    "Failed to fetch dynamically imported module: http://127.0.0.1:4122/assets/TrayWindow-B1x2c3D4.js",
  );

/** A factory rejecting `fails` times with `err`, then resolving. */
function flaky(fails: number, err: () => unknown = chunkErr) {
  let calls = 0;
  const factory = () => {
    calls += 1;
    return calls <= fails ? Promise.reject(err()) : Promise.resolve({ ok: true });
  };
  return { factory, calls: () => calls };
}

function memEnv(start = 1_000_000): ReloadEnv & { reloads: number; at(ms: number): void } {
  const store = new Map<string, string>();
  let now = start;
  const env = {
    reloads: 0,
    now: () => now,
    get: (k: string) => store.get(k) ?? null,
    set: (k: string, v: string) => void store.set(k, v),
    reload: () => {
      env.reloads += 1;
    },
    at: (ms: number) => {
      now = start + ms;
    },
  };
  return env;
}

// ---------- the source scan ----------

const LOADERS = ["lazyChunk", "loadChunk", "createChunkLoader", "lazyApi"];
const DIRECT = new RegExp(
  `\\b(?:${LOADERS.join("|")})\\(\\s*(?:async\\s*)?\\(\\s*\\)\\s*=>\\s*(?:await\\s+)?$`,
);

/** Code without comments (strings kept: a dynamic import never sits in one). */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

/** Bare `lazy(` / `import(` sites in one file's source: `line: text`. */
function bareSites(src: string): string[] {
  const code = stripComments(src);
  const out: string[] = [];
  const lineOf = (i: number) => code.slice(0, i).split("\n").length;
  for (const m of code.matchAll(/\blazy\s*\(/g)) {
    out.push(`${lineOf(m.index)}: lazy(`);
  }
  for (const m of code.matchAll(/\bimport\s*\(/g)) {
    const before = code.slice(Math.max(0, m.index - 200), m.index);
    if (/\btypeof\s+$/.test(before)) continue; // a type, erased
    if (DIRECT.test(before)) continue;
    out.push(`${lineOf(m.index)}: import(`);
  }
  return out;
}

const CLIENT = join(import.meta.dir, "..", "..");
const LOADER_FILE = join(import.meta.dir, "lazy-chunk.ts");

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.tsx?$/.test(name) && !/\.(test|bench)\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("FR-SHELL-176 one loader, retry once, no loop", () => {
  test("FR-SHELL-176 one rejection then success → resolves; two → stale; non-chunk → rethrown as is", async () => {
    const once = flaky(1);
    expect(await loadChunk(once.factory, { retryMs: 1 })).toEqual({ ok: true });
    expect(once.calls()).toBe(2);

    const twice = flaky(2);
    const stale = await loadChunk(twice.factory, { retryMs: 1 }).catch((e: unknown) => e);
    expect(stale).toBeInstanceOf(StaleChunkError);
    expect((stale as StaleChunkError).chunk).toBe("TrayWindow");
    expect(twice.calls()).toBe(2); // no loop

    const boom = new RangeError("render bug");
    const other = flaky(5, () => boom);
    expect(await loadChunk(other.factory, { retryMs: 1 }).catch((e: unknown) => e)).toBe(boom);
    expect(other.calls()).toBe(1);
  });

  test("FR-SHELL-176 the browsers' chunk errors classify; others don't", () => {
    for (const m of [
      "Failed to fetch dynamically imported module: http://x/assets/a-12345678.js",
      "Importing a module script failed.",
      "error loading dynamically imported module: http://x/assets/a-12345678.js",
    ]) {
      expect(isChunkError(new TypeError(m))).toBe(true);
    }
    expect(isChunkError(new TypeError("x is not a function"))).toBe(false);
    expect(isChunkError("Failed to fetch dynamically imported module")).toBe(false);
    expect(chunkName("Importing a module script failed.")).toBe("chunk");
    expect(chunkName("… /assets/MapCanvas-Dk3_x9Qa.js")).toBe("MapCanvas");
  });

  test("FR-SHELL-176 a Reload within 10 s → the failed-reload copy, no second reload (the DM's never says 'check with your DM')", () => {
    const env = memEnv();
    expect(pressReload("TrayWindow", env)).toBe("reloaded");
    env.at(RELOAD_GUARD_MS - 1);
    expect(pressReload("TrayWindow", env)).toBe("failed");
    expect(env.reloads).toBe(1);
    // Another chunk, or the same one later, reloads.
    expect(pressReload("MapCanvas", env)).toBe("reloaded");
    env.at(RELOAD_GUARD_MS * 3);
    expect(pressReload("TrayWindow", env)).toBe("reloaded");
    expect(env.reloads).toBe(3);
    expect(staleCopy("dm")).toBe("Rebuild finished — reload");
    expect(staleCopy("player")).toBe("New version available — reload");
    expect(failedCopy("dm")).toBe("Still failing — is the server on the new build?");
    expect(failedCopy("dm")).not.toContain("check with your DM");
    expect(failedCopy("player")).toBe("Still failing — check with your DM");
  });

  test("FR-SHELL-176 source scan: no bare lazy( / import( outside the loader in src/client", () => {
    const files = sources(CLIENT).filter((f) => f !== LOADER_FILE);
    expect(files.length).toBeGreaterThan(100);
    const bad = files.flatMap((f) =>
      bareSites(readFileSync(f, "utf8")).map((s) => `${relative(CLIENT, f)}:${s}`),
    );
    expect(bad).toEqual([]);
  });

  test("FR-SHELL-176 source scan fails on a planted bare site", () => {
    const planted = [
      'const A = lazy(() => import("./A"));',
      'async function s() { return import("./session"); }',
      'const B = lazyChunk(() => { warm(); return import("./B"); }, "window");',
    ].join("\n");
    expect(bareSites(planted)).toEqual(["1: lazy(", "1: import(", "2: import(", "3: import("]);
    const ok = [
      'const A = lazyChunk(() => import("./A").then((m) => ({ default: m.A })), "inline");',
      'const api = lazyApi(() => import("../session").then((m) => m.api));',
      'const c = createChunkLoader(() => import("./dice3d/index"));',
      'await loadChunk(async () => await import("./session"), { notice: true });',
      'export type M = typeof import("./dice3d/index");',
      '// a comment about lazy( and import("x")',
    ].join("\n");
    expect(bareSites(ok)).toEqual([]);
  });
});
