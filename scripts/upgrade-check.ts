// `bun run upgrade:check [--base=<ref>] [--bundle=<name>] [--data-dir=<dir>]` (BL-173): proves this
// tree upgrades a populated DB. The merge base's tree goes to a temp dir; THAT tree's schema and
// code build a DB and load a bundle; THIS tree's server then boots on the data as a real campaign
// would (not disposable, no test mode, port 0). Expected: a clean start, a DM and a player snapshot
// over the real WS path, every row valid, no populated table short of rows. A refusal is printed
// as is, so a red CI says what to do.
//
// `--prove-refusal` (BL-172): boots this tree's server, on this process's own terminal, on DBs with
// a column and a table renamed in place. Expected: a refusal within seconds, DB untouched. Run it
// in a real terminal: a drizzle-kit prompt would wait there, invisibly, instead of crashing.
//
// Exit 0 = passed, 1 = the check failed, 2 = could not run it (usage, git, the base's own load).
import { Database } from "bun:sqlite";
import {
  appendFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { ServerFrame, type SnapshotFrame, WS_PATH } from "@shared/protocol/frames";
import { defaultPlayDataDir, disposableRoots, isWithin, WORKTREE_ROOT } from "../src/server/config";
import { readLock } from "../src/server/runtime/lock";
import { manifestPath } from "../src/server/runtime/manifest";
import { type ServerProcess, spawnServer } from "./lib/server-process";

/** Fills the most tables of any registered bundle (39 of 49, measured 2026-10-31), in about 3 s. */
export const DEFAULT_BUNDLE = "session-sim-17";
const FALLBACK_BUNDLE = "base";
const SECRET = "upgrade-check-only-secret";
const START_TIMEOUT_MS = 90_000;
const FRAME_TIMEOUT_MS = 20_000;
/** `--prove-refusal`: still running after this = it waits on something. */
const REFUSAL_TIMEOUT_MS = 30_000;

/**
 * Tables a boot upgrade empties on purpose after copying their rows on (ADR-0076). Only these may
 * come back with fewer rows; a builder adding one names its copy here.
 */
const MOVED_AT_BOOT: Readonly<Record<string, string>> = {
  fog_explored: "ADR-0076: converted into fog_explored_shape at start",
};

export class CheckFailed extends Error {
  override name = "CheckFailed";
}
export class CannotRun extends Error {
  override name = "CannotRun";
}

// ---------- pure parts ----------

export interface Args {
  base?: string;
  bundle: string;
  dataDir?: string;
  proveRefusal: boolean;
}

export function parseArgs(argv: readonly string[]): Args {
  const args: Args = { bundle: DEFAULT_BUNDLE, proveRefusal: false };
  for (const a of argv) {
    const [flag, value] = a.split(/=(.*)/s);
    if (a === "--prove-refusal") args.proveRefusal = true;
    else if (flag === "--base" && value) args.base = value;
    else if (flag === "--bundle" && value) args.bundle = value;
    else if (flag === "--data-dir" && value) args.dataDir = value;
    else throw new CannotRun(`unknown argument ${a}`);
  }
  return args;
}

/**
 * The base when none is given: the merge base with `origin/main`; on `main`, or on a branch with
 * nothing of its own, the previous commit (comparing a tree with itself proves nothing).
 */
export function defaultBaseRef(branch: string, head: string, mergeBase: string | null): string {
  if (branch === "main" || mergeBase === head) return `${head}^1`;
  if (!mergeBase) throw new CannotRun("no merge base with origin/main; use --base=<ref>");
  return mergeBase;
}

/**
 * The real campaign is never a target: only under `<worktree>/data/` or the OS temp dir, and never
 * inside a play dir, whatever those happen to resolve to.
 */
export function checkDataDir(
  dir: string,
  env: Record<string, string | undefined> = process.env,
  root: string = WORKTREE_ROOT,
): void {
  const play = [
    defaultPlayDataDir(env, process.platform, os.homedir()),
    env.PP_PLAY_DATA_DIR?.trim(),
    env.PP_PLAY_BACKUP_DIR?.trim(),
  ].filter((p): p is string => Boolean(p));
  if (play.some((p) => isWithin(dir, path.resolve(root, p)))) {
    throw new CannotRun(`refusing ${dir}: that is a real campaign's data. Nothing was touched.`);
  }
  if (!disposableRoots(root).some((r) => isWithin(dir, r))) {
    throw new CannotRun(
      `refusing ${dir}: the check only runs under ${disposableRoots(root).join(" or ")}. Nothing was touched.`,
    );
  }
}

export type RowCounts = Record<string, number>;

/** One line per populated table that came back with fewer rows, or gone. */
export function lostRows(
  before: RowCounts,
  after: RowCounts,
  moved: Readonly<Record<string, string>> = MOVED_AT_BOOT,
): string[] {
  return Object.entries(before)
    .filter(([table, n]) => n > 0 && (after[table] ?? 0) < n && !(table in moved))
    .map(([table, n]) =>
      table in after
        ? `${table}: ${n} rows before, ${after[table]} after`
        : `${table}: ${n} rows before, the table is gone`,
    );
}

/** The player tokens in a load manifest's links (`…/p/<token>`). */
export function linkTokens(manifest: { playerLinks?: { url: string }[] }): string[] {
  return (manifest.playerLinks ?? [])
    .map((l) => /\/p\/([^/?#]+)/.exec(l.url)?.[1])
    .filter((t): t is string => Boolean(t));
}

/** A GitHub annotation line: `%`, CR and LF escaped so a message keeps its lines. */
export function annotation(title: string, message: string): string {
  const text = message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  return `::error title=${title}::${text}`;
}

/** The refusal in a failed boot's output: from `Cannot start:` to the end. */
export function refusalIn(lines: readonly string[]): string | null {
  const at = lines.findIndex((l) => l.includes("Cannot start:"));
  if (at === -1) return null;
  return lines
    .slice(at)
    .map((l, i) => (i === 0 ? l.slice(l.indexOf("Cannot start:")) : l))
    .join("\n")
    .trim();
}

/**
 * Removes a temp dir. The link to this checkout's node_modules goes first, on its own: a recursive
 * remove must never get to walk through it, so if it can't be unlinked the dir stays. Retries on
 * Windows' transient locks. Returns what's left: null, or a line to warn with.
 */
export function removeTemp(dir: string, attempts = 20): string | null {
  const link = path.join(dir, "tree", "node_modules");
  try {
    if (lstatSync(link).isSymbolicLink()) unlinkSync(link);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      return `${dir} left behind, its node_modules link wouldn't go: ${(err as Error).message}`;
    }
  }
  for (let i = 0; ; i++) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return null;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? "";
      if (i >= attempts || !["EBUSY", "EPERM", "ENOTEMPTY", "EACCES"].includes(code)) {
        return `${dir} left behind: ${(err as Error).message}`;
      }
      Bun.gc(true);
      Bun.sleepSync(250);
    }
  }
}

// ---------- git and the base's tree ----------

function git(args: string[], cwd = WORKTREE_ROOT): string | null {
  const r = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return r.exitCode === 0 ? r.stdout.toString().trim() : null;
}

function resolveBase(ref?: string): string {
  const wanted =
    ref ??
    defaultBaseRef(
      git(["rev-parse", "--abbrev-ref", "HEAD"]) ?? "",
      git(["rev-parse", "HEAD"]) ?? "",
      git(["merge-base", "HEAD", "origin/main"]),
    );
  const sha = git(["rev-parse", "--verify", `${wanted}^{commit}`]);
  if (!sha) throw new CannotRun(`no commit ${wanted} here; fetch more history or use --base=<ref>`);
  return sha;
}

const normalLines = (file: string) => readFileSync(file, "utf8").replace(/\r\n/g, "\n");

/** The base's tree in `tree`, with dependencies: this checkout's if the lockfile matches. */
async function checkOutBase(sha: string, tree: string): Promise<"linked" | "installed"> {
  mkdirSync(tree, { recursive: true });
  const tar = `${tree}.tar`;
  if (git(["archive", "--format=tar", "-o", tar, sha]) === null) {
    throw new CannotRun(`git archive ${sha} failed`);
  }
  // Relative paths, from the dir: GNU tar reads a `C:\…` argument as a remote host.
  const x = Bun.spawnSync(["tar", "-xf", path.relative(tree, tar)], { cwd: tree, stderr: "pipe" });
  if (x.exitCode !== 0) throw new CannotRun(`tar failed: ${x.stderr.toString().trim()}`);
  rmSync(tar, { force: true });
  const same =
    normalLines(path.join(tree, "bun.lock")) === normalLines(path.join(WORKTREE_ROOT, "bun.lock"));
  if (same) {
    symlinkSync(
      path.join(WORKTREE_ROOT, "node_modules"),
      path.join(tree, "node_modules"),
      "junction",
    );
    return "linked";
  }
  const install = Bun.spawn(["bun", "install", "--frozen-lockfile"], {
    cwd: tree,
    env: withoutPp(),
    stdout: "ignore",
    stderr: "pipe",
  });
  const err = await new Response(install.stderr).text();
  if ((await install.exited) !== 0) throw new CannotRun(`the base's bun install failed:\n${err}`);
  return "installed";
}

/** This environment with no `PP_*` left: a worktree's `.env` or a shell can't redirect the check. */
function withoutPp(): Record<string, string | undefined> {
  return Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("PP_")));
}

