// AGENTS §9.2: the server writes server.lock on start and removes it on clean exit.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseConfig, WORKTREE_ROOT } from "./config";
import { silentLogger } from "./log";
import { lockPath, readLock } from "./runtime/lock";
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
  PP_PORT: "0",
  PP_DATA_DIR: dir,
  PP_DATA_DISPOSABLE: "1",
  PP_DM_SECRET: "shutdown-test-secret",
});

describe("server.lock lifecycle", () => {
  test("stopSync removes the lock without awaiting anything", async () => {
    const dir = tempDir();
    const running = await startServer({ config: parseConfig(env(dir)), log: silentLogger });
    expect(readLock(dir)).toMatchObject({ owner: "server", pid: process.pid, port: running.port });
    running.stopSync();
    expect(existsSync(lockPath(dir))).toBe(false);
  });

  test("a server process asked to stop exits 0 and removes its lock", async () => {
    const dir = tempDir();
    const proc = Bun.spawn(["bun", "src/server/index.ts"], {
      cwd: WORKTREE_ROOT,
      env: { ...process.env, ...env(dir), PP_SLOT: "", PP_TEST_MODE: "" },
      stdout: "ignore",
      stderr: "ignore",
      ipc() {},
      serialization: "json",
    });
    let port: number | null = null;
    for (let i = 0; i < 100 && port === null; i++) {
      await Bun.sleep(50);
      port = readLock(dir)?.port ?? null;
    }
    expect(port).toBeGreaterThan(0);
    proc.send({ type: "shutdown" });
    expect(await proc.exited).toBe(0);
    expect(existsSync(lockPath(dir))).toBe(false);
  }, 15_000);
});
