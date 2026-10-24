// Test file discovery, recorded per-file timings and the shard split behind `bun run check`,
// `bun run check:full` and `bun run test:times` (AGENTS §9.4).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { WORKTREE_ROOT } from "../../src/server/config";

/** The slow set: run by `check:full` (and plain `bun test`), not by `check`. */
export const SLOW_TEST = /\.slow\.test\.[jt]sx?$/;
/** Bun's default test file patterns. */
const TEST_FILE = /(\.|_)(test|spec)\.[cm]?[jt]sx?$/;
const SKIP_DIRS = new Set(["node_modules", "dist", "data", "test-results", "playwright-report"]);

/**
 * Default per-test / per-hook timeout for parallel runs (bun's own is 5 s). With shards side by
 * side on a loaded machine a fixture load in a `beforeAll` or a crash-restart test takes well over
 * 5 s (measured: 10 such files timed out at 8–12 processes). It is a hang guard, not a timing
 * check; tests with their own timeout keep it.
 */
export const TEST_TIMEOUT_ARG = "--timeout=30000";

/** Committed per-file wall times (seconds), rewritten by `bun run test:times`. */
export const TIMES_FILE = path.join(WORKTREE_ROOT, "scripts", "test-times.json");

/** Every test file `bun test` would find, posix-style relative to `root`, in name order. */
export function listTestFiles(root = WORKTREE_ROOT): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const e of readdirSync(path.join(root, rel), { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(r);
      } else if (TEST_FILE.test(e.name)) out.push(r);
    }
  };
  walk("");
  return out.sort();
}

export function readTimes(file = TIMES_FILE): Map<string, number> {
  if (!existsSync(file)) return new Map();
  const json = JSON.parse(readFileSync(file, "utf8")) as { files?: Record<string, number> };
  return new Map(Object.entries(json.files ?? {}));
}

/**
 * Split `files` into `n` shards of about equal total time (longest first, each to the lightest
 * shard). Files without a recorded time weigh the median; with no timings at all every file
 * weighs 1 (a split by count). Empty shards are dropped.
 */
export function shard(files: string[], n: number, times: Map<string, number>): string[][] {
  const known = files.map((f) => times.get(f)).filter((t): t is number => t !== undefined);
  known.sort((a, b) => a - b);
  const fallback = known.length > 0 ? known[Math.floor(known.length / 2)]! : 1;
  const weight = (f: string) => times.get(f) ?? fallback;
  const sorted = [...files].sort((a, b) => weight(b) - weight(a) || a.localeCompare(b));
  const shards = Array.from({ length: Math.max(1, n) }, () => ({ files: [] as string[], t: 0 }));
  for (const f of sorted) {
    const s = shards.reduce((a, b) => (b.t < a.t ? b : a));
    s.files.push(f);
    s.t += weight(f);
  }
  return shards.filter((s) => s.files.length > 0).map((s) => s.files.sort());
}

/** Run `fn` over `items` with at most `n` in flight; results in input order. */
export async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker));
  return out;
}

/** Positive integer from an env var, else `fallback`. */
export function envCount(name: string, fallback: number): number {
  const v = Number(process.env[name]);
  return Number.isInteger(v) && v >= 1 ? v : fallback;
}