const dataEnv = (dataDir: string, disposable: boolean): Record<string, string | undefined> => ({
  ...withoutPp(),
  PP_SLOT: "0",
  PP_PROFILE: "verify",
  PP_HOST: "127.0.0.1",
  PP_PORT: "0",
  PP_DATA_DIR: dataDir,
  PP_DB_PATH: "",
  PP_ASSET_DIR: "",
  PP_DATA_DISPOSABLE: disposable ? "1" : "0",
  PP_TEST_MODE: "0",
  PP_TEST_CRASH: "",
  PP_DM_SECRET: SECRET,
  PP_PUBLIC_BASE_URL: "",
  PP_5ETOOLS_DIR: "",
  PP_LOG_LEVEL: "info",
  PP_FIXTURE_CACHE: "0",
  FORCE_COLOR: "0",
});

/** The base's own code loads `bundle`; false = the base doesn't have that bundle. */
async function loadWithBase(tree: string, dataDir: string, bundle: string): Promise<boolean> {
  const p = Bun.spawn(["bun", "scripts/fixtures.ts", "reset-load", bundle], {
    cwd: tree,
    env: dataEnv(dataDir, true),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  if ((await p.exited) === 0) return true;
  if (err.includes(`Unknown bundle "${bundle}"`)) return false;
  throw new CannotRun(`the base's code could not load ${bundle}:\n${out}${err}`);
}

// ---------- the upgraded data ----------

function rowCounts(dbPath: string): RowCounts {
  const db = new Database(dbPath, { readonly: true });
  try {
    const names = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((r) => r.name);
    return Object.fromEntries(
      names.map((t) => [
        t,
        db.query<{ n: number }, []>(`SELECT count(*) AS n FROM "${t}"`).get()?.n ?? 0,
      ]),
    );
  } finally {
    db.close();
    // Closed DBs stay locked on Windows until their statements are finalized.
    Bun.gc(true);
  }
}

/** Boots this tree's server on `dataDir`; its output lines land in `lines`. */
async function bootServer(dataDir: string, lines: string[]) {
  const server = spawnServer([], {
    env: dataEnv(dataDir, false),
    onLine: (l) => lines.push(l),
  });
  const deadline = Date.now() + START_TIMEOUT_MS;
  for (;;) {
    if (server.proc.exitCode !== null || server.proc.signalCode !== null) {
      // The last lines may still be on their way through the pipes.
      await Bun.sleep(200);
      const refusal = refusalIn(lines);
      throw new CheckFailed(
        refusal ??
          `The server exited with code ${server.proc.exitCode} at start:\n${lines.slice(-30).join("\n")}`,
      );
    }
    const port = readLock(dataDir)?.port;
    if (port) return { server, port };
    if (Date.now() > deadline) {
      await server.stop();
      throw new CheckFailed(
        `The server did not start within ${START_TIMEOUT_MS / 1000} s:\n${lines.slice(-30).join("\n")}`,
      );
    }
    await Bun.sleep(50);
  }
}

/** Hello → the snapshot frame, over the real WS path; a number = closed without one, that code. */
function readSnapshot(port: number, credential: unknown): Promise<SnapshotFrame | number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${WS_PATH}`);
    const timer = setTimeout(() => {
      ws.close();
      reject(new CheckFailed(`No snapshot within ${FRAME_TIMEOUT_MS / 1000} s.`));
    }, FRAME_TIMEOUT_MS);
    const done = (f: SnapshotFrame | number) => {
      clearTimeout(timer);
      // First: Bun can fire `close` inside `ws.close()`, and that would settle it as closed.
      resolve(f);
      ws.close();
    };
    ws.addEventListener("open", () => ws.send(JSON.stringify({ type: "hello", credential })));
    ws.addEventListener("close", (e) => done(e.code));
    ws.addEventListener("message", (e) => {
      const f = ServerFrame.safeParse(JSON.parse(String(e.data)));
      if (!f.success) {
        clearTimeout(timer);
        ws.close();
        reject(new CheckFailed(`A frame that doesn't parse: ${f.error.message}`));
      } else if (f.data.type === "snapshot") done(f.data);
    });
  });
}

