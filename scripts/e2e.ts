// `bun run e2e [files…] [playwright args…]`: build once, then per bundle: load it into a fresh
// temp dir, start the server on port 0, run Playwright on the spec files that use that bundle,
// tear down (AGENTS §9.2 "(e2e)").
//
// A spec picks its bundle with a header comment line `// e2e-bundle: <name>` (default
// `sync-probe`). Test mode is always on. Arguments ending in `.ts` filter spec files (substring
// of the path); every other argument goes to Playwright (use `--grep=x`, not `--grep x`).
//
// Up to PP_E2E_WORKERS bundles (default 4; 1 = one after another) run at once, each in its own
// child process (`--bundle <name>`) with its own temp data dir, server port and Playwright
// output dir `test-results/<bundle>/`; their output is prefixed `[bundle]` and a per-bundle
// summary closes the run. The longest bundles (data/e2e-times.json, else most spec files) start
// first. A bundle with a spec carrying a header line `// e2e-serial: <why>` (timing-sensitive
// under load) runs after the others, alone; so does a bundle with a spec that needs software
// WebGL (`--enable-unsafe-swiftshader`: the 3D dice), which starves beside another bundle on a
// CI machine without a GPU.
//
// `--shard=<i>/<n>` (CI) runs only the i-th of n bundle sets, balanced by the committed bundle
// times in scripts/e2e-times.json (else spec count), so every shard computes the same split.
// `--no-build` reuses an existing `dist/client/` (local re-runs of one spec). On GitHub Actions
// the summary also goes to the job summary and each failure becomes an error annotation.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { library } from "../fixtures";
import { parseConfig, WORKTREE_ROOT } from "../src/server/config";
import { resetAndLoad } from "../src/server/features/fixtures-adapters/loader";
import { readLock } from "../src/server/runtime/lock";
import { manifestPath } from "../src/server/runtime/manifest";
import { forwardLines, type ServerProcess, spawnServer } from "./lib/server-process";
import { envCount, pool } from "./lib/test-files";

const DEFAULT_BUNDLE = "sync-probe";
const SERVER_START_TIMEOUT_MS = 60_000;
const BUNDLE_LINE = /^\/\/\s*e2e-bundle:\s*([a-z0-9][a-z0-9-]*)\s*$/m;
const SERIAL_LINE = /^\/\/\s*e2e-serial:\s*\S/m;
const SOFTWARE_WEBGL = /--enable-unsafe-swiftshader/;
const TIMES_FILE = path.join(WORKTREE_ROOT, "data", "e2e-times.json");
/** Committed bundle seconds (one bundle alone), the CI shard weights; refreshed from CI runs. */
const SHARD_TIMES_FILE = path.join(WORKTREE_ROOT, "scripts", "e2e-times.json");
/** Weight of a bundle with no recorded time, per spec file. */
const SECS_PER_SPEC = 20;
const SHARD_ARG = /^--shard=(\d+)\/(\d+)$/;

async function run(cmd: string[], env: Record<string, string | undefined> = process.env) {
  const p = Bun.spawn(cmd, { cwd: WORKTREE_ROOT, env, stdout: "inherit", stderr: "inherit" });
  return p.exited;
}

/** Spec files (posix-style, relative to `root`) grouped by bundle, in name order. */
export function groupSpecs(filters: string[], root = WORKTREE_ROOT): Map<string, string[]> {
  const files = readdirSync(path.join(root, "e2e"), { recursive: true, encoding: "utf8" })
    .map((f) => `e2e/${f.split(path.sep).join("/")}`)
    .filter((f) => f.endsWith(".e2e.ts") && !f.startsWith("e2e/support/"))
    .filter((f) => filters.length === 0 || filters.some((x) => f.includes(x.replaceAll("\\", "/"))))
    .sort();
  const groups = new Map<string, string[]>();
  for (const f of files) {
    const m = BUNDLE_LINE.exec(readFileSync(path.join(root, f), "utf8"));
    const bundle = m?.[1] ?? DEFAULT_BUNDLE;
    groups.set(bundle, [...(groups.get(bundle) ?? []), f]);
  }
  return groups;
}

/**
 * Bundles with a spec marked `// e2e-serial: <why>` or needing software WebGL: run alone, after
 * the parallel ones.
 */
