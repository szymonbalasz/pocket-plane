// `bun run play [--no-build] [--no-backup]` (#382): the real server on a play data dir outside
// the checkout (PP_PLAY_DATA_DIR or the OS per-user default), not disposable, no test mode,
// its own port (PP_PLAY_PORT, default 4090). Backs up the DB and assets before each start.
import { mkdirSync } from "node:fs";
import path from "node:path";
import {
  ConfigError,
  localUrl,
  parseConfig,
  resolvePlayDirs,
  WORKTREE_ROOT,
} from "../src/server/config";
import { liveLock } from "../src/server/runtime/lock";
import { checkPlayEnv, playServerEnv } from "./lib/play";
import { BackupError, backupPlayData } from "./lib/play-backup";
import { spawnServer } from "./lib/server-process";

const USAGE = "usage: bun run play [--no-build] [--no-backup]";
const argv = process.argv.slice(2);
const unknown = argv.filter((a) => a !== "--no-build" && a !== "--no-backup");
if (unknown.length > 0) {
  console.error(`play: unknown argument ${unknown.join(" ")}\n${USAGE}`);
  process.exit(2);
}

function fail(msg: string): never {
  console.error(`play: ${msg}`);
  process.exit(1);
}

let env: Record<string, string | undefined>;
let config: ReturnType<typeof parseConfig>;
let dirs: ReturnType<typeof resolvePlayDirs>;
try {
  checkPlayEnv(process.env);
  dirs = resolvePlayDirs(process.env);
  env = playServerEnv(process.env, dirs);
  // Same checks the server makes (secret, values), before anything is touched.
  config = parseConfig(env, { requireSlot: true, requireSecret: true });
} catch (err) {
  fail(err instanceof ConfigError ? err.message : String(err));
}

const held = liveLock(dirs.dataDir, (m) => console.error(`play: ${m}`));
if (held) {
  fail(
    `a ${held.owner} (pid ${held.pid}) already runs on ${dirs.dataDir}${held.port ? ` at ${localUrl(config.host, held.port)}` : ""}.`,
  );
}
mkdirSync(dirs.dataDir, { recursive: true });

if (argv.includes("--no-backup")) {
  console.warn("play: --no-backup: skipping the start-up backup.");
} else {
  try {
    const r = backupPlayData({
      dbPath: config.dbPath,
      assetDir: config.assetDir,
      backupDir: dirs.backupDir,
    });
    const assets = `assets: ${r.assets.copied} copied, ${r.assets.unchanged} unchanged`;
    console.log(
      r.db ? `play: backup ${path.basename(r.db)} (${assets})` : `play: no DB yet (${assets})`,
    );
  } catch (err) {
    fail(
      `backup to ${dirs.backupDir} failed: ${err instanceof BackupError ? err.message : String(err)}. The server was not started. Fix it, or start with --no-backup.`,
    );
  }
}

if (!argv.includes("--no-build")) {
  const build = Bun.spawn([process.execPath, "run", "build"], {
    cwd: WORKTREE_ROOT,
    stdio: ["inherit", "inherit", "inherit"],
  });
  if ((await build.exited) !== 0) fail("the client build failed; the server was not started.");
}

console.log(`play: DM URL      ${localUrl(config.host, config.port)}/`);
console.log(`play: data dir    ${dirs.dataDir}`);
console.log(`play: backup dir  ${dirs.backupDir}`);

// Same path as `bun run start` (scripts/start.ts).
const server = spawnServer(["--client"], { env });
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  void server.stop().then((code) => process.exit(code));
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("SIGBREAK", stop);

process.exit(await server.proc.exited);
