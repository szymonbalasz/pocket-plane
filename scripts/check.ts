// `bun run check`: typecheck + lint + the tests a change can most likely break (scripts/lib/
// affected.ts: changed tests, tests in changed folders, then their importers, nearest first).
// `bun run check:all` (`--all`) runs every test but the slow set (`*.slow.test.ts`); `check:full`
// (`--full`) every test. The full suite runs in GitHub CI on every push (.github/workflows/ci.yml),
// so locally the targeted run is the normal one.
//
// Flags: `--tests-only` (no typecheck / lint: `bun run test:changed`), `--slow` (keep affected slow
// files), `--base=<ref>` (diff base, default the merge base with main), `--max=<n>` (targeted
// cap, default 80 files), `--list` (print the selection, run nothing), `--shard=<i>/<n>` (CI: the
// i-th of n time-balanced parts of the chosen files).
//
// The tests run in PP_TEST_SHARDS processes (default min(6, cores / 4); 1 = one process), split
// by the recorded per-file times in scripts/test-times.json (`bun run test:times`), else by count,
// with a 30 s hang-guard timeout. Every shard is its own `bun test` with the same preload, so each
// test file keeps its isolation (`:memory:` DB, temp dirs, port 0). Exits non-zero if any step
// fails. On GitHub Actions failures also become error annotations and a job summary.
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WORKTREE_ROOT } from "../src/server/config";
import {
  changedFiles,
  git,
  mergeBase,
  reverseGraph,
  selectTests,
  sourceFiles,
} from "./lib/affected";
import { fixtureCacheEnv } from "./lib/fixture-cache";
import {
  envCount,
  listTestFiles,
  readTimes,
  SLOW_TEST,
  shard,
  TEST_TIMEOUT_ARG,
} from "./lib/test-files";

interface Result {
  name: string;
  code: number;
  out: string;
  ms: number;
}

