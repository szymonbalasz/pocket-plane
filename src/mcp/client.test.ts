// AGENT §11 transport and auth paths against a scripted fake server (real sockets, real lock file).
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ServerWebSocket } from "bun";
import { z } from "zod";
import { ALLOWED_INTENTS, ALLOWED_ROUTES, Caller } from "./client";
import { AgentError } from "./errors";

const SECRET = "fake-dm-secret-0123";
const quietLog = { info() {}, warn() {}, error() {} };
const cleanups: (() => void)[] = [];
afterAll(() => {
  for (const c of cleanups) c();
});

interface Script {
  /** Called with each client frame; `hello` first. */
  ws?: (ws: ServerWebSocket<unknown>, frame: { type: string; intentId?: string }) => void;
  rest?: (req: Request, url: URL) => Response | Promise<Response>;
}

const snapshot = {
  type: "snapshot",
  seq: 0,
  you: { campaignId: "c1", role: "dm", playerId: null },
  records: {},
};

/** A fake server on port 0 + a data dir whose lock points at it (this PID: alive). */
function fake(script: Script, opts: { timeoutMs?: number } = {}) {
  let hits = 0;
  const srv = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req, server) {
      hits++;
      const url = new URL(req.url);
      if (url.pathname === "/ws" && server.upgrade(req)) return undefined;
      return script.rest?.(req, url) ?? new Response(null, { status: 404 });
    },
    websocket: {
      message(ws, msg) {
        script.ws?.(ws, JSON.parse(String(msg)));
      },
    },
  });
  const dir = mkdtempSync(path.join(os.tmpdir(), "pp-mcp-fake-"));
  writeFileSync(
    path.join(dir, "server.lock"),
    JSON.stringify({ owner: "server", pid: process.pid, port: srv.port, startedAt: "" }),
  );
  cleanups.push(() => {
    srv.stop(true);
    rmSync(dir, { recursive: true, force: true });
  });
  const reaches: string[] = [];
  const caller = new Caller({
    dataDir: dir,
    profile: "dev",
    dmSecret: SECRET,
    log: quietLog,
    timeoutMs: opts.timeoutMs ?? 2000,
    trace: (r) => reaches.push(r),
  });
  return { caller, reaches, hits: () => hits, srv };
}

async function failure(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    if (err instanceof AgentError) return { code: err.code, message: err.message };
    throw err;
  }
  throw new Error("expected a tool error");
}

const readSnapshot = (c: Caller) => c.ws({}, async (s) => s.snapshot.you.campaignId);
const helloThen =
  (act: (ws: ServerWebSocket<unknown>) => void): Script["ws"] =>
  (ws, f) => {
    if (f.type === "hello") act(ws);
  };

describe("FR-AGENT-06 stopped mid-call", () => {
  test("FR-AGENT-06 the WS drops after hello → server_stopped; a read is safe to retry", async () => {
    const { caller } = fake({ ws: helloThen((ws) => ws.close(1011)) });
    const f = await failure(readSnapshot(caller));
    expect(f.code).toBe("server_stopped");
    expect(f.message).toContain("Safe to retry");
  });

  test("FR-AGENT-06 no answer within the timeout → server_stopped", async () => {
    const { caller } = fake({ ws: () => {} }, { timeoutMs: 200 });
    expect((await failure(readSnapshot(caller))).code).toBe("server_stopped");
  });

  test("FR-AGENT-06 the WS drops before the ack of a write → may or may not be saved", async () => {
    const { caller } = fake({
      ws: (ws, f) => {
        if (f.type === "hello") ws.send(JSON.stringify(snapshot));
        if (f.type === "intent") ws.close(1001);
      },
    });
    const f = await failure(caller.ws({ write: true }, (s) => s.intent("char.edit", {})));
    expect(f.code).toBe("server_stopped");
    expect(f.message).toContain("may or may not be saved");
  });

  test("FR-AGENT-06 a REST call without an answer → server_stopped, write wording", async () => {
    const { caller } = fake(
      {
        rest: async () => {
          await Bun.sleep(1000);
          return new Response("{}");
        },
      },
      { timeoutMs: 150 },
    );
    const f = await failure(
      caller.rest("POST /api/entities", { body: {}, write: true }, z.unknown()),
    );
    expect(f.code).toBe("server_stopped");
    expect(f.message).toContain("read it back");
  });
});

describe("FR-AGENT-05 not running", () => {
  test("FR-AGENT-05 a live lock whose port refuses → server_not_running, REST and WS", async () => {
    const { caller, srv } = fake({});
    srv.stop(true);
    const rest = await failure(caller.rest("GET /api/campaigns", {}, z.unknown()));
    expect(rest.code).toBe("server_not_running");
    expect((await failure(readSnapshot(caller))).code).toBe("server_not_running");
  });
});