interface RecordDefs {
  get(type: string):
    | {
        schema: { safeParse(v: unknown): { success: boolean; error?: unknown } };
        redact?: unknown;
        dmRedact?: unknown;
      }
    | undefined;
}

/** This tree's record registry, for the schema of each row. No data: an in-memory DB. */
async function recordDefs(): Promise<RecordDefs> {
  const [{ parseConfig }, { openMemoryDb }, { silentLogger }, { createServices }] =
    await Promise.all([
      import("../src/server/config"),
      import("../src/server/db/client"),
      import("../src/server/log"),
      import("../src/server/services"),
    ]);
  const dir = path.join(os.tmpdir(), "pp-upgrade-check-unused");
  const config = parseConfig(dataEnv(dir, true), { requireSlot: true });
  return createServices({ config, db: openMemoryDb(), log: silentLogger }).records;
}

/** Problems with a snapshot's rows. A reshaped row (`redact`, `dmRedact`) has no schema to meet. */
export function invalidRows(
  frame: Pick<SnapshotFrame, "records">,
  defs: RecordDefs,
  who: string,
): string[] {
  const out: string[] = [];
  for (const [type, rows] of Object.entries(frame.records)) {
    const def = defs.get(type);
    if (!def) {
      out.push(`${who}: unknown record type ${type}`);
      continue;
    }
    if (def.redact || def.dmRedact) continue;
    const bad = rows.filter((r) => !def.schema.safeParse(r).success);
    if (bad.length > 0) {
      const issue = def.schema.safeParse(bad[0]).error;
      out.push(
        `${who}: ${bad.length} of ${rows.length} ${type} row(s) don't match the schema: ${String(issue).slice(0, 300)}`,
      );
    }
  }
  return out;
}