export function serialBundles(groups: Map<string, string[]>, root = WORKTREE_ROOT): Set<string> {
  const out = new Set<string>();
  for (const [bundle, files] of groups) {
    const src = files.map((f) => readFileSync(path.join(root, f), "utf8"));
    if (src.some((s) => SERIAL_LINE.test(s) || SOFTWARE_WEBGL.test(s))) {
      out.add(bundle);
    }
  }
  return out;
}

/** Bundle names, longest first: by recorded seconds, then spec file count, then name. */
export function bundleOrder(
  groups: Map<string, string[]>,
  times: Record<string, number>,
): string[] {
  const weight = (b: string) => times[b] ?? 0;
  return [...groups.keys()].sort(
    (a, b) =>
      weight(b) - weight(a) || groups.get(b)!.length - groups.get(a)!.length || a.localeCompare(b),
  );
}

/**
 * The bundles of shard `i` (1-based) of `n`: longest first, each to the lightest shard, by
 * `times` (else spec count × SECS_PER_SPEC). Deterministic for the same groups and times.
 */
export function shardBundles(
  groups: Map<string, string[]>,
  times: Record<string, number>,
  i: number,
  n: number,
): string[] {
  const weight = (b: string) => times[b] ?? groups.get(b)!.length * SECS_PER_SPEC;
  const shards = Array.from({ length: n }, () => ({ bundles: [] as string[], t: 0 }));
  for (const b of bundleOrder(
    groups,
    Object.fromEntries([...groups.keys()].map((k) => [k, weight(k)])),
  )) {
    const s = shards.reduce((a, c) => (c.t < a.t ? c : a));
    s.bundles.push(b);
    s.t += weight(b);
  }
  return shards[i - 1]?.bundles ?? [];
}

export interface Counts {
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  notRun: number;
}

const COUNT_LINE = /^\s*(\d+) (passed|failed|flaky|skipped|did not run)\b/;

/** Add a Playwright `list` summary line ("  12 passed (1.2m)", "  1 flaky", …) to `c`. */
export function countLine(line: string, c: Counts): boolean {
  const m = COUNT_LINE.exec(line);
  if (!m) return false;
  const n = Number(m[1]);
  const key = ({ passed: "passed", failed: "failed", flaky: "flaky", skipped: "skipped" } as const)[
    m[2] as "passed"
  ];
  if (key) c[key] += n;
  else c.notRun += n;
  return true;
}

/** One bundle in this process: load, serve, Playwright (output dir `test-results/<bundle>/`). */
async function runBundle(bundle: string, files: string[], pwArgs: string[]): Promise<number> {
  console.log(`\n=== e2e bundle "${bundle}": ${files.join(", ")}`);
  const dir = mkdtempSync(path.join(os.tmpdir(), "pp-e2e-"));
  const secret = `e2e-${crypto.randomUUID()}`;
  const env: Record<string, string | undefined> = {
    ...process.env,
    PP_PROFILE: "verify",
    PP_PORT: "0",
    PP_DATA_DIR: dir,
    PP_DB_PATH: "",
    PP_ASSET_DIR: "",
    PP_DATA_DISPOSABLE: "1",
    PP_TEST_MODE: "1",
    PP_DM_SECRET: secret,
    PP_PUBLIC_BASE_URL: "",
  };
  let server: ServerProcess | null = null;
  try {
    await resetAndLoad(parseConfig(env), library, bundle);
    server = spawnServer(["--client"], { env });
    // Under load (parallel worktrees and bundles, cold build cache) startup can take well over
    // 10 s; a server that exits fails at once instead of waiting out the timeout.
    let port: number | null = null;
    const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
    while (port === null && Date.now() < deadline) {
      await Bun.sleep(100);
      const { exitCode, signalCode } = server.proc;
      if (exitCode !== null || signalCode !== null) {
        throw new Error(`Server exited during startup (${exitCode ?? signalCode})`);
      }
      const lock = readLock(dir);
      if (lock?.owner === "server" && lock.port) port = lock.port;
    }
    if (port === null) {
      throw new Error(
        `Server did not start within ${SERVER_START_TIMEOUT_MS / 1000} s (no port in server.lock)`,
      );
    }
    // Own output dir per bundle: parallel runs never share traces or `.last-run.json`.
    const output = `--output=${path.join("test-results", bundle)}`;
    return await run(["bun", "x", "playwright", "test", output, ...files, ...pwArgs], {
      ...process.env,
      E2E_BASE_URL: `http://127.0.0.1:${port}`,
      E2E_DM_SECRET: secret,
      E2E_MANIFEST: manifestPath(dir),
      E2E_BUNDLE: bundle,
    });
  } catch (err) {
    console.error(err);
    return 1;
  } finally {
    // Clean stop (removes server.lock); hard kill only if it hangs.
    await server?.stop();
    // The in-process load's prepared statements keep the DB file open on Windows until they
    // are collected (see closeDb); collect, then retry briefly, then warn only.
    Bun.gc(true);
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    } catch (err) {
      console.warn(`Could not remove ${dir}: ${(err as Error).message}`);
    }
  }
}