/** Run `cmd` with its output captured (printed by the caller, so steps don't interleave). */
async function capture(
  name: string,
  cmd: string[],
  env: Record<string, string | undefined> = process.env,
): Promise<Result> {
  const t0 = performance.now();
  const p = Bun.spawn(cmd, {
    cwd: WORKTREE_ROOT,
    env,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  const r = { name, code, out: `${out}${err}`, ms: performance.now() - t0 };
  console.log(`  ${code === 0 ? "ok  " : "FAIL"} ${name} [${(r.ms / 1000).toFixed(1)} s]`);
  return r;
}

interface Junit {
  tests: number;
  failures: number;
  skipped: number;
  /** "file > test name" per failed test case. */
  failed: string[];
}

const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? "";
const unxml = (s: string) =>
  s
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");

export function parseJunit(xml: string): Junit {
  const top = /<testsuites\b[^>]*>/.exec(xml)?.[0] ?? "";
  const failed: string[] = [];
  // A failed case is a non-self-closing <testcase …> holding a <failure.
  for (const m of xml.matchAll(/<testcase\b([^>]*[^/])>([\s\S]*?)<\/testcase>/g)) {
    if (!m[2]!.includes("<failure")) continue;
    const file = unxml(attr(m[1]!, "file")).replaceAll("\\", "/");
    const cls = unxml(attr(m[1]!, "classname"));
    const name = unxml(attr(m[1]!, "name"));
    failed.push(`${file} > ${cls ? `${cls} > ` : ""}${name}`);
  }
  return {
    tests: Number(attr(top, "tests")) || 0,
    failures: Number(attr(top, "failures")) || 0,
    skipped: Number(attr(top, "skipped")) || 0,
    failed,
  };
}

/** Bun's console output minus the per-file headers of files with nothing to say. */
function failureOutput(out: string): string {
  const lines = out.split(/\r?\n/);
  return lines
    .filter(
      (l, i) => !(/^\S.*\.[jt]sx?:$/.test(l) && /^\S.*\.[jt]sx?:$|^$/.test(lines[i + 1] ?? "")),
    )
    .join("\n")
    .trim();
}

/** GitHub Actions: failed steps and tests as error annotations plus a job summary. */
function githubReport(label: string, line: string, failedTests: string[], failedSteps: string[]) {
  if (!process.env.GITHUB_ACTIONS) return;
  for (const s of failedSteps)
    console.log(`::error title=${s} failed::see the ${s} output in the log`);
  for (const t of failedTests)
    console.log(`::error file=${t.split(" > ")[0]},title=test failed::${t}`);
  const out = process.env.GITHUB_STEP_SUMMARY;
  if (!out) return;
  const lines = [`### ${label}`, "", line, ""];
  for (const s of failedSteps) lines.push(`- **${s} failed**`);
  for (const t of failedTests) lines.push(`- \`${t}\``);
  try {
    appendFileSync(out, `${lines.join("\n")}\n`);
  } catch {
    // the summary is a convenience; the log has it all
  }
}

const flag = (name: string) => process.argv.includes(`--${name}`);
const option = (name: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

/** The targeted file set: affected tests; slow ones only if changed themselves or `--slow`. */
function targeted(all: string[]): { files: string[]; note: string } {
  const base = mergeBase(git, option("base"));
  const changed = changedFiles(git, base);
  const graph = reverseGraph(WORKTREE_ROOT, sourceFiles(WORKTREE_ROOT));
  const sel = selectTests(changed, all, graph, Number(option("max") ?? 80));
  const files = sel.tests.filter((f) => flag("slow") || !SLOW_TEST.test(f) || changed.includes(f));
  const notes = [
    `${changed.length} changed since ${base.slice(0, 8)}, import distance ≤ ${sel.depth}`,
  ];
  if (sel.tests.length > files.length)
    notes.push(`${sel.tests.length - files.length} slow left out (--slow)`);
  if (sel.deferred > 0) notes.push(`${sel.deferred} further affected left to CI`);
  if (sel.global.length > 0)
    notes.push(`global change (${sel.global.join(", ")}): CI or check:all`);
  const e2e = changed.filter((f) => f.endsWith(".e2e.ts"));
  if (e2e.length > 0) notes.push(`changed e2e: bun run e2e ${e2e.join(" ")} --no-build`);
  return { files, note: notes.join("; ") };
}

if (import.meta.main) {
  const full = flag("full");
  const every = full || flag("all");
  const testsOnly = flag("tests-only");
  const name = full ? "check:full" : every ? "check:all" : testsOnly ? "test:changed" : "check";
  const cores = os.availableParallelism();
  const shards = envCount("PP_TEST_SHARDS", Math.max(1, Math.min(6, Math.floor(cores / 4))));
  const all = listTestFiles();
  let files: string[];
  let note: string;
  if (every) {
    files = full ? all : all.filter((f) => !SLOW_TEST.test(f));
    note = full ? "every test" : `${all.length - files.length} slow file(s) skipped: check:full`;
  } else ({ files, note } = targeted(all));
  const ciShard = /^(\d+)\/(\d+)$/.exec(option("shard") ?? "");
  if (ciShard) {
    const [i, n] = [Number(ciShard[1]), Number(ciShard[2])];
    files = shard(files, n, readTimes())[i - 1] ?? [];
    note += `; CI part ${i}/${n}`;
  }
  if (flag("list")) {
    console.log(`== ${name}: ${files.length} test file(s) (${note})`);
    for (const f of files) console.log(`  ${f}`);
    process.exit(0);
  }
  const split = shard(files, shards, readTimes());
  console.log(
    `== ${name}: ${testsOnly ? "" : "typecheck + lint + "}${files.length} test file(s) in ${split.length} shard(s) (${note})`,
  );

  const tmp = mkdtempSync(path.join(os.tmpdir(), "pp-check-"));
  const t0 = performance.now();
  const steps: Promise<Result>[] = testsOnly
    ? []
    : [
        capture("typecheck", ["bun", "x", "tsc", "--noEmit"]),
        capture("lint", ["bun", "x", "biome", "check", "."]),
      ];
  const nStatic = steps.length;
  // One code hash for every shard: they all name the same bundle snapshot cache.
  const testEnv = { ...process.env, ...fixtureCacheEnv() };
  const junit = split.map((_, i) => path.join(tmp, `shard-${i + 1}.xml`));
  split.forEach((list, i) => {
    const reporter = [TEST_TIMEOUT_ARG, "--reporter=junit", `--reporter-outfile=${junit[i]}`];
    // One shard over every file (PP_TEST_SHARDS=1): a plain run, the slow set left out by
    // pattern (a ~750-path command line is over Windows' limit).
    const whole = split.length === 1 && every && !ciShard;
    const which = !whole
      ? list.map((f) => `./${f}`)
      : full
        ? []
        : ["--path-ignore-patterns=**/*.slow.test.*"];
    steps.push(
      capture(`test ${i + 1}/${split.length}`, ["bun", "test", ...reporter, ...which], testEnv),
    );
  });
  const results = await Promise.all(steps);

  let failed = false;
  const failedSteps: string[] = [];
  for (const r of results.slice(0, nStatic)) {
    const out = r.out.trim();
    if (r.code !== 0 || /\bwarning|error/i.test(out)) console.log(`\n== ${r.name}\n${out}`);
    if (r.code !== 0) {
      failed = true;
      failedSteps.push(r.name);
    }
  }
  const total = { tests: 0, failures: 0, skipped: 0 };
  const failedTests: string[] = [];
  results.slice(nStatic).forEach((r, i) => {
    let j: Junit | null = null;
    try {
      j = parseJunit(readFileSync(junit[i]!, "utf8"));
    } catch {
      // no report: the process died; its output below says why
    }
    if (j) {
      total.tests += j.tests;
      total.failures += j.failures;
      total.skipped += j.skipped;
      failedTests.push(...j.failed);
    }
    if (r.code !== 0 || !j) {
      failed = true;
      if (!j) failedSteps.push(r.name);
      console.log(`\n== ${r.name} (exit ${r.code})\n${failureOutput(r.out)}`);
    }
  });
  rmSync(tmp, { recursive: true, force: true });

  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  const line = `tests: ${total.tests - total.failures - total.skipped} pass, ${total.failures} fail, ${total.skipped} skip (${files.length} files, ${split.length} shard(s))`;
  console.log(`\n ${line}`);
  if (failedTests.length > 0) {
    console.log("\nfailed tests:");
    for (const t of failedTests) console.log(`  (fail) ${t}`);
  }
  githubReport(`${name}${ciShard ? ` ${ciShard[0]}` : ""}`, line, failedTests, failedSteps);
  console.log(`\n${name}: ${failed ? "FAILED" : "all green"} [${secs} s]`);
  process.exit(failed ? 1 : 0);
}
