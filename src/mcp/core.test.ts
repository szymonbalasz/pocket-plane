// AGENT §13 unit: lock check order, §11 mapping, list paging, plan_check frame, list-tools.
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { LockInfo } from "@server/runtime/lock";
import type { CreatureSheetRecord } from "@shared/character-sheet/sheet";
import { ENTITY_NAME_MAX, type EntityRecord } from "@shared/entities/schemas";
import { z } from "zod";
import { Caller } from "./client";
import { AgentError, rejectError, restError, scrub, toToolError } from "./errors";
import { findServer, type LockReader } from "./lock";
import { checkPlan, type PlanWorld } from "./plan";
import { allTools, createMcpServer, listing } from "./server";
import { LIST_PAGE, page } from "./tools/read";
import { defineTool, TOOLS } from "./tools/registry";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
const tmp = () => {
  const d = mkdtempSync(path.join(os.tmpdir(), "pp-mcp-unit-"));
  dirs.push(d);
  return d;
};

const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err instanceof AgentError ? [err.code, err.message] : ["thrown", String(err)];
  }
  return ["ok", ""];
};

const quietLog = { info() {}, warn() {}, error() {} };

describe("FR-AGENT-04 find the server from server.lock", () => {
  const lock = (l: Partial<LockInfo> | null, alive = true): LockReader => ({
    read: () =>
      l === null
        ? null
        : { owner: "server", pid: 4242, port: 4102, startedAt: "2026-10-29T00:00:00Z", ...l },
    alive: () => alive,
  });
  const find = (r: LockReader) => codeOf(() => findServer("/data", "verify", r));

  test("FR-AGENT-04 FR-AGENT-05 checks in order: parses → PID alive → owner server → port set", () => {
    expect(find(lock(null))[0]).toBe("server_not_running");
    // A dead PID wins over every later check (a stale loader lock or one without a port).
    expect(find(lock({ owner: "loader", port: null }, false))[0]).toBe("server_not_running");
    expect(find(lock({ owner: "loader", port: null }))).toEqual([
      "server_busy",
      expect.stringContaining("fixture load running"),
    ]);
    expect(find(lock({ port: null }))).toEqual([
      "server_busy",
      expect.stringContaining("server starting"),
    ]);
    expect(findServer("/data", "verify", lock({}))).toEqual({
      port: 4102,
      http: "http://127.0.0.1:4102",
      ws: "ws://127.0.0.1:4102",
    });
  });

  test("FR-AGENT-05 not running names the profile and the next step", () => {
    const [, msg] = find(lock(null));
    expect(msg).toContain("profile verify");
    expect(msg).toContain("Start the server (`bun run start` or `bun run dev`)");
  });

  test("FR-AGENT-07 an unreadable or dead-PID lock file is read, never removed", async () => {
    const dir = tmp();
    const file = path.join(dir, "server.lock");
    writeFileSync(file, "{not json");
    expect(codeOf(() => findServer(dir, "dev"))[0]).toBe("server_not_running");
    const child = Bun.spawn([process.execPath, "-e", ""]);
    await child.exited;
    writeFileSync(
      file,
      JSON.stringify({ owner: "server", pid: child.pid, port: 1, startedAt: "" }),
    );
    expect(codeOf(() => findServer(dir, "dev"))[0]).toBe("server_not_running");
    expect(existsSync(file)).toBe(true);
  });
});

