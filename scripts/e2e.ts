// `bun run e2e`: build, load `sync-probe` into a fresh temp dir, start the server on port 0,
// run Playwright against it, tear everything down (AGENTS §9.2 "(e2e)").
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Subprocess } from "bun";
import { library } from "../fixtures";
import { parseConfig, WORKTREE_ROOT } from "../src/server/config";
import { resetAndLoad } from "../src/server/features/fixtures-adapters/loader";
import { readLock } from "../src/server/runtime/lock";
import { manifestPath } from "../src/server/runtime/manifest";

const BUNDLE = "sync-probe";

async function run(cmd: string[], env: Record<string, string | undefined> = process.env) {
  const p = Bun.spawn(cmd, { cwd: WORKTREE_ROOT, env, stdout: "inherit", stderr: "inherit" });
  return p.exited;
}

if ((await run(["bun", "x", "vite", "build"])) !== 0) process.exit(1);

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

let server: Subprocess | null = null;
let code = 1;
try {
  const config = parseConfig(env);
  await resetAndLoad(config, library, BUNDLE);
  server = Bun.spawn(["bun", "src/server/index.ts", "--client"], {
    cwd: WORKTREE_ROOT,
    env,
    stdout: "inherit",
    stderr: "inherit",
    ipc() {},
    serialization: "json",
  });
  let port: number | null = null;
  for (let i = 0; i < 100 && port === null; i++) {
    await Bun.sleep(100);
    const lock = readLock(dir);
    if (lock?.owner === "server" && lock.port) port = lock.port;
  }
  if (port === null) throw new Error("Server did not start (no port in server.lock)");
  code = await run(["bun", "x", "playwright", "test", ...process.argv.slice(2)], {
    ...process.env,
    E2E_BASE_URL: `http://127.0.0.1:${port}`,
    E2E_DM_SECRET: secret,
    E2E_MANIFEST: manifestPath(dir),
  });
} catch (err) {
  console.error(err);
} finally {
  if (server) {
    // Clean stop over IPC (removes server.lock); hard kill only if it hangs.
    try {
      server.send({ type: "shutdown" });
    } catch {}
    const t = setTimeout(() => server?.kill(), 3000);
    await server.exited;
    clearTimeout(t);
  }
  rmSync(dir, { recursive: true, force: true });
}
process.exit(code);
