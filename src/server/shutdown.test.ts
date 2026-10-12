// AGENTS §9.2: the server writes server.lock on start and removes it on clean exit.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnServer } from "../../scripts/lib/server-process";
import { parseConfig, WORKTREE_ROOT } from "./config";
import { silentLogger } from "./log";
import { isPidAlive, lockPath, readLock } from "./runtime/lock";
import { startServer } from "./server";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function tempDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "pp-shutdown-test-"));
  dirs.push(dir);
  return dir;
}

const env = (dir: string) => ({
  ...process.env,
  PP_SLOT: "",
  PP_TEST_MODE: "",
  PP_PORT: "0",
  PP_DATA_DIR: dir,
  PP_DATA_DISPOSABLE: "1",
  PP_DM_SECRET: "shutdown-test-secret",
});

async function waitFor(fn: () => boolean, ms = 8_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await Bun.sleep(50);
  }
  return fn();
}

describe("server.lock lifecycle", () => {
  test("stopSync removes the lock without awaiting anything", async () => {
    const dir = tempDir();
    const running = await startServer({ config: parseConfig(env(dir)), log: silentLogger });
    expect(readLock(dir)).toMatchObject({ owner: "server", pid: process.pid, port: running.port });
    running.stopSync();
    expect(existsSync(lockPath(dir))).toBe(false);
  });

  test("supervised server: stop() closes stdin → exit 0, lock removed", async () => {
    const dir = tempDir();
    const sp = spawnServer([], { env: env(dir), onLine() {} });
    expect(await waitFor(() => Boolean(readLock(dir)?.port))).toBe(true);
    expect(await sp.stop()).toBe(0);
    expect(existsSync(lockPath(dir))).toBe(false);
  }, 15_000);

  test("Ctrl+C under `bun run` (supervisor killed outright) still removes the lock", async () => {
    // Windows: Ctrl+C makes `bun run` exit and kill its children at once. Simulate by
    // hard-killing `scripts/start.ts`; the detached server must notice and stop cleanly.
    const dir = tempDir();
    const supervisor = Bun.spawn(["bun", "scripts/start.ts"], {
      cwd: WORKTREE_ROOT,
      env: env(dir),
      stdout: "ignore",
      stderr: "ignore",
    });
    expect(await waitFor(() => Boolean(readLock(dir)?.port))).toBe(true);
    const serverPid = readLock(dir)?.pid as number;
    expect(serverPid).not.toBe(supervisor.pid);
    supervisor.kill("SIGKILL");
    await supervisor.exited;
    expect(await waitFor(() => !existsSync(lockPath(dir)))).toBe(true);
    expect(await waitFor(() => !isPidAlive(serverPid))).toBe(true);
  }, 20_000);
});
