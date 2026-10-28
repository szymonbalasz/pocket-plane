// `bun run ci:watch [<sha|ref>]`: wait for the GitHub Actions runs on a pushed commit (default
// HEAD) and print one short verdict: green, or the failed jobs with their error annotations
// (failed tests, failed steps). Exit 0 green / superseded, 1 failed, 2 no run or timed out.
// Meant to run in the background right after `git push` (an agent's background task, a spare
// terminal): keep working, and look only when it exits non-zero. Needs `gh` logged in.
const POLL_MS = 20_000;
const APPEAR_MS = 3 * 60_000;
const TIMEOUT_MS = 60 * 60_000;
const MAX_ANNOTATIONS = 25;

interface Run {
  databaseId: number;
  workflowName: string;
  status: string;
  conclusion: string;
  url: string;
}
interface Job {
  databaseId: number;
  name: string;
  conclusion: string;
  url: string;
}
interface Annotation {
  annotation_level: string;
  title: string | null;
  message: string;
  path: string;
}

function sh(cmd: string[]): string {
  const p = Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${cmd.join(" ")}: ${p.stderr.toString().trim()}`);
  return p.stdout.toString();
}
const gh = <T>(args: string[]): T => JSON.parse(sh(["gh", ...args])) as T;

/** Runs for the commit, the newest per workflow (a re-run replaces an older attempt). */
export function latestPerWorkflow(runs: Run[]): Run[] {
  const seen = new Map<string, Run>();
  for (const r of [...runs].sort((a, b) => b.databaseId - a.databaseId)) {
    if (!seen.has(r.workflowName)) seen.set(r.workflowName, r);
  }
  return [...seen.values()];
}

/** The verdict across finished runs: failed wins; all cancelled = superseded by a newer push. */
export function verdict(runs: Run[]): "green" | "failed" | "superseded" {
  if (runs.some((r) => ["failure", "timed_out", "startup_failure"].includes(r.conclusion))) {
    return "failed";
  }
  if (runs.length > 0 && runs.every((r) => r.conclusion === "cancelled")) return "superseded";
  return "green";
}

async function main() {
  const ref = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? "HEAD";
  const sha = sh(["git", "rev-parse", ref]).trim();
  const short = sha.slice(0, 8);
  const subject = sh(["git", "log", "-1", "--format=%s", sha]).trim();
  const repo = gh<{ nameWithOwner: string }>([
    "repo",
    "view",
    "--json",
    "nameWithOwner",
  ]).nameWithOwner;
  const fields = "databaseId,workflowName,status,conclusion,url";
  const t0 = Date.now();
  let runs: Run[] = [];
  console.log(`ci:watch ${short} "${subject}"`);
  for (;;) {
    runs = latestPerWorkflow(
      gh<Run[]>(["run", "list", "--commit", sha, "--json", fields, "--limit", "50"]),
    );
    if (runs.length === 0 && Date.now() - t0 > APPEAR_MS) {
      console.log(`ci:watch ${short}: no CI run appeared in ${APPEAR_MS / 60_000} min (pushed?)`);
      process.exit(2);
    }
    if (runs.length > 0 && runs.every((r) => r.status === "completed")) break;
    if (Date.now() - t0 > TIMEOUT_MS) {
      console.log(`ci:watch ${short}: still running after ${TIMEOUT_MS / 60_000} min`);
      for (const r of runs) console.log(`  ${r.workflowName}: ${r.status} ${r.url}`);
      process.exit(2);
    }
    await Bun.sleep(POLL_MS);
  }
  const mins = ((Date.now() - t0) / 60_000).toFixed(1);
  const v = verdict(runs);
  if (v !== "failed") {
    console.log(
      `ci:watch ${short}: ${v === "green" ? "GREEN" : "superseded (cancelled by a newer push)"} [${mins} min]`,
    );
    process.exit(0);
  }
  console.log(`ci:watch ${short}: FAILED [${mins} min]`);
  for (const r of runs.filter((x) => x.conclusion !== "success" && x.conclusion !== "skipped")) {
    console.log(`  ${r.workflowName}: ${r.conclusion}  ${r.url}`);
    const { jobs } = gh<{ jobs: Job[] }>(["run", "view", String(r.databaseId), "--json", "jobs"]);
    for (const j of jobs.filter(
      (x) => x.conclusion === "failure" || x.conclusion === "timed_out",
    )) {
      console.log(`    job ${j.name}: ${j.conclusion}`);
      let notes: Annotation[] = [];
      try {
        notes = gh<Annotation[]>(["api", `repos/${repo}/check-runs/${j.databaseId}/annotations`]);
      } catch {
        // annotations are a convenience; the job URL has the log
      }
      const errors = notes.filter((n) => n.annotation_level === "failure");
      for (const n of errors.slice(0, MAX_ANNOTATIONS)) {
        console.log(`      ${n.title ? `${n.title}: ` : ""}${n.message.split("\n")[0]}`);
      }
      if (errors.length > MAX_ANNOTATIONS)
        console.log(`      … ${errors.length - MAX_ANNOTATIONS} more`);
    }
  }
  console.log(
    `  logs: gh run view ${runs.find((r) => r.conclusion === "failure")?.databaseId ?? ""} --log-failed`,
  );
  process.exit(1);
}

if (import.meta.main) await main();