describe("FR-AGENT-11 §11 error mapping", () => {
  const rest = (status: number, body: unknown) => {
    const e = restError(status, body, "GET /api/x");
    return [e.code, e.message, e.issues];
  };
  const issues = [{ path: ["name"], message: "Name taken" }];

  test("FR-AGENT-11 REST 400 / 403 / 404 / 409 keep their code, message and issues", () => {
    expect(rest(400, { code: "invalid", message: "Invalid input", issues })).toEqual([
      "invalid",
      "Invalid input",
      issues,
    ]);
    expect(rest(403, { code: "forbidden", message: "Imported entries are read-only." })[0]).toBe(
      "forbidden",
    );
    expect(rest(404, { code: "not_found", message: "Unknown entry" })).toEqual([
      "not_found",
      "Unknown entry",
      undefined,
    ]);
    expect(rest(409, { code: "conflict", message: "Name taken" })[1]).toBe("Name taken");
  });

  test("FR-AGENT-10 409 no active campaign → conflict with the next step", () => {
    expect(rest(409, { code: "conflict", message: "No active campaign" })).toEqual([
      "conflict",
      "No active campaign: open one in the DM client.",
      undefined,
    ]);
  });

  test("FR-AGENT-08 REST 401 → auth; 429 → throttled, never blaming .env", () => {
    expect(rest(401, { code: "unauthorized", message: "Wrong DM secret" })[0]).toBe("auth");
    const [code, msg] = rest(429, { code: "throttled", message: "Too many attempts." });
    expect(code).toBe("throttled");
    expect(msg).not.toContain(".env");
    expect(rest(429, undefined)[1]).not.toContain(".env");
  });

  test("FR-AGENT-11 500, unparseable bodies and unknown_intent → internal", () => {
    expect(rest(500, { code: "internal", message: "Internal error" })).toEqual([
      "internal",
      "Internal error",
      undefined,
    ]);
    expect(rest(502, "<html>")[0]).toBe("internal");
    expect(rest(404, { code: "unknown_intent", message: "x" })).toEqual([
      "internal",
      expect.stringContaining("Server too old for this tool (GET /api/x)"),
      undefined,
    ]);
  });

  test("FR-AGENT-11 WS rejects map per §11, unknown_intent names the intent", () => {
    const rej = (code: string) =>
      rejectError(
        { type: "reject", intentId: "mcp-1", code, message: "m" } as never,
        "char.putRow",
      );
    for (const c of ["invalid", "forbidden", "not_found", "conflict"] as const) {
      expect(rej(c).code).toBe(c);
    }
    expect(rej("internal").code).toBe("internal");
    expect(rej("unknown_intent").code).toBe("internal");
    expect(rej("unknown_intent").message).toContain("Server too old for this tool (char.putRow)");
  });

  test("FR-AGENT-11 FR-AGENT-03 unexpected errors become internal; the secret is scrubbed", () => {
    expect(toToolError(new Error("boom secret-123456789"))).toEqual({
      code: "internal",
      message: "Internal error in the MCP server (see its stderr).",
    });
    expect(scrub("a secret-123456789 b secret-123456789", "secret-123456789")).toBe(
      "a ‹secret› b ‹secret›",
    );
  });
});

describe("FR-AGENT-12 list paging", () => {
  const rows = Array.from({ length: 120 }, (_, i) => ({
    id: `id-${String(i).padStart(3, "0")}`,
    name: i % 2 ? `Goblin ${i}` : `Orc ${i}`,
  }));

  test("FR-AGENT-12 ≤ 50 per page, cursor continues, q uses the shared matcher", () => {
    const p1 = page(rows, {});
    expect(p1.items).toHaveLength(LIST_PAGE);
    const p2 = page(rows, { cursor: p1.nextCursor as string });
    const p3 = page(rows, { cursor: p2.nextCursor as string });
    expect(p3.nextCursor).toBeNull();
    const all = [...p1.items, ...p2.items, ...p3.items].map((r) => r.id);
    expect(new Set(all).size).toBe(120);
    const orcs = page(rows, { q: "orc" });
    expect(orcs.items.every((r) => r.name.startsWith("Orc"))).toBe(true);
    expect(page(rows, { q: "orc 10" }).items.map((r) => r.name)).toContain("Orc 10");
  });
});