const countRows = (f: SnapshotFrame) =>
  Object.values(f.records).reduce((n, rows) => n + rows.length, 0);

interface Outcome {
  base: string;
  bundle: string;
  bundleNote: string;
  deps: string;
  tablesWithRows: number;
  tables: number;
  applied: string;
  dmRows: number;
  playerRows: number;
}

async function runCheck(args: Args, dataDir: string, tree: string): Promise<Outcome> {
  const base = resolveBase(args.base);
  checkDataDir(dataDir);
  const deps = await checkOutBase(base, tree);

  let bundle = args.bundle;
  let bundleNote = "";
  if (!(await loadWithBase(tree, dataDir, bundle))) {
    bundleNote = `the base has no bundle ${bundle}: used ${FALLBACK_BUNDLE}`;
    bundle = FALLBACK_BUNDLE;
    if (!(await loadWithBase(tree, dataDir, bundle))) {
      throw new CannotRun(`the base has neither ${args.bundle} nor ${FALLBACK_BUNDLE}`);
    }
  }
  const dbPath = path.join(dataDir, "pocket-plane.db");
  const before = rowCounts(dbPath);
  const manifest = JSON.parse(readFileSync(manifestPath(dataDir), "utf8")) as {
    playerLinks?: { url: string }[];
  };

  const lines: string[] = [];
  let running: ServerProcess | null = null;
  let dm: SnapshotFrame | number;
  let player: SnapshotFrame | number = 0;
  try {
    const { server, port } = await bootServer(dataDir, lines);
    running = server;
    dm = await readSnapshot(port, { role: "dm", secret: SECRET });
    for (const token of linkTokens(manifest)) {
      player = await readSnapshot(port, { role: "player", token });
      if (typeof player !== "number") break;
    }
  } finally {
    await running?.stop();
  }
  const log = () => lines.slice(-20).join("\n");
  if (typeof dm === "number") {
    throw new CheckFailed(`The DM got no snapshot: the socket closed, code ${dm}.\n${log()}`);
  }
  if (dm.you.role !== "dm") throw new CheckFailed(`The DM's snapshot says ${dm.you.role}.`);
  if (typeof player === "number") {
    throw new CheckFailed(`No player link got a snapshot (last close code ${player}).\n${log()}`);
  }
  if (player.you.role !== "player" || !player.you.playerId) {
    throw new CheckFailed("The player's snapshot doesn't name a player.");
  }

  const defs = await recordDefs();
  const invalid = [...invalidRows(dm, defs, "DM"), ...invalidRows(player, defs, "player")];
  if (invalid.length > 0) {
    throw new CheckFailed(
      `Upgraded data doesn't match this tree's record schemas:\n${invalid.join("\n")}\nCopy or convert the old rows at boot (ADR-0076).`,
    );
  }
  const lost = lostRows(before, rowCounts(dbPath));
  if (lost.length > 0) {
    throw new CheckFailed(
      `The upgrade lost rows:\n${lost.join("\n")}\nKeep the old column or table, add the new one and copy at boot (ADR-0076).`,
    );
  }
  return {
    base,
    bundle,
    bundleNote,
    deps,
    tablesWithRows: Object.values(before).filter((n) => n > 0).length,
    tables: Object.keys(before).length,
    applied:
      lines.find((l) => l.includes("schema: applied"))?.replace(/^.*schema: /, "") ??
      "no schema change",
    dmRows: countRows(dm),
    playerRows: countRows(player),
  };
}

