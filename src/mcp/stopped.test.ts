// AGENT §13 integration: the real server stops mid-call, then refuses (lock left behind).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { startTestServer, type TestServer } from "@server/testing/harness";
import { seedSyncProbe } from "@server/testing/seed";
import { TEST_SECRET } from "@server/testing/services";
import { Caller } from "./client";
import { createMcpServer } from "./server";

let h: TestServer;
let lockDir: string;
let client: Client;
const quietLog = { info() {}, warn() {}, error() {} };

async function call(name: string) {
  const r = await client.callTool({ name, arguments: {} });
  return JSON.parse((r.content as { text: string }[])[0]?.text ?? "null");
}

beforeAll(async () => {
  h = await startTestServer();
  seedSyncProbe(h.s);
  lockDir = mkdtempSync(path.join(os.tmpdir(), "pp-mcp-stop-"));
  writeFileSync(
    path.join(lockDir, "server.lock"),
    JSON.stringify({
      owner: "server",
      pid: process.pid,
      port: Number(new URL(h.http).port),
      startedAt: "2026-03-01T00:00:00Z",
    }),
  );
  const caller = new Caller({
    dataDir: lockDir,
    profile: "verify",
    dmSecret: TEST_SECRET,
    log: quietLog,
  });
  client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    createMcpServer({ caller, log: quietLog, dmSecret: TEST_SECRET }).connect(a),
    client.connect(b),
  ]);
});

afterAll(async () => {
  await client.close();
  rmSync(lockDir, { recursive: true, force: true });
});

describe("server stops", () => {
  test("FR-AGENT-09 a running server answers (one WS: hello, snapshot, close)", async () => {
    expect((await call("players_list")).players).toHaveLength(2);
  });

  test("FR-AGENT-06 stopped between hello and the snapshot → server_stopped, safe to retry", async () => {
    const gate = h.pauseSnapshot();
    const pending = call("players_list");
    await gate.reached;
    await h.stop();
    const r = await pending;
    gate.release();
    expect(r.code).toBe("server_stopped");
    expect(r.message).toContain("Safe to retry");
  });

  test("FR-AGENT-05 FR-AGENT-07 stopped: refused → server_not_running; the lock file stays", async () => {
    for (const tool of ["players_list", "campaigns_list", "compendium_search"]) {
      const r = await call(tool);
      expect(r.code).toBe("server_not_running");
      expect(r.message).toContain("Start the server");
    }
    expect(existsSync(path.join(lockDir, "server.lock"))).toBe(true);
  });

  test("FR-AGENT-05 no lock at all → server_not_running", async () => {
    rmSync(path.join(lockDir, "server.lock"));
    expect((await call("characters_list")).code).toBe("server_not_running");
  });
});