describe("FR-AGENT-19 plan_check frame", () => {
  const caller = new Caller({ dataDir: tmp(), profile: "dev", dmSecret: "x", log: quietLog });
  const elite = {
    id: "ent-elite",
    kind: "monster",
    name: "Elite Goblin Warrior",
    statBlock: { attacks: [{ name: "Scimitar" }] },
  } as unknown as EntityRecord;
  const sheet = {
    id: "ent-elite",
    features: Array.from({ length: 29 }, (_, i) => ({ id: `f${i}` })),
    spells: [],
    items: [],
  } as unknown as CreatureSheetRecord;
  const world: PlanWorld = {
    campaign: { id: "c1", name: "Fixture Campaign" },
    entities: [elite],
    sheets: [sheet],
    imported: async (id) => (id === "imp-goblin" ? ({ id, name: "Goblin" } as never) : null),
  };
  // A stand-in write tool (slice 2's creature tools register the real ones).
  const fakeCreate = defineTool({
    name: "fake_create",
    description: "test",
    input: z.strictObject({
      name: z.string().min(1).max(ENTITY_NAME_MAX),
      baseId: z.string().optional(),
      features: z.number().int().min(0).default(0),
      onto: z.string().optional(),
    }),
    write: true,
    async plan(ctx, input) {
      ctx.claimEntityName("monster", input.name, ["name"]);
      if (input.baseId) await ctx.target(input.baseId, ["baseId"], "monster");
      ctx.planRows(input.onto ?? `planned:${ctx.call}`, "features", input.features, ["features"]);
      return `create ${input.name}`;
    },
    run: async () => ({}),
  });
  const tools = [...TOOLS, fakeCreate];
  const check = (calls: { tool: string; input?: unknown }[]) =>
    checkPlan(calls, tools, world, caller);

  test("FR-AGENT-19 a reads-only plan is ok and says what each call would do", async () => {
    const r = await check([{ tool: "characters_list", input: {} }, { tool: "campaigns_list" }]);
    expect(r).toEqual({
      ok: true,
      issues: [],
      would: ["characters_list: read only", "campaigns_list: read only"],
    });
  });

  test("FR-AGENT-19 unknown tools and bad inputs are issues with call and path", async () => {
    const r = await check([
      { tool: "creature_delete", input: {} },
      { tool: "plan_check", input: { calls: [] } },
      { tool: "compendium_search", input: { crMin: "1" } },
      { tool: "character_get", input: { id: "" } },
    ]);
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => [i.call, i.path])).toEqual([
      [0, ["tool"]],
      [1, ["tool"]],
      [2, ["input", "crMin"]],
      [3, ["input", "id"]],
    ]);
  });

  test("FR-AGENT-19 a name taken in the campaign or earlier in the plan (case-insensitive)", async () => {
    const r = await check([
      { tool: "fake_create", input: { name: "Orc Spear Runner" } },
      { tool: "fake_create", input: { name: "orc spear runner" } },
      { tool: "fake_create", input: { name: "ELITE goblin warrior" } },
      { tool: "fake_create", input: { name: "Orc Shield" } },
    ]);
    expect(r.issues).toEqual([
      {
        call: 1,
        path: ["input", "name"],
        message: 'Name "orc spear runner" is already used by call 0',
      },
      { call: 2, path: ["input", "name"], message: 'Name "ELITE goblin warrior" is taken' },
    ]);
    expect(r.would).toHaveLength(4);
  });

  test("FR-AGENT-19 planned rows over ROW_LIMITS, counting rows planned earlier", async () => {
    const r = await check([
      { tool: "fake_create", input: { name: "A", onto: "ent-elite", features: 1 } },
      { tool: "fake_create", input: { name: "B", onto: "ent-elite", features: 1 } },
      { tool: "fake_create", input: { name: "C", features: 30 } },
      { tool: "fake_create", input: { name: "D", features: 31 } },
    ]);
    expect(r.issues.map((i) => [i.call, i.message])).toEqual([
      [1, "Too many features: 30 max (has 29, the plan adds 2)"],
      [3, "Too many features: 30 max (has 0, the plan adds 31)"],
    ]);
  });

  test("FR-AGENT-19 the target exists, is the right kind and isn't imported", async () => {
    const r = await check([
      { tool: "fake_create", input: { name: "A", baseId: "ent-elite" } },
      { tool: "fake_create", input: { name: "B", baseId: "imp-goblin" } },
      { tool: "fake_create", input: { name: "C", baseId: "nope" } },
    ]);
    expect(r.issues.map((i) => [i.call, i.message])).toEqual([
      [1, "Goblin is imported and read-only: derive a custom creature"],
      [2, "No monster nope"],
    ]);
  });
});