// ---------- --prove-refusal ----------

const BAD_DB: readonly { name: string; bad: string; check: string }[] = [
  {
    name: "a column renamed in place",
    bad: "ALTER TABLE token RENAME COLUMN name TO name_old",
    check: "SELECT count(*) AS n FROM pragma_table_info('token') WHERE name = 'name_old'",
  },
  {
    name: "a table swapped for another",
    bad: "ALTER TABLE sync_probe RENAME TO sync_probe_old",
    check: "SELECT count(*) AS n FROM sqlite_master WHERE name = 'sync_probe_old'",
  },
];

async function proveRefusal(dir: string): Promise<boolean> {
  const { createSchema } = await import("../src/server/db/push");
  const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);
  console.log(
    `this process: stdin TTY ${Boolean(process.stdin.isTTY)}, stdout TTY ${Boolean(process.stdout.isTTY)}`,
  );
  if (!tty) console.log("no terminal here: this run only proves the no-terminal case.");
  let ok = true;
  for (const [i, c] of BAD_DB.entries()) {
    const dataDir = path.join(dir, `bad-${i}`);
    checkDataDir(dataDir);
    mkdirSync(dataDir, { recursive: true });
    const dbPath = path.join(dataDir, "pocket-plane.db");
    const seed = new Database(dbPath, { create: true, strict: true });
    await createSchema(seed);
    seed.run(c.bad);
    seed.close();
    Bun.gc(true);

    console.log(`\n--- ${c.name}: booting the server on this terminal ---`);
    const t0 = performance.now();
    // Inherited: the server sees this terminal, exactly as if typed here.
    const p = Bun.spawn(["bun", "src/server/index.ts"], {
      cwd: WORKTREE_ROOT,
      env: dataEnv(dataDir, false),
      stdio: ["inherit", "inherit", "inherit"],
    });
    const exit = await Promise.race([
      p.exited,
      Bun.sleep(REFUSAL_TIMEOUT_MS).then(() => "waiting" as const),
    ]);
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    if (exit === "waiting") p.kill();
    await p.exited;
    Bun.gc(true);
    const after = new Database(dbPath, { readonly: true });
    const kept = after.query<{ n: number }, []>(c.check).get()?.n === 1;
    after.close();
    Bun.gc(true);
    const backups = readdirSync(dataDir).filter((f) => f.includes(".pre-push-"));
    const passed = exit === 1 && kept && backups.length === 0;
    ok &&= passed;
    console.log(
      `--- ${passed ? "PASS" : "FAIL"}: ${
        exit === "waiting" ? `still running after ${secs} s, killed` : `exit ${exit} in ${secs} s`
      }, DB ${kept ? "untouched" : "CHANGED"}, ${backups.length} backup(s) ---`,
    );
  }
  return ok;
}