describe("FR-AGENT-08 auth latch and throttle", () => {
  test("FR-AGENT-08 WS 4401 + login probe 401 → auth, then no further DM check", async () => {
    const { caller, reaches, hits } = fake({
      ws: helloThen((ws) => ws.close(4401, "credential-invalid")),
      rest: (_req, url) =>
        url.pathname === "/api/dm/login"
          ? Response.json({ code: "unauthorized", message: "Wrong DM secret" }, { status: 401 })
          : new Response(null, { status: 404 }),
    });
    const f = await failure(readSnapshot(caller));
    expect(f.code).toBe("auth");
    expect(f.message).toContain("PP_DM_SECRET");
    expect(reaches).toEqual(["ws", "POST /api/dm/login"]);
    const before = hits();
    expect((await failure(caller.rest("GET /api/campaigns", {}, z.unknown()))).code).toBe("auth");
    expect((await failure(readSnapshot(caller))).code).toBe("auth");
    expect(hits()).toBe(before);
    expect(reaches).toHaveLength(2);
  });

  test("FR-AGENT-08 WS 4401 + probe 429 or 204 → throttled; later calls still check", async () => {
    let login = 429;
    const { caller, reaches } = fake({
      ws: helloThen((ws) => ws.close(4401)),
      rest: () =>
        login === 429
          ? Response.json({ code: "throttled", message: "Too many attempts." }, { status: 429 })
          : new Response(null, { status: 204 }),
    });
    const a = await failure(readSnapshot(caller));
    expect(a.code).toBe("throttled");
    expect(a.message).not.toContain(".env");
    login = 204;
    const b = await failure(readSnapshot(caller));
    expect(b.code).toBe("throttled");
    expect(b.message).not.toContain(".env");
    expect(reaches).toEqual(["ws", "POST /api/dm/login", "ws", "POST /api/dm/login"]);
  });

  test("FR-AGENT-08 the hello carries the DM secret, REST a Bearer header", async () => {
    let hello: unknown = null;
    let header = "";
    const { caller } = fake({
      ws: (ws, f) => {
        hello = f;
        ws.send(JSON.stringify(snapshot));
      },
      rest: (req) => {
        header = req.headers.get("authorization") ?? "";
        return Response.json({ campaigns: [] });
      },
    });
    expect(await readSnapshot(caller)).toBe("c1");
    expect(hello).toEqual({ type: "hello", credential: { role: "dm", secret: SECRET } });
    await caller.rest("GET /api/campaigns", {}, z.unknown());
    expect(header).toBe(`Bearer ${SECRET}`);
  });
});

describe("FR-AGENT-10 FR-AGENT-11 server answers", () => {
  test("FR-AGENT-10 WS 4409 → conflict: open a campaign in the DM client", async () => {
    const { caller } = fake({ ws: helloThen((ws) => ws.close(4409, "campaign-inactive")) });
    expect(await failure(readSnapshot(caller))).toEqual({
      code: "conflict",
      message: "No active campaign: open one in the DM client.",
    });
  });

  test("FR-AGENT-11 reject unknown_intent → internal: server too old", async () => {
    const { caller } = fake({
      ws: (ws, f) => {
        if (f.type === "hello") ws.send(JSON.stringify(snapshot));
        if (f.type === "intent") {
          ws.send(
            JSON.stringify({
              type: "reject",
              intentId: f.intentId,
              code: "unknown_intent",
              message: "Unknown intent",
            }),
          );
        }
      },
    });
    const f = await failure(caller.ws({}, (s) => s.load("imported-entity", z.unknown(), ["x"])));
    expect(f.code).toBe("internal");
    expect(f.message).toContain("Server too old for this tool (sync.load)");
  });

  test("FR-AGENT-11 REST 500 with a non-JSON body → internal", async () => {
    const { caller } = fake({ rest: () => new Response("<html>", { status: 500 }) });
    expect((await failure(caller.rest("GET /api/campaigns", {}, z.unknown()))).code).toBe(
      "internal",
    );
  });
});

describe("FR-AGENT-14 allow-list", () => {
  test("FR-AGENT-14 only the §9 routes and intents; nothing deletes; others aren't sent", async () => {
    expect(ALLOWED_ROUTES.filter((r) => r.startsWith("DELETE"))).toEqual([]);
    expect([...ALLOWED_INTENTS].sort()).toEqual(["char.edit", "char.putRow", "sync.load"]);
    const { caller, reaches, hits } = fake({
      ws: (ws, f) => {
        if (f.type === "hello") ws.send(JSON.stringify(snapshot));
      },
    });
    const del = await failure(
      caller.rest("DELETE /api/entities/:id" as never, { id: "x" }, z.unknown()),
    );
    expect(del.code).toBe("internal");
    const row = await failure(caller.ws({}, (s) => s.intent("char.deleteRow" as never, {})));
    expect(row.code).toBe("internal");
    expect(reaches).toEqual(["ws"]);
    expect(hits()).toBe(1);
  });
});
