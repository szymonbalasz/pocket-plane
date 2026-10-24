// `bun run check`: typecheck + lint + `bun test`, all at once; `bun run check:full` (`--full`)
// adds the slow set (`*.slow.test.ts`). The tests run in PP_TEST_SHARDS processes (default
// min(6, cores / 4); 1 = one plain `bun test` process), split by the recorded per-file times in
// scripts/test-times.json (`bun run test:times`), else by count, with a 30 s hang-guard timeout.
// Every shard is its own `bun test` with the same preload, so each test file keeps its isolation
// (`:memory:` DB, temp dirs, port 0). Exits non-zero if any step fails.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WORKTREE_ROOT } from "../src/server/config";
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
async function capture(name: string, cmd: string[]): Promise<Result> {
  const t0 = performance.now();
  const p = Bun.spawn(cmd, { cwd: WORKTREE_ROOT, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
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

if (import.meta.main) {
  const full = process.argv.includes("--full");
  const cores = os.availableParallelism();
  const shards = envCount("PP_TEST_SHARDS", Math.max(1, Math.min(6, Math.floor(cores / 4))));
  const all = listTestFiles();
  const files = full ? all : all.filter((f) => !SLOW_TEST.test(f));
  const slow = all.length - files.length;
  const split = shard(files, shards, readTimes());
  console.log(
    `== check${full ? ":full" : ""}: typecheck + lint + ${files.length} test files in ${split.length} shard(s)` +
      (full ? "" : ` (${slow} slow file(s) skipped: bun run check:full)`),
  );

  const tmp = mkdtempSync(path.join(os.tmpdir(), "pp-check-"));
  const t0 = performance.now();
  const steps: Promise<Result>[] = [
    capture("typecheck", ["bun", "x", "tsc", "--noEmit"]),
    capture("lint", ["bun", "x", "biome", "check", "."]),
  ];
  const junit = split.map((_, i) => path.join(tmp, `shard-${i + 1}.xml`));
  split.forEach((list, i) => {
    const reporter = [TEST_TIMEOUT_ARG, "--reporter=junit", `--reporter-outfile=${junit[i]}`];
    // One shard (PP_TEST_SHARDS=1): today's plain run, the slow set left out by pattern.
    const which =
      split.length === 1 && !full
        ? ["--path-ignore-patterns=**/*.slow.test.*"]
        : list.map((f) => `./${f}`);
    steps.push(capture(`test ${i + 1}/${split.length}`, ["bun", "test", ...reporter, ...which]));
  });
  const results = await Promise.all(steps);

  let failed = false;
  for (const r of results.slice(0, 2)) {
    const out = r.out.trim();
    if (r.code !== 0 || /\bwarning|error/i.test(out)) console.log(`\n== ${r.name}\n${out}`);
    if (r.code !== 0) failed = true;
  }
  const total = { tests: 0, failures: 0, skipped: 0 };
  const failedTests: string[] = [];
  results.slice(2).forEach((r, i) => {
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
      console.log(`\n== ${r.name} (exit ${r.code})\n${failureOutput(r.out)}`);
    }
  });
  rmSync(tmp, { recursive: true, force: true });

  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(
    `\n tests: ${total.tests - total.failures - total.skipped} pass, ${total.failures} fail, ${total.skipped} skip (${files.length} files, ${split.length} shard(s))`,
  );
  if (failedTests.length > 0) {
    console.log("\nfailed tests:");
    for (const t of failedTests) console.log(`  (fail) ${t}`);
  }
  console.log(`\ncheck${full ? ":full" : ""}: ${failed ? "FAILED" : "all green"} [${secs} s]`);
  process.exit(failed ? 1 : 0);
}
