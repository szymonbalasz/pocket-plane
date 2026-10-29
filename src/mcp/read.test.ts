// AGENT §13 integration: a real in-process server (port 0) on the `agent-api` bundle, a
// harness-written server.lock, the MCP server on the SDK in-memory transport.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadBundle } from "@fixtures/index";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { closeDb, type Db, openFileDb } from "@server/db/client";
import { campaign, entity, eventLog, player } from "@server/db/schema";
import { THROTTLE_LOCK_MS } from "@server/features/campaign-management/auth";
import { startTestServer, type TestServer } from "@server/testing/harness";
import { TEST_SECRET } from "@server/testing/services";
import { eq, isNull } from "drizzle-orm";
import { Caller } from "./client";
import { createMcpServer } from "./server";

let h: TestServer;
let db: Db;
let bundleDir: string;
let lockDir: string;
const outputs: string[] = [];
const logLines: string[] = [];
const log = {
  info: (m: string) => logLines.push(m),
  warn: (m: string) => logLines.push(m),
  error: (m: string) => logLines.push(m),
};

interface Result {
  isError: boolean;
  // biome-ignore lint/suspicious/noExplicitAny: tool results are JSON read field by field in tests
  json: any;
}

/** A fresh MCP server + client (fresh auth latch), tracing what each call reaches. */
async function mcp(secret = TEST_SECRET) {
  const reaches: string[] = [];
  const caller = new Caller({
    dataDir: lockDir,
    profile: "verify",
    dmSecret: secret,
    log,
    trace: (r) => reaches.push(r),
  });
  const server = createMcpServer({ caller, log, dmSecret: secret });
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return {
    reaches,
    async call(name: string, args: Record<string, unknown> = {}): Promise<Result> {
      const r = await client.callTool({ name, arguments: args });
      const text = (r.content as { text: string }[]).map((c) => c.text).join("");
      outputs.push(text);
      return { isError: r.isError === true, json: JSON.parse(text) };
    },
    close: () => client.close(),
  };
}

const ids: Record<string, string> = {};
let tokens: string[] = [];
let campaignName = "";

beforeAll(async () => {
  const loaded = await loadBundle("agent-api", { dmSecret: TEST_SECRET, testMode: true });
  bundleDir = loaded.dir;
  db = openFileDb(loaded.config.dbPath);
  for (const e of db.select().from(entity).where(isNull(entity.campaignId)).all()) {
    ids[`imported:${e.name}`] = e.id;
  }
  for (const e of db.select().from(entity).all()) if (e.campaignId) ids[e.name] = e.id;
  tokens = db
    .select({ t: player.linkToken })
    .from(player)
    .all()
    .map((r) => r.t);
  campaignName =
    db.select({ n: campaign.name }).from(campaign).where(eq(campaign.active, true)).get()?.n ?? "";
  h = await startTestServer({ db });
  lockDir = mkdtempSync(path.join(os.tmpdir(), "pp-mcp-lock-"));
  // The harness writes the lock itself (spec §13): its own PID and port, not acquireLock.
  writeFileSync(
    path.join(lockDir, "server.lock"),
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
  closeDb(db);
  for (const d of [bundleDir, lockDir]) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // Windows may hold the WAL briefly; a leftover temp dir is harmless.
    }
  }
});