// ---------- main ----------

function report(title: string, message: string) {
  console.error(message);
  if (!process.env.GITHUB_ACTIONS) return;
  console.log(annotation(title, message));
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `### ${title}\n\n\`\`\`\n${message}\n\`\`\`\n`);
}

async function main(): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
    if (args.dataDir) checkDataDir(path.resolve(WORKTREE_ROOT, args.dataDir));
  } catch (err) {
    report("upgrade check could not run", (err as Error).message);
    return 2;
  }
  const temp = mkdtempSync(path.join(os.tmpdir(), "pp-upgrade-"));
  const cleanUp = () => {
    const left = removeTemp(temp);
    if (left) console.warn(`warning: ${left}`);
  };
  for (const s of ["SIGINT", "SIGTERM", "SIGBREAK"] as const) {
    process.on(s, () => {
      cleanUp();
      process.exit(130);
    });
  }
  const t0 = performance.now();
  try {
    if (args.proveRefusal) {
      const ok = await proveRefusal(temp);
      console.log(`\nprove-refusal: ${ok ? "PASS" : "FAIL"}`);
      return ok ? 0 : 1;
    }
    const dataDir = args.dataDir
      ? path.resolve(WORKTREE_ROOT, args.dataDir)
      : path.join(temp, "data");
    const r = await runCheck(args, dataDir, path.join(temp, "tree"));
    const secs = Math.round((performance.now() - t0) / 1000);
    if (r.bundleNote) console.log(`upgrade:check: ${r.bundleNote}`);
    console.log(
      `upgrade:check ok in ${secs} s: base ${r.base.slice(0, 8)} (dependencies ${r.deps}), bundle ${r.bundle}, ${r.tablesWithRows} of ${r.tables} tables with rows, ${r.applied}, no rows lost; DM snapshot ${r.dmRows} rows, player ${r.playerRows}, all valid.`,
    );
    return 0;
  } catch (err) {
    if (err instanceof CheckFailed) {
      report("upgrade check failed", err.message);
      return 1;
    }
    report("upgrade check could not run", err instanceof CannotRun ? err.message : String(err));
    return 2;
  } finally {
    cleanUp();
  }
}

if (import.meta.main) process.exit(await main());
