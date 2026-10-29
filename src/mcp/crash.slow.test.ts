// AGENT §13 slow: a real server process killed mid-write by `PP_TEST_CRASH` (#163). The MCP
// call reports `server_stopped`; after a restart the row is absent (before-commit) or there
// (after-commit). Explicit env (CI has no .env; the cwd is a temp dir so none is loaded).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadBundle } from "@fixtures/index";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { isPidAlive, readLock } from "@server/runtime/lock";
import { TEST_SECRET } from "@server/testing/services";
import { Caller } from "./client";
import { createMcpServer } from "./server";

const ROOT = path.resolve(import.meta.dir, "..", "..");
const quietLog = { info() {}, warn() {}, error() {} };
let dataDir: string;
let cwd: string;
let cleanup: () => void;
let client: Client;

/** The parent's env minus every PP_* (a developer's .env values never leak in), plus `extra`. */
function env(extra: Record<string, string>): Record<string, string> {
  const base = Object.entries(process.env).filter(
    (e): e is [string, string] => e[1] !== undefined && !e[0].startsWith("PP_"),
  );
  return { ...Object.fromEntries(base), ...extra };
}

/** `bun src/server/index.ts` on the bundle's data dir; resolves once its lock has a port. */
async function startServer(crash?: string) {
  const p = Bun.spawn(
    [process.execPath, path.join(ROOT, "src/server/index.ts"), "--stop-on-stdin-close"],
    {
      cwd,
      env: env({
        PP_SLOT: "0",
        PP_PORT: "0",
        PP_PROFILE: "verify",
        PP_DATA_DIR: dataDir,
        PP_DM_SECRET: TEST_SECRET,
        PP_DATA_DISPOSABLE: "1",
        PP_TEST_MODE: "1",
        PP_LOG_LEVEL: "warn",
        ...(crash ? { PP_TEST_CRASH: crash } : {}),
      }),
      stdin: "pipe",
      stdout: "ignore",
      stderr: "pipe",
    },
  );
  const deadline = Date.now() + 30_000;
  for (;;) {
    const lock = readLock(dataDir);
    if (lock?.pid === p.pid && lock.port !== null) break;
    if (p.exitCode !== null || Date.now() > deadline) {
      throw new Error(`server did not start: ${await new Response(p.stderr).text()}`);
    }
    await Bun.sleep(50);
  }
  return {
    p,
    async stop() {
      p.stdin.end();
      await p.exited;
    },
  };
}

async function call(name: string, args: Record<string, unknown>) {
  const r = await client.callTool({ name, arguments: args });
  return JSON.parse((r.content as { text: string }[])[0]?.text ?? "null");
}

const create = (name: string) =>
  call("creature_create", {
    name,
    statBlock: { size: "medium", ac: 13, hpMax: 15, initBonus: 1, attacks: [], cr: "1/2" },
  });
const names = async (q: string) =>
  (await call("creatures_list", { q })).creatures.map((c: { name: string }) => c.name);

beforeAll(async () => {
  const loaded = await loadBundle("base", { dmSecret: TEST_SECRET, testMode: true });
  dataDir = loaded.dir;
  cleanup = loaded.cleanup;
  cwd = mkdtempSync(path.join(os.tmpdir(), "pp-mcp-crash-cwd-"));
  const caller = new Caller({ dataDir, profile: "verify", dmSecret: TEST_SECRET, log: quietLog });
  client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    createMcpServer({ caller, log: quietLog, dmSecret: TEST_SECRET }).connect(a),
    client.connect(b),
  ]);
});

afterAll(async () => {
  await client.close();
  for (const done of [cleanup, () => rmSync(cwd, { recursive: true, force: true })]) {
    try {
      done();
    } catch {
      // Windows may hold the WAL briefly; a leftover temp dir is harmless.
    }
  }
});

describe("server killed mid-write", () => {
  for (const [point, kept] of [
    ["before-commit", false],
    ["after-commit", true],
  ] as const) {
    test(`FR-AGENT-06 PP_TEST_CRASH=entities.create:${point} → server_stopped; after restart ${kept ? "the row" : "no row"}`, async () => {
      const name = `Crash Orc ${point}`;
      const crashing = await startServer(`entities.create:${point}`);
      const r = await create(name);
      expect(r).toMatchObject({
        code: "server_stopped",
        message: expect.stringContaining("may or may not be saved"),
      });
      await crashing.p.exited;
      // The lock stays behind with a dead PID: refused as not running, the file untouched.
      expect(isPidAlive(crashing.p.pid)).toBe(false);
      expect(readLock(dataDir)?.pid).toBe(crashing.p.pid);
      expect((await create(name)).code).toBe("server_not_running");

      const server = await startServer();
      try {
        expect(await names(name)).toEqual(kept ? [name] : []);
      } finally {
        await server.stop();
      }
    }, 90_000);
  }
});