describe("agent-api read tools on a real server", () => {
  test("FR-AGENT-14 FR-AGENT-09 each read tool reaches only its §9 route / intent", async () => {
    const m = await mcp();
    const goblin = (await m.call("compendium_search", { q: "goblin", kind: "monster" })).json
      .results[0];
    const cases: [string, Record<string, unknown>, string[]][] = [
      ["campaigns_list", {}, ["GET /api/campaigns"]],
      ["players_list", {}, ["ws"]],
      ["characters_list", {}, ["ws"]],
      ["character_get", { id: ids.Mira }, ["ws"]],
      ["creatures_list", { q: "elite" }, ["ws"]],
      ["creature_get", { id: ids["Elite Goblin Warrior"] }, ["ws"]],
      ["creature_get", { id: goblin.definitionId }, ["ws", "intent sync.load"]],
      ["compendium_search", { q: "moonblade" }, ["GET /api/compendium/search"]],
      ["compendium_get", { id: goblin.id }, ["GET /api/compendium/entries/:id"]],
      ["plan_check", { calls: [{ tool: "characters_list", input: {} }] }, ["ws"]],
    ];
    for (const [tool, args, want] of cases) {
      m.reaches.length = 0;
      const r = await m.call(tool, args);
      expect({ tool, isError: r.isError, reaches: m.reaches }).toEqual({
        tool,
        isError: false,
        reaches: want,
      });
    }
    await m.close();
  });

  test("FR-AGENT-13 players_list: snapshot players + presence, never a link token", async () => {
    const m = await mcp();
    const r = await m.call("players_list");
    expect(r.json.players.map((p: { name: string }) => p.name).sort()).toEqual([
      "Player 1",
      "Player 2",
    ]);
    // MCP connections are DM connections: never in presence (players only).
    expect(r.json.players.every((p: { online: boolean }) => p.online === false)).toBe(true);
    const text = JSON.stringify(r.json);
    expect(text).not.toContain("linkToken");
    for (const t of tokens) expect(text).not.toContain(t);
    await m.close();
  });

  test("FR-AGENT-10 WS results name the snapshot's campaign; campaigns_list shows it active", async () => {
    const m = await mcp();
    const chars = await m.call("characters_list");
    expect(chars.json.campaign.name).toBe(campaignName);
    const camps = await m.call("campaigns_list");
    expect(camps.json.campaigns).toContainEqual(
      expect.objectContaining({ name: campaignName, active: true }),
    );
    await m.close();
  });

  test("FR-AGENT-12 lists: summaries, q via the shared matcher, records in wire shapes", async () => {
    const m = await mcp();
    const chars = await m.call("characters_list");
    expect(chars.json.characters).toEqual([
      expect.objectContaining({ id: ids.Mira, name: "Mira", level: expect.any(Number) }),
    ]);
    expect(chars.json.nextCursor).toBeNull();
    const all = await m.call("creatures_list");
    const names = all.json.creatures.map((c: { name: string }) => c.name);
    expect(names).toEqual(expect.arrayContaining(["Elite Goblin Warrior", "Owlbear"]));
    expect(all.json.creatures.find((c: { name: string }) => c.name === "Owlbear").petOf).toBe(
      ids.Mira,
    );
    const elite = await m.call("creatures_list", { q: "elite gob" });
    expect(elite.json.creatures.map((c: { name: string }) => c.name)).toEqual([
      "Elite Goblin Warrior",
    ]);
    const mira = await m.call("character_get", { id: ids.Mira });
    expect(mira.json.character).toMatchObject({ id: ids.Mira, kind: "character" });
    // No sheet row yet = an empty, unlocked sheet (FR-CHARX-02).
    expect(mira.json.sheet).toBeNull();
    const npc = await m.call("creature_get", { id: ids["Elite Goblin Warrior"] });
    expect(npc.json).toMatchObject({ imported: false, sheet: { notes: "NPC-NOTE-9" } });
    const owl = await m.call("creature_get", { id: ids.Owlbear });
    expect(owl.json.creature).toMatchObject({ companionOf: ids.Mira, turnMode: "after-owner" });
    await m.close();
  });

  test("FR-AGENT-12 imported definitions via sync.load; compendium search is the DM view", async () => {
    const m = await mcp();
    const search = await m.call("compendium_search", { q: "goblin", kind: "monster" });
    const goblin = search.json.results[0];
    const def = await m.call("creature_get", { id: goblin.definitionId });
    expect(def.json).toMatchObject({ imported: true, sheet: null, creature: { campaignId: null } });
    const entry = await m.call("compendium_get", { id: goblin.id });
    expect(entry.json.definition.id).toBe(goblin.definitionId);
    // DM view: unshared homebrew is listed (players never get it, FR-CMP-14).
    const secret = await m.call("compendium_search", { q: "CMP-SECRET" });
    expect(secret.json.results.map((r: { name: string }) => r.name)).toContain("CMP-SECRET-ITEM");
    // The strict SearchQuery: no key added, unknown keys refused before any request.
    m.reaches.length = 0;
    const bad = await m.call("compendium_search", { q: "x", limit: 5 });
    expect(bad).toMatchObject({ isError: true, json: { code: "invalid" } });
    expect(m.reaches).toEqual([]);
    await m.close();
  });

  test("FR-AGENT-11 wrong kind, unknown ids and bad input → tool errors", async () => {
    const m = await mcp();
    expect((await m.call("character_get", { id: ids["Elite Goblin Warrior"] })).json).toEqual({
      code: "invalid",
      message: "Not a character: use creature_get",
    });
    expect((await m.call("creature_get", { id: ids.Mira })).json.code).toBe("invalid");
    expect((await m.call("creature_get", { id: "no-such-id" })).json.code).toBe("not_found");
    expect((await m.call("compendium_get", { id: "no-such-id" })).json.code).toBe("not_found");
    expect((await m.call("characters_list", { cursor: "abc" })).json).toMatchObject({
      code: "invalid",
      issues: [{ path: ["cursor"] }],
    });
    await m.close();
  });

  test("FR-AGENT-19 plan_check reads once and leaves the event log unchanged", async () => {
    const count = () => db.select().from(eventLog).all().length;
    const before = count();
    const m = await mcp();
    const ok = await m.call("plan_check", {
      calls: [
        { tool: "creatures_list", input: { q: "orc" } },
        { tool: "creature_get", input: { id: ids.Owlbear } },
      ],
    });
    expect(ok.json).toEqual({
      ok: true,
      issues: [],
      would: ["creatures_list: read only", "creature_get: read only"],
    });
    const bad = await m.call("plan_check", {
      calls: [{ tool: "creature_delete", input: { id: ids.Owlbear } }],
    });
    expect(bad.json.ok).toBe(false);
    expect(bad.json.issues).toEqual([
      { call: 0, path: ["tool"], message: 'Unknown tool "creature_delete"' },
    ]);
    expect(count()).toBe(before);
    await m.close();
  });

  test("FR-AGENT-08 REST 401 → auth, then no further DM check until restart", async () => {
    const m = await mcp("wrong-secret-0123456");
    expect((await m.call("campaigns_list")).json).toEqual({
      code: "auth",
      message: expect.stringContaining("The server rejected PP_DM_SECRET"),
    });
    expect(m.reaches).toEqual(["GET /api/campaigns"]);
    expect((await m.call("players_list")).json.code).toBe("auth");
    expect((await m.call("compendium_search", { q: "x" })).json.code).toBe("auth");
    expect(m.reaches).toEqual(["GET /api/campaigns"]);
    await m.close();
    // WS 4401 is confirmed by the login probe before latching.
    const w = await mcp("wrong-secret-0123456");
    expect((await w.call("players_list")).json.code).toBe("auth");
    expect(w.reaches).toEqual(["ws", "POST /api/dm/login"]);
    await w.close();
  });

  test("FR-AGENT-08 5 failed browser logins → throttled, not auth; calls work once it lifts", async () => {
    for (let i = 0; i < 5; i++) {
      await fetch(`${h.http}/api/dm/login`, {
        method: "POST",
        headers: { authorization: "Bearer browser-typo-0000" },
      });
    }
    const m = await mcp();
    const rest = await m.call("campaigns_list");
    expect(rest.json.code).toBe("throttled");
    expect(rest.json.message).not.toContain(".env");
    const ws = await m.call("players_list");
    expect(ws.json.code).toBe("throttled");
    expect(m.reaches).toEqual(["GET /api/campaigns", "ws", "POST /api/dm/login"]);
    h.clock.advance(THROTTLE_LOCK_MS + 1);
    expect((await m.call("campaigns_list")).isError).toBe(false);
    expect((await m.call("players_list")).isError).toBe(false);
    await m.close();
  });

  test("FR-AGENT-03 FR-AGENT-13 the secret and link tokens appear in no result, error or log", () => {
    expect(outputs.length).toBeGreaterThan(30);
    const all = [...outputs, ...logLines].join("\n");
    expect(all).not.toContain(TEST_SECRET);
    expect(all).not.toContain("linkToken");
    for (const t of tokens) expect(all).not.toContain(t);
  });
});
