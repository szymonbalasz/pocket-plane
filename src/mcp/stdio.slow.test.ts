// AGENT §13 slow: the real stdio process and `mcp:call`, with explicit env (CI has no .env; the
// cwd is a temp dir so no .env is loaded) against an in-process server and a written lock.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { startTestServer, type TestServer } from "@server/testing/harness";
import { seedSyncProbe } from "@server/testing/seed";
import { TEST_SECRET } from "@server/testing/services";
import { allTools } from "./server";

const ROOT = path.resolve(import.meta.dir, "..", "..");
let h: TestServer;
let dataDir: string;
let cwd: string;

/** The parent's env minus every PP_* (a developer's .env values never leak in), plus `extra`. */
function env(extra: Record<string, string>): Record<string, string> {
  const base = Object.entries(process.env).filter(
    (e): e is [string, string] => e[1] !== undefined && !e[0].startsWith("PP_"),
  );
  return { ...Object.fromEntries(base), ...extra };
}
const mcpEnv = () => env({ PP_DATA_DIR: dataDir, PP_DM_SECRET: TEST_SECRET, PP_PROFILE: "verify" });

beforeAll(async () => {
  h = await startTestServer({ fake: false });
  seedSyncProbe(h.s);
  dataDir = mkdtempSync(path.join(os.tmpdir(), "pp-mcp-stdio-"));
  cwd = mkdtempSync(path.join(os.tmpdir(), "pp-mcp-cwd-"));
  writeFileSync(
    path.join(dataDir, "server.lock"),
    JSON.stringify({
      owner: "server",
      pid: process.pid,
      port: Number(new URL(h.http).port),
      startedAt: "2026-03-01T00:00:00Z",
    }),
  );
});

afterAll(async () => {
  await h.stop();
  for (const d of [dataDir, cwd]) rmSync(d, { recursive: true, force: true });
});

async function run(cmd: string[], e: Record<string, string>, stdin?: string) {
  const p = Bun.spawn(cmd, { cwd, env: e, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  if (stdin !== undefined) p.stdin.write(stdin);
  p.stdin.end();
  const [out, err, code] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
    p.exited,
  ]);
  return { out, err, code };
}

describe("stdio process", () => {
  test("FR-AGENT-01 FR-AGENT-02 FR-AGENT-03 stdout carries only JSON-RPC; logs and no secret on stderr", async () => {
    const p = Bun.spawn([process.execPath, path.join(ROOT, "src/mcp/index.ts")], {
      cwd,
      env: mcpEnv(),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    const send = (m: object) => p.stdin.write(`${JSON.stringify(m)}\n`);
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "slow-test", version: "0" },
      },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "campaigns_list" } });
    send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "players_list" } });
    send({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "nope" } });

    // Read until all five answers are in, then close stdin: the process exits.
    const reader = p.stdout.getReader();
    let out = "";
    const deadline = Date.now() + 20_000;
    while ((out.match(/"id":\s*\d/g) ?? []).length < 5 && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      out += new TextDecoder().decode(value);
    }
    p.stdin.end();
    let rest = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      rest += new TextDecoder().decode(value);
    }
    const err = await new Response(p.stderr).text();
    expect(await p.exited).toBe(0);
    const lines = (out + rest).split("\n").filter((l) => l.trim() !== "");
    type Msg = { jsonrpc: string; id: number; result: Record<string, unknown> };
    const msgs = lines.map((l) => JSON.parse(l) as Msg);
    expect(msgs.every((m) => m.jsonrpc === "2.0")).toBe(true);
    expect(msgs.map((m) => m.id).sort()).toEqual([1, 2, 3, 4, 5]);
    const result = (id: number) => msgs.find((m) => m.id === id)?.result ?? {};
    const body = (id: number) =>
      JSON.parse((result(id).content as { text: string }[])[0]?.text ?? "null");
    // The exact list is core.test.ts's; here the process serves the whole registry.
    expect(result(2).tools).toHaveLength(allTools().length);
    expect(body(3).campaigns.map((c: { name: string }) => c.name)).toContain("Fixture Campaign");
    expect(body(4).players).toHaveLength(2);
    expect(result(5).isError).toBe(true);
    expect(err).toContain("[mcp] ready (profile verify");
    expect(out + rest + err).not.toContain(TEST_SECRET);
  }, 60_000);

  test("FR-AGENT-01 a config error goes to stderr, exit ≠ 0, nothing on stdout", async () => {
    const r = await run(
      [process.execPath, path.join(ROOT, "src/mcp/index.ts")],
      env({ PP_DATA_DIR: dataDir }),
    );
    expect(r.code).not.toBe(0);
    expect(r.out).toBe("");
    expect(r.err).toContain("PP_DM_SECRET is not set");
  }, 60_000);
});

describe("mcp:call", () => {
  const mcpCall = (tool: string, json: string, e = mcpEnv()) =>
    run([process.execPath, path.join(ROOT, "scripts/mcp-call.ts"), tool, json], e);

  test("FR-AGENT-03 prints the result over real stdio, exit 0; no secret in its output", async () => {
    const r = await mcpCall("characters_list", '{"q":""}');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ campaign: { name: "Fixture Campaign" } });
    expect(r.out + r.err).not.toContain(TEST_SECRET);
  }, 60_000);

  test("FR-AGENT-05 not running → exit ≠ 0 with the next step", async () => {
    const r = await mcpCall(
      "creatures_list",
      "{}",
      env({ PP_DATA_DIR: cwd, PP_DM_SECRET: TEST_SECRET, PP_PROFILE: "verify" }),
    );
    expect(r.code).toBe(1);
    expect(JSON.parse(r.err.slice(r.err.indexOf("{")))).toMatchObject({
      code: "server_not_running",
      message: expect.stringContaining("Start the server"),
    });
    expect(r.out + r.err).not.toContain(TEST_SECRET);
  }, 60_000);

  test("mcp:call usage errors exit 2", async () => {
    expect((await mcpCall("campaigns_list", "[1]")).code).toBe(2);
  }, 60_000);
});
