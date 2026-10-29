// AGENT §13 "Skill plan" (slice 5): the content skill's front matter and tool names, and its
// example plans through `plan_check` on a real in-process server (port 0, `agent-api` bundle,
// harness-written server.lock, MCP server on the SDK in-memory transport). Nothing is written.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadBundle } from "@fixtures/index";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { closeDb, type Db, openFileDb } from "@server/db/client";
import { eventLog } from "@server/db/schema";
import { startTestServer, type TestServer } from "@server/testing/harness";
import { TEST_SECRET } from "@server/testing/services";
import { Caller } from "./client";
import { AgentErrorCode } from "./errors";
import { createMcpServer } from "./server";

const SKILL_DIR = path.join(import.meta.dir, "../../.claude/skills/pocket-plane-content");
const skillMd = readFileSync(path.join(SKILL_DIR, "SKILL.md"), "utf8");

type Plan = {
  calls: { tool: string; input: Record<string, unknown> }[];
};
const example = (file: string): Plan =>
  JSON.parse(readFileSync(path.join(SKILL_DIR, "examples", file), "utf8"));

/** Slice 4 (`build/agent-characters`) tools: named by the skill, registered once it merges. */
const PENDING_TOOLS = ["character_edit", "character_put_row"];

/**
 * The examples' `"<… id>"` placeholders → compendium monster names to search. The mini SRD set
 * has no Orc: the Hobgoblin stands in (any monster entry is a valid base).
 */
const STAND_INS: Record<string, string> = {
  "<Orc entry id>": "Hobgoblin",
  "<Wolf entry id>": "Wolf",
};

let h: TestServer;
let db: Db;
let bundleDir: string;
let lockDir: string;
const log = { info: () => {}, warn: () => {}, error: () => {} };

interface Result {
  isError: boolean;
  // biome-ignore lint/suspicious/noExplicitAny: tool results are JSON read field by field in tests
  json: any;
}

let client: Client;
const call = async (name: string, args: Record<string, unknown> = {}): Promise<Result> => {
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content as { text: string }[]).map((c) => c.text).join("");
  return { isError: r.isError === true, json: JSON.parse(text) };
};
const ids: Record<string, string> = {};
const eventCount = () => db.select().from(eventLog).all().length;

/** The plan with every placeholder replaced by its stand-in's id; an unknown one fails. */
function filled(plan: Plan): Plan {
  return JSON.parse(
    JSON.stringify(plan).replace(/"(<[^">]+>)"/g, (_, ph: string) => {
      const id = ids[ph];
      if (!id) throw new Error(`No stand-in for placeholder ${ph}`);
      return JSON.stringify(id);
    }),
  );
}

beforeAll(async () => {
  const loaded = await loadBundle("agent-api", { dmSecret: TEST_SECRET, testMode: true });
  bundleDir = loaded.dir;
  db = openFileDb(loaded.config.dbPath);
  h = await startTestServer({ db });
  lockDir = mkdtempSync(path.join(os.tmpdir(), "pp-mcp-skill-"));
  writeFileSync(
    path.join(lockDir, "server.lock"),
    JSON.stringify({
      owner: "server",
      pid: process.pid,
      port: Number(new URL(h.http).port),
      startedAt: "2026-03-01T00:00:00Z",
    }),
  );
  const caller = new Caller({ dataDir: lockDir, profile: "verify", dmSecret: TEST_SECRET, log });
  const server = createMcpServer({ caller, log, dmSecret: TEST_SECRET });
  client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  for (const [ph, name] of Object.entries(STAND_INS)) {
    const r = await call("compendium_search", { q: name, kind: "monster" });
    const hit = r.json.results.find((x: { name: string }) => x.name === name);
    if (!hit) throw new Error(`no compendium monster ${name}`);
    ids[ph] = hit.id;
  }
});