interface BundleResult {
  bundle: string;
  code: number;
  counts: Counts;
  secs: number;
  /** Playwright's numbered failure headers ("1) e2e\x.e2e.ts:12:3 › …"). */
  failures: string[];
}

/** A numbered failure header, with or without a `[project]` tag. */
export const FAILURE_LINE = /^\s+\d+\) \S.* › /;

/** One bundle in a child process, its output forwarded (prefixed when bundles run at once). */
async function spawnBundle(
  bundle: string,
  files: string[],
  pwArgs: string[],
  prefix: boolean,
): Promise<BundleResult> {
  const t0 = performance.now();
  const p = Bun.spawn(["bun", "scripts/e2e.ts", "--bundle", bundle, ...files, ...pwArgs], {
    cwd: WORKTREE_ROOT,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const counts: Counts = { passed: 0, failed: 0, flaky: 0, skipped: 0, notRun: 0 };
  const failures: string[] = [];
  const tag = prefix ? `[${bundle}] ` : "";
  const onLine = (line: string, err: boolean) => {
    countLine(line, counts);
    const head = line.replace(/\s*─+\s*$/, "").trim();
    if (FAILURE_LINE.test(line) && !failures.includes(head)) failures.push(head);
    (err ? console.error : console.log)(`${tag}${line}`);
  };
  await Promise.all([
    forwardLines(p.stdout, (l) => onLine(l, false)),
    forwardLines(p.stderr, (l) => onLine(l, true)),
    p.exited,
  ]);
  return { bundle, code: p.exitCode ?? 1, counts, secs: (performance.now() - t0) / 1000, failures };
}

function readTimes(file = TIMES_FILE): Record<string, number> {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  } catch {
    return {};
  }
}

/** GitHub Actions: the summary as markdown in the job summary, failures as annotations. */
function githubReport(results: BundleResult[], label: string) {
  const out = process.env.GITHUB_STEP_SUMMARY;
  if (!process.env.GITHUB_ACTIONS || !out) return;
  const bad = results.filter((r) => r.code !== 0 || r.counts.flaky > 0);
  const lines = [`### e2e ${label}`, ""];
  const sum = (k: keyof Counts) => results.reduce((s, r) => s + r.counts[k], 0);
  lines.push(
    `${results.length} bundle(s): ${sum("passed")} passed, ${sum("failed")} failed, ${sum("flaky")} flaky`,
    "",
  );
  for (const r of bad) {
    lines.push(`- **${r.code !== 0 ? "FAIL" : "flaky"}** \`${r.bundle}\``);
    for (const f of r.failures) lines.push(`  - \`${f}\``);
    if (r.code !== 0) {
      const title = `e2e bundle ${r.bundle} failed`;
      console.log(`::error title=${title}::${r.failures.join(" | ") || "see the job log"}`);
    } else {
      console.log(`::warning title=e2e bundle ${r.bundle} flaky::${r.failures.join(" | ")}`);
    }
  }
  try {
    appendFileSync(out, `${lines.join("\n")}\n`);
  } catch {
    // the summary is a convenience; the log has it all
  }
}

function summary(results: BundleResult[], secs: number) {
  const pad = Math.max(...results.map((r) => r.bundle.length));
  console.log(`\n=== e2e summary (${results.length} bundle(s), ${secs.toFixed(0)} s)`);
  for (const r of results) {
    const c = r.counts;
    const extra = [
      c.flaky && `${c.flaky} flaky`,
      c.skipped && `${c.skipped} skipped`,
      c.notRun && `${c.notRun} did not run`,
    ].filter(Boolean);
    const state = r.code === 0 ? "ok  " : "FAIL";
    console.log(
      `  ${state} ${r.bundle.padEnd(pad)}  ${c.passed} passed, ${c.failed} failed${extra.length ? `, ${extra.join(", ")}` : ""}  [${r.secs.toFixed(0)} s]`,
    );
    for (const f of r.failures) console.log(`         ${f}`);
  }
  const sum = (k: keyof Counts) => results.reduce((s, r) => s + r.counts[k], 0);
  console.log(
    `  total: ${sum("passed")} passed, ${sum("failed")} failed, ${sum("flaky")} flaky, ${sum("skipped")} skipped`,
  );
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  // Child mode: one bundle, the parent already built and grouped.
  if (args[0] === "--bundle") {
    const [, bundle, ...rest] = args;
    process.exit(
      await runBundle(
        bundle!,
        rest.filter((a) => a.endsWith(".ts")),
        rest.filter((a) => !a.endsWith(".ts")),
      ),
    );
  }
  const filters = args.filter((a) => a.endsWith(".ts"));
  const shardArg = args.map((a) => SHARD_ARG.exec(a)).find(Boolean);
  const noBuild = args.includes("--no-build");
  const pwArgs = args.filter((a) => !a.endsWith(".ts") && !SHARD_ARG.test(a) && a !== "--no-build");
  const groups = groupSpecs(filters);
  if (groups.size === 0) {
    console.error(`No e2e spec matches ${filters.join(", ")}`);
    process.exit(1);
  }
  let label = "";
  if (shardArg) {
    const [i, n] = [Number(shardArg[1]), Number(shardArg[2])];
    if (!(n >= 1 && i >= 1 && i <= n)) {
      console.error(`Bad --shard=${i}/${n}`);
      process.exit(1);
    }
    const mine = new Set(shardBundles(groups, readTimes(SHARD_TIMES_FILE), i, n));
    for (const b of [...groups.keys()]) if (!mine.has(b)) groups.delete(b);
    label = `shard ${i}/${n}`;
    if (groups.size === 0) {
      console.log(`=== e2e ${label}: no bundles`);
      process.exit(0);
    }
  }
  if (noBuild && existsSync(path.join(WORKTREE_ROOT, "dist", "client"))) {
    console.log("=== e2e: --no-build, reusing dist/client/");
  } else if ((await run(["bun", "x", "vite", "build"])) !== 0) process.exit(1);
  const workers = Math.min(envCount("PP_E2E_WORKERS", 4), groups.size);
  const times = readTimes();
  const order = bundleOrder(groups, times);
  const serial = serialBundles(groups);
  console.log(
    `\n=== e2e: ${order.length} bundle(s), ${workers} at a time` +
      (serial.size > 0 ? `; then alone: ${[...serial].join(", ")}` : ""),
  );
  const t0 = performance.now();
  const done = await pool(
    order.filter((b) => !serial.has(b)),
    workers,
    (b) => spawnBundle(b, groups.get(b)!, pwArgs, workers > 1),
  );
  for (const b of order.filter((x) => serial.has(x))) {
    done.push(await spawnBundle(b, groups.get(b)!, pwArgs, workers > 1));
  }
  const results = done.sort((a, b) => a.bundle.localeCompare(b.bundle));
  // Record bundle times for the next run's order (whole-suite runs and filtered ones alike).
  try {
    for (const r of results) times[r.bundle] = Math.round(r.secs);
    mkdirSync(path.dirname(TIMES_FILE), { recursive: true });
    writeFileSync(TIMES_FILE, `${JSON.stringify(times, null, 2)}\n`);
  } catch (err) {
    console.warn(`Could not write ${TIMES_FILE}: ${(err as Error).message}`);
  }
  summary(results, (performance.now() - t0) / 1000);
  githubReport(results, label);
  const failed = results.filter((r) => r.code !== 0).map((r) => r.bundle);
  if (failed.length > 0) console.error(`\ne2e failed for bundle(s): ${failed.join(", ")}`);
  process.exit(failed.length === 0 ? 0 : 1);
}
