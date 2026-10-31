// `bun run upgrade:check` (BL-172, BL-173), end to end on real trees: this tree against itself, and
// against a commit made here (never on a branch) whose schema has a column under another name, so
// this tree's schema "renames" it. Runs the script as the CI job does, on its own temp dir.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WORKTREE_ROOT } from "../src/server/config";

const TIMEOUT_MS = 180_000;

let temp: string;
beforeAll(() => {
  temp = mkdtempSync(path.join(os.tmpdir(), "pp-upgrade-slow-"));
});
afterAll(() => {
  Bun.gc(true);
  try {
    rmSync(temp, { recursive: true, force: true });
  } catch {
    // A temp dir the OS cleans up; never fail the run over it.
  }
});

async function runCheck(args: string[], env: Record<string, string> = {}) {
  const { GITHUB_ACTIONS: _a, GITHUB_STEP_SUMMARY: _s, ...rest } = process.env;
  const p = Bun.spawn(["bun", "scripts/upgrade-check.ts", ...args], {
    cwd: WORKTREE_ROOT,
    env: { ...rest, TEMP: temp, TMP: temp, TMPDIR: temp, ...env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  return { code: await p.exited, stdout, stderr };
}

function git(args: string[], env: Record<string, string> = {}, input?: string): string {
  const r = Bun.spawnSync(["git", ...args], {
    cwd: WORKTREE_ROOT,
    env: { ...process.env, ...env },
    stdin: input === undefined ? "ignore" : Buffer.from(input),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
}

/** HEAD with `token.name` stored as `name_old`: a commit no branch points at (git gc takes it). */
function commitWithColumnElsewhere(): string {
  const file = "src/server/db/schema.ts";
  const schema = git(["show", `HEAD:${file}`]);
  const start = schema.search(/sqliteTable\(\s*"token",/);
  expect(start).toBeGreaterThan(-1);
  const at = schema.indexOf('text("name")', start);
  expect(at).toBeGreaterThan(start);
  const changed = `${schema.slice(0, at)}text("name_old")${schema.slice(at + 'text("name")'.length)}`;
  const blob = git(["hash-object", "-w", "--stdin"], {}, changed);
  const index = { GIT_INDEX_FILE: path.join(temp, "index") };
  git(["read-tree", "HEAD"], index);
  git(["update-index", "--add", "--cacheinfo", `100644,${blob},${file}`], index);
  const tree = git(["write-tree"], index);
  rmSync(index.GIT_INDEX_FILE, { force: true });
  const who = {
    GIT_AUTHOR_NAME: "upgrade-check test",
    GIT_AUTHOR_EMAIL: "upgrade-check@example.invalid",
    GIT_COMMITTER_NAME: "upgrade-check test",
    GIT_COMMITTER_EMAIL: "upgrade-check@example.invalid",
  };
  return git(["commit-tree", tree, "-p", "HEAD", "-m", "upgrade-check test: bad base"], who);
}

/** The script's temp dirs: all gone after a run, passed or failed. */
const leftovers = () => readdirSync(temp).filter((f) => f.startsWith("pp-upgrade-"));

test(
  "BL-173 this tree upgrades from itself: clean start, DM and player snapshots, no rows lost",
  async () => {
    const r = await runCheck(["--base=HEAD", "--bundle=base"]);
    expect(r.stderr).not.toContain("left behind");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("upgrade:check ok");
    expect(r.stdout).toContain("bundle base");
    expect(r.stdout).toContain("dependencies linked");
    expect(leftovers()).toEqual([]);
  },
  TIMEOUT_MS,
);

test(
  "BL-173 a bundle the base doesn't have falls back to `base`, and says so",
  async () => {
    const r = await runCheck(["--base=HEAD", "--bundle=no-such-bundle"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("the base has no bundle no-such-bundle: used base");
    expect(r.stdout).toContain("bundle base");
  },
  TIMEOUT_MS,
);

test(
  "BL-173 a column renamed since the base fails with the refusal, annotated for CI, temp dirs gone",
  async () => {
    const summary = path.join(temp, "summary.md");
    writeFileSync(summary, "");
    const bad = commitWithColumnElsewhere();
    const r = await runCheck([`--base=${bad}`, "--bundle=base"], {
      GITHUB_ACTIONS: "true",
      GITHUB_STEP_SUMMARY: summary,
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("Cannot start: Schema change refused; nothing was changed.");
    expect(r.stderr).toContain("table token: new column(s) name; old column(s) name_old");
    expect(r.stderr).toContain("copy at boot (ADR-0076)");
    expect(r.stdout).toContain("::error title=upgrade check failed::Cannot start: Schema change");
    expect(r.stdout).toContain("%0A");
    expect(readFileSync(summary, "utf8")).toContain("table token: new column(s) name");
    expect(leftovers()).toEqual([]);
  },
  TIMEOUT_MS,
);

test(
  "BL-172 the bad-change boot refuses within seconds with no terminal, DB untouched",
  async () => {
    const r = await runCheck(["--prove-refusal"]);
    expect(r.stderr).toContain("table token: new column(s) name; old column(s) name_old");
    expect(r.stderr).toContain("new table(s) sync_probe; old table(s) sync_probe_old");
    expect(r.stdout).toContain("no terminal here");
    expect(r.stdout.match(/--- PASS: exit 1 in/g)).toHaveLength(2);
    expect(r.code).toBe(0);
    expect(leftovers()).toEqual([]);
  },
  TIMEOUT_MS,
);

test(
  "BL-173 the check refuses a data dir outside temp and data/, before anything runs",
  async () => {
    const outside = path.join(os.homedir(), "pp-upgrade-check-must-not-exist");
    const r = await runCheck([`--data-dir=${outside}`]);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("only runs under");
    expect(leftovers()).toEqual([]);
  },
  TIMEOUT_MS,
);