/** Not allowed at the top of a tool's `input_schema` (Anthropic tool use). */
const COMBINATORS = ["oneOf", "anyOf", "allOf", "not"];

describe("FR-AGENT-01 list-tools", () => {
  test("FR-AGENT-01 every listed inputSchema is an object at the top level, no oneOf / anyOf / allOf / not", () => {
    const listed = allTools().map(listing);
    expect(listed.length).toBeGreaterThan(15);
    for (const t of listed) {
      expect({ tool: t.name, type: t.inputSchema.type }).toEqual({ tool: t.name, type: "object" });
      const top = Object.keys(t.inputSchema).filter((k) => COMBINATORS.includes(k));
      expect({ tool: t.name, top }).toEqual({ tool: t.name, top: [] });
    }
  });

  test("FR-AGENT-01 FR-AGENT-15 serves exactly the §9 tools; write tools not read-only", async () => {
    const server = createMcpServer({
      caller: new Caller({ dataDir: tmp(), profile: "dev", dmSecret: "x", log: quietLog }),
      log: quietLog,
      dmSecret: "x",
    });
    const client = new Client({ name: "t", version: "0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    const { tools } = await client.listTools();
    const writes = [
      "character_edit",
      "character_put_row",
      "creature_create",
      "creature_derive",
      "creature_edit",
      "creature_put_row",
      "homebrew_create",
      "homebrew_edit",
      "homebrew_share",
    ];
    expect(tools.map((t) => t.name).sort()).toEqual([
      "campaigns_list",
      "character_edit",
      "character_get",
      "character_put_row",
      "characters_list",
      "compendium_get",
      "compendium_search",
      "creature_create",
      "creature_derive",
      "creature_edit",
      "creature_get",
      "creature_put_row",
      "creatures_list",
      "homebrew_create",
      "homebrew_edit",
      "homebrew_share",
      "plan_check",
      "players_list",
    ]);
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint).toBe(!writes.includes(t.name));
      expect(t.inputSchema.type).toBe("object");
      expect(t.description?.length ?? 0).toBeGreaterThan(20);
    }
    const props = (name: string) =>
      Object.keys(tools.find((t) => t.name === name)?.inputSchema.properties ?? {}).sort();
    expect(props("characters_list")).toEqual(["cursor", "q"]);
    expect(props("creature_get")).toEqual(["id"]);
    expect(props("plan_check")).toEqual(["calls"]);
    // FR-AGENT-25 / -26: PutEntryBody; edit / share by id.
    expect(props("homebrew_create")).toEqual(["derivedFromId", "entry", "imageAssetIds", "shared"]);
    expect(props("homebrew_edit")).toEqual(["id", "patch"]);
    expect(props("homebrew_share")).toEqual(["id", "shared"]);
    // FR-AGENT-27 / -28: no owner key; put_row lists as one flat object (no top-level oneOf).
    expect(props("character_edit")).toEqual(["id", "set"]);
    const set = tools.find((t) => t.name === "character_edit")?.inputSchema.properties?.set as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(set.properties)).not.toContain("ownerPlayerId");
    expect(props("character_put_row")).toEqual(["creatureId", "list", "row"]);
    expect(props("creature_put_row")).toEqual(["creatureId", "list", "row"]);
    // FR-AGENT-12: the strict SearchQuery, no key added.
    expect(props("compendium_search")).toEqual(
      [
        "category",
        "chapter",
        "className",
        "crMax",
        "crMin",
        "cursor",
        "definitionId",
        "kind",
        "level",
        "q",
        "rarity",
        "sameAs",
        "school",
        "section",
        "subclass",
        "type",
      ].sort(),
    );
    expect(props("creature_derive")).toEqual(["baseId", "entryId", "name", "notes", "rows", "set"]);
    expect(props("creature_edit")).toEqual(["id", "set"]);
    expect(
      allTools()
        .filter((t) => t.write)
        .map((t) => t.name)
        .sort(),
    ).toEqual(writes);
    await client.close();
  });
});
