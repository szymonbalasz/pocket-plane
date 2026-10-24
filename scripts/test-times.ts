// `bun run test:times [filters…]`: run each test file in its own `bun test` process (incl. the
// slow set; PP_TEST_TIMES_JOBS at once, default 8), record its wall time in
// scripts/test-times.json (what `bun run check` balances its shards by; filters time only the
// matching files and keep the other entries) and write a report, slowest first, to
// data/test-times.md. Times include process start + preload and grow with machine load: they are
// weights, not benchmarks.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { WORKTREE_ROOT } from "../src/server/config";
import {
  envCount,
  listTestFiles,
  pool,
  readTimes,
  SLOW_TEST,
  TEST_TIMEOUT_ARG,
  TIMES_FILE,
} from "./lib/test-files";

const REPORT = path.join(WORKTREE_ROOT, "data", "test-times.md");
const TOP = 25;

const filters = process.argv.slice(2).map((f) => f.replaceAll("\\", "/"));
const files = listTestFiles().filter(
  (f) => filters.length === 0 || filters.some((x) => f.includes(x)),
);
if (files.length === 0) {
  console.error(`No test file matches ${filters.join(", ")}`);
  process.exit(1);
}
const jobs = envCount("PP_TEST_TIMES_JOBS", 8);
console.log(`== test:times: ${files.length} file(s), ${jobs} at a time`);

const t0 = performance.now();
let done = 0;
const results = await pool(files, jobs, async (f) => {
  const start = performance.now();
  const p = Bun.spawn(["bun", "test", TEST_TIMEOUT_ARG, `./${f}`], {
    cwd: WORKTREE_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "ignore",
  });
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  const secs = (performance.now() - start) / 1000;
  done++;
  if (done % 50 === 0 || code !== 0) {
    console.log(`  ${done}/${files.length}${code !== 0 ? `  FAIL ${f} (exit ${code})` : ""}`);
  }
  return { f, secs, code, out: code === 0 ? "" : `${out}${err}`.trim() };
});

const times = readTimes();
for (const r of results) times.set(r.f, Math.round(r.secs * 100) / 100);
const known = new Set(listTestFiles());
const entries = [...times].filter(([f]) => known.has(f)).sort(([a], [b]) => a.localeCompare(b));
writeFileSync(
  TIMES_FILE,
  `${JSON.stringify(
    {
      note: "Per-test-file wall times in seconds (own process, incl. start + preload), written by `bun run test:times`; `bun run check` balances its shards by them.",
      files: Object.fromEntries(entries),
    },
    null,
    2,
  )}\n`,
);

const sorted = [...results].sort((a, b) => b.secs - a.secs);
const row = (r: (typeof results)[number], i: number) =>
  `| ${i + 1} | \`${r.f}\` | ${r.secs.toFixed(1)} | ${SLOW_TEST.test(r.f) ? "slow" : ""}${r.code !== 0 ? " FAIL" : ""} |`;
const failed = results.filter((r) => r.code !== 0);
const wall = (performance.now() - t0) / 1000;
const report = [
  `# Test file times (${new Date().toISOString()})`,
  "",
  `${files.length} file(s), ${jobs} at a time, ${wall.toFixed(0)} s wall; sum ${results.reduce((s, r) => s + r.secs, 0).toFixed(0)} s.${failed.length ? ` ${failed.length} failed.` : ""}`,
  "",
  "| # | File | s | |",
  "|---|---|---|---|",
  ...sorted.map(row),
  "",
  ...failed.flatMap((r) => [`## FAIL \`${r.f}\``, "", "```", r.out, "```", ""]),
].join("\n");
mkdirSync(path.dirname(REPORT), { recursive: true });
writeFileSync(REPORT, report);

console.log(`\n${TOP} slowest:`);
for (const [i, r] of sorted.slice(0, TOP).entries()) {
  console.log(`  ${String(i + 1).padStart(2)}. ${r.secs.toFixed(1).padStart(6)} s  ${r.f}`);
}
console.log(
  `\nwrote ${path.relative(WORKTREE_ROOT, TIMES_FILE)} and ${path.relative(WORKTREE_ROOT, REPORT)} [${wall.toFixed(0)} s]`,
);
if (failed.length > 0) {
  console.error(`${failed.length} file(s) failed: ${failed.map((r) => r.f).join(", ")}`);
  process.exit(1);
}
