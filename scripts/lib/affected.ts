// Targeted test selection behind `bun run check` and `bun run test:changed` (AGENTS §9.4): the
// files changed since the merge base with `main` (commits, staged, unstaged, untracked), then the
// test files that import them, nearest first, through a regex import graph of the repo's TS.
// The full suite runs in CI on every push; locally we run only what a change can most likely
// break.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", "data", "test-results", "playwright-report"]);
const ROOTS = ["src", "fixtures", "scripts", "e2e"];
/** tsconfig `paths`, prefix → folder. */
const ALIASES: [string, string][] = [
  ["@server/", "src/server/"],
  ["@shared/", "src/shared/"],
  ["@ui/", "src/client/common/"],
  ["@dm/", "src/client/dm/"],
  ["@player/", "src/client/player/"],
  ["@fixtures/", "fixtures/"],
];
const SPECIFIER =
  /\b(?:import|export)\s+(?:type\s+)?[^'"`;]*?\bfrom\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)|\bimport\s+["']([^"']+)["']/g;
/** Changes here can break anything: say so, and leave the whole suite to CI / `check:all`. */
export const GLOBAL_FILES =
  /^(package\.json|bun\.lock|tsconfig\.json|bunfig\.toml|biome\.json|src\/server\/db\/test-preload\.ts)$/;

export type Git = (args: string[]) => string;

export const git: Git = (args) => {
  const p = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${p.stderr.toString().trim()}`);
  return p.stdout.toString();
};

/** The ref to diff against: `--base` if given, else the merge base with origin/main or main. */
export function mergeBase(run: Git, base?: string): string {
  if (base) return run(["rev-parse", base]).trim();
  for (const ref of ["origin/main", "main"]) {
    try {
      return run(["merge-base", "HEAD", ref]).trim();
    } catch {
      // try the next ref
    }
  }
  return "HEAD";
}

/** Files changed since `base` (committed or not) plus untracked ones, posix paths, sorted. */
export function changedFiles(run: Git, base: string): string[] {
  const lines = [
    ...run(["diff", "--name-only", "--no-renames", base]).split("\n"),
    ...run(["ls-files", "--others", "--exclude-standard"]).split("\n"),
  ];
  return [...new Set(lines.map((l) => l.trim()).filter(Boolean))].sort();
}

/** Every TS/JS source under the repo's code roots, posix-style relative to `root`. */
export function sourceFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    const abs = path.join(root, rel);
    if (!existsSync(abs)) return;
    for (const e of readdirSync(abs, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) walk(r);
      } else if (CODE.test(e.name)) out.push(r);
    }
  };
  for (const r of ROOTS) walk(r);
  return out.sort();
}

/** `spec` imported from `from`, as a repo file, or null (a package, or not found). */
export function resolveImport(spec: string, from: string, files: Set<string>): string | null {
  let base: string | null = null;
  if (spec.startsWith("."))
    base = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  else {
    const alias = ALIASES.find(([p]) => spec.startsWith(p));
    if (alias) base = alias[1] + spec.slice(alias[0].length);
  }
  if (base === null) return null;
  const stem = base.replace(/\.(js|jsx|mjs)$/, "");
  for (const c of [
    base,
    `${stem}.ts`,
    `${stem}.tsx`,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
  ]) {
    if (files.has(c)) return c;
  }
  return null;
}

/** file → the repo files that import it. */
export function reverseGraph(root: string, files: string[]): Map<string, Set<string>> {
  const set = new Set(files);
  const rev = new Map<string, Set<string>>();
  for (const f of files) {
    const src = readFileSync(path.join(root, f), "utf8");
    for (const m of src.matchAll(SPECIFIER)) {
      const dep = resolveImport(m[1] ?? m[2] ?? m[3]!, f, set);
      if (!dep || dep === f) continue;
      const s = rev.get(dep) ?? new Set();
      s.add(f);
      rev.set(dep, s);
    }
  }
  return rev;
}

export interface Selection {
  /** Test files to run, sorted. */
  tests: string[];
  /** Import distance included (0 = changed tests and tests in changed folders only). */
  depth: number;
  /** Affected test files left out (further than `depth`, or over `max`); CI runs them. */
  deferred: number;
  /** Changed files that can affect everything (lockfile, tsconfig, test preload, …). */
  global: string[];
}

/**
 * Test files affected by `changed`: changed tests and the tests in a changed file's folder
 * (distance 0), then the tests importing a changed file at distance 1, 2, …, whole layers while
 * the total stays within `max` (distance ≤ 1 always included).
 */
export function selectTests(
  changed: string[],
  tests: string[],
  rev: Map<string, Set<string>>,
  max: number,
): Selection {
  const isTest = new Set(tests);
  const global = changed.filter((f) => GLOBAL_FILES.test(f));
  const dirs = new Set(changed.map((f) => path.posix.dirname(f)));
  const layer0 = tests.filter(
    (t) => isTest.has(t) && (changed.includes(t) || dirs.has(path.posix.dirname(t))),
  );
  const picked = new Set(layer0);
  const seen = new Set(changed);
  let frontier = changed.filter((f) => CODE.test(f));
  let depth = 0;
  let deferred = 0;
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const f of frontier) {
      for (const imp of rev.get(f) ?? []) {
        if (seen.has(imp)) continue;
        seen.add(imp);
        next.push(imp);
      }
    }
    const newTests = next.filter((f) => isTest.has(f) && !picked.has(f));
    if (depth >= 1 && picked.size + newTests.length > max) {
      // Count everything further out as deferred, without adding it.
      const rest = new Set(newTests);
      let far = next;
      while (far.length > 0) {
        const n2: string[] = [];
        for (const f of far) {
          for (const imp of rev.get(f) ?? []) {
            if (seen.has(imp)) continue;
            seen.add(imp);
            n2.push(imp);
            if (isTest.has(imp) && !picked.has(imp)) rest.add(imp);
          }
        }
        far = n2;
      }
      deferred = rest.size;
      break;
    }
    for (const t of newTests) picked.add(t);
    frontier = next;
    if (next.length > 0) depth++;
  }
  return { tests: [...picked].sort(), depth, deferred, global };
}