afterAll(async () => {
  await client.close();
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

describe("agent-api content skill", () => {
  test("FR-AGENT-29 SKILL.md front matter, tool names and error codes are real", async () => {
    const front = /^---\r?\nname: (.+)\r?\ndescription: (.+)\r?\n---/.exec(skillMd);
    expect(front?.[1]).toBe("pocket-plane-content");
    expect(front?.[2]).toContain("the DM asks to create or edit Pocket Plane content");

    const registered = (await client.listTools()).tools.map((t) => t.name);
    const known = new Set([...registered, ...PENDING_TOOLS]);
    const codes = new Set<string>(AgentErrorCode.options);
    const named = [...skillMd.matchAll(/`([a-z]+(?:_[a-z]+)+)\b/g)].map((x) => x[1] as string);
    const unknown = named.filter((n) => !known.has(n) && !codes.has(n));
    expect(unknown).toEqual([]);
    // Every tool and every error code has guidance.
    expect(registered.filter((t) => !named.includes(t))).toEqual([]);
    expect(PENDING_TOOLS.filter((t) => !named.includes(t))).toEqual([]);
    expect(AgentErrorCode.options.filter((c) => !skillMd.includes(`| \`${c}\` |`))).toEqual([]);

    for (const file of ["orc-variants.json", "reddit-item.json"]) {
      for (const c of example(file).calls) expect(known.has(c.tool)).toBe(true);
    }
  });

  test("FR-AGENT-30 FR-AGENT-32 orc variants: one base, N derives with set / rows / notes, a mount pair", () => {
    const { calls } = example("orc-variants.json");
    const derives = calls.filter((c) => c.tool === "creature_derive");
    expect(derives).toHaveLength(calls.length);
    const orcs = derives.filter((c) => c.input.entryId === "<Orc entry id>");
    expect(orcs).toHaveLength(3);
    for (const c of orcs) {
      expect(c.input.rows).toBeArray();
      expect(c.input.notes).toBeString();
    }
    expect(orcs.filter((c) => c.input.set !== undefined)).toHaveLength(2);

    // The mount: "Mount: ‹mount›" in the rider's notes, "Rider: ‹rider›" in the mount's.
    const rider = orcs.find((c) => String(c.input.notes).includes("Mount: "));
    const mount = derives.find((c) => String(c.input.notes).startsWith("Rider: "));
    expect(rider?.input.notes).toContain(`\nMount: ${mount?.input.name}`);
    expect(mount?.input).toMatchObject({
      entryId: "<Wolf entry id>",
      name: `${rider?.input.name}'s Wolf`,
      notes: `Rider: ${rider?.input.name}`,
    });
  });

  test("FR-AGENT-31 orc-variants.json → plan_check ok, nothing written; two equal names → one issue", async () => {
    const before = eventCount();
    const plan = filled(example("orc-variants.json"));
    const r = await call("plan_check", plan);
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ ok: true, issues: [] });
    expect(r.json.would).toEqual([
      'creature_derive: new custom creature "Orc Shieldbearer" from Hobgoblin, set ac, attacks (+1 row, notes)',
      'creature_derive: new custom creature "Orc Spear Runner" from Hobgoblin, set speed, attacks (+1 row, notes)',
      'creature_derive: new custom creature "Orc Wolf Rider" from Hobgoblin (+1 row, notes)',
      `creature_derive: new custom creature "Orc Wolf Rider's Wolf" from Wolf (notes)`,
    ]);
    expect(eventCount()).toBe(before);
    expect((await call("creatures_list", { q: "orc" })).json.creatures).toEqual([]);

    const dup = structuredClone(plan);
    (dup.calls[2] as Plan["calls"][number]).input.name = "orc SPEAR runner";
    const bad = await call("plan_check", dup);
    expect(bad.json.ok).toBe(false);
    expect(bad.json.issues).toEqual([
      {
        call: 2,
        path: ["input", "name"],
        message: 'Name "orc SPEAR runner" is already used by call 1',
      },
    ]);
    expect(eventCount()).toBe(before);
  });

  test("FR-AGENT-31 reddit-item.json → plan_check ok, unshared, nothing written", async () => {
    const before = eventCount();
    const r = await call("plan_check", filled(example("reddit-item.json")));
    expect(r.json).toEqual({
      ok: true,
      issues: [],
      would: ['homebrew_create: item "Tankard of Bottomless Courage", DM only'],
    });
    expect(eventCount()).toBe(before);
    const search = await call("compendium_search", { q: "Bottomless Courage" });
    expect(search.json.results).toEqual([]);
  });
});
