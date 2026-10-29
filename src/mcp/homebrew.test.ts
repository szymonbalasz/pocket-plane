// AGENT §13 slice 3 (homebrew): a real in-process server (port 0) on the `agent-api` bundle, a
// harness-written server.lock, the MCP server on the SDK in-memory transport, live player sockets.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadBundle } from "@fixtures/index";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { closeDb, type Db, openFileDb } from "@server/db/client";
import { asset, campaign, eventLog, player } from "@server/db/schema";
import { startTestServer, type TestClient, type TestServer } from "@server/testing/harness";
import { TEST_SECRET } from "@server/testing/services";
import type { CompendiumEntry } from "@shared/compendium/schemas";
import { eq } from "drizzle-orm";
import { Caller } from "./client";
import { createMcpServer } from "./server";
import { putBodyOf } from "./tools/homebrew";

const SECRET_ITEM = "CMP-SECRET-ITEM";

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

async function mcp() {
  const reaches: string[] = [];
  const caller = new Caller({
    dataDir: lockDir,
    profile: "verify",
    dmSecret: TEST_SECRET,
    log,
    trace: (r) => reaches.push(r),
  });
  const server = createMcpServer({ caller, log, dmSecret: TEST_SECRET });
  const client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return {
    reaches,
    async call(name: string, args: Record<string, unknown> = {}): Promise<Result> {
      reaches.length = 0;
      const r = await client.callTool({ name, arguments: args });
      const text = (r.content as { text: string }[]).map((c) => c.text).join("");
      outputs.push(text);
      return { isError: r.isError === true, json: JSON.parse(text) };
    },
    close: () => client.close(),
  };
}

let m: Awaited<ReturnType<typeof mcp>>;
const tokens: Record<string, string> = {};
const players: TestClient[] = [];
let imageIds: string[] = [];

/** A player's compendium search (FR-CMP-13 `Player <link token>`): result names. */
async function playerSearch(who: string, q: string): Promise<string[]> {
  const res = await fetch(`${h.http}/api/compendium/search?q=${encodeURIComponent(q)}`, {
    headers: { authorization: `Player ${tokens[who]}` },
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { results: { name: string }[] };
  return body.results.map((r) => r.name);
}

const dmEntry = async (q: string, kind?: string) => {
  const r = await m.call("compendium_search", kind ? { q, kind } : { q });
  const hit = r.json.results.find((x: { name: string }) => x.name === q);
  if (!hit) throw new Error(`no entry ${q}`);
  return (await m.call("compendium_get", { id: hit.id })).json.entry as CompendiumEntry;
};

const eventCount = () => db.select().from(eventLog).all().length;

beforeAll(async () => {
  const loaded = await loadBundle("agent-api", { dmSecret: TEST_SECRET, testMode: true });
  bundleDir = loaded.dir;
  db = openFileDb(loaded.config.dbPath);
  for (const p of db.select().from(player).all()) tokens[p.name] = p.linkToken;
  const cid = db.select({ id: campaign.id }).from(campaign).where(eq(campaign.active, true)).get()
    ?.id as string;
  imageIds = db
    .select({ id: asset.id })
    .from(asset)
    .where(eq(asset.campaignId, cid))
    .all()
    .map((r) => r.id)
    .slice(0, 2);
  h = await startTestServer({ db });
  lockDir = mkdtempSync(path.join(os.tmpdir(), "pp-mcp-lock-"));
  writeFileSync(
    path.join(lockDir, "server.lock"),
    JSON.stringify({
      owner: "server",
      pid: process.pid,
      port: Number(new URL(h.http).port),
      startedAt: "2026-03-01T00:00:00Z",
    }),
  );
  // Both players live for the whole file: the leak scan reads every frame they get.
  for (const who of ["Player 1", "Player 2"]) {
    players.push(await h.live({ role: "player", token: tokens[who] as string }));
  }
  m = await mcp();
});

afterAll(async () => {
  await m.close();
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

const draft = (name: string, text = "Glows faintly.") => ({
  kind: "item",
  name,
  facets: { category: "magic", rarity: "uncommon", attunement: false },
  body: { typeLine: "Wondrous item", text },
});

describe("agent-api homebrew tools on a real server", () => {
  test("FR-AGENT-25 homebrew_create reaches only POST /api/compendium/entries; unshared by default", async () => {
    const r = await m.call("homebrew_create", { entry: draft("Hb Lantern of Echoes") });
    expect(r.isError).toBe(false);
    expect(r.json).toEqual({
      entryId: expect.any(String),
      kind: "item",
      name: "Hb Lantern of Echoes",
      shared: false,
    });
    expect(m.reaches).toEqual(["POST /api/compendium/entries"]);
    const stored = await dmEntry("Hb Lantern of Echoes");
    expect(stored).toMatchObject({ id: r.json.entryId, shared: false, source: null });
    expect(await playerSearch("Player 1", "Lantern of Echoes")).toEqual([]);
  });

  test("FR-AGENT-25 a homebrew monster → custom creature (FR-CMP-24): invalid, nothing sent", async () => {
    const r = await m.call("homebrew_create", {
      entry: { kind: "monster", name: "Hb Orc", facets: {}, body: {} },
    });
    expect(r.isError).toBe(true);
    expect(r.json.code).toBe("invalid");
    expect(r.json.issues).toContainEqual({
      path: ["entry", "kind"],
      message: "Homebrew monsters are custom creatures: use creature_create or creature_derive",
    });
    expect(m.reaches).toEqual([]);
  });

  test("FR-AGENT-25 a name taken (case-insensitive) → the server's conflict", async () => {
    const r = await m.call("homebrew_create", { entry: draft("moonblade SHARD") });
    expect(r.json.code).toBe("conflict");
  });

  test("FR-AGENT-26 FR-AGENT-17 homebrew_edit: GET + PUT, keeps imageAssetIds / derivedFromId / shared", async () => {
    expect(imageIds.length).toBe(2);
    const fireball = await dmEntry("Fireball", "spell");
    const made = await m.call("homebrew_create", {
      entry: draft("Hb Ember Charm"),
      shared: true,
      derivedFromId: fireball.id,
      imageAssetIds: imageIds,
    });
    expect(made.isError).toBe(false);
    const id = made.json.entryId as string;
    const r = await m.call("homebrew_edit", {
      id,
      patch: { name: "Hb Ember Charm II", body: { text: "Warm to the touch." } },
    });
    expect(r.json).toEqual({ entryId: id, kind: "item", name: "Hb Ember Charm II", shared: true });
    expect(m.reaches).toEqual([
      "GET /api/compendium/entries/:id",
      "PUT /api/compendium/entries/:id",
    ]);
    const after = (await m.call("compendium_get", { id })).json.entry as CompendiumEntry;
    expect(after).toMatchObject({
      name: "Hb Ember Charm II",
      shared: true,
      derivedFromId: fireball.id,
      imageAssetIds: imageIds,
      facets: { category: "magic", rarity: "uncommon", attunement: false },
      body: { typeLine: "Wondrous item", text: "Warm to the touch." },
    });
    // A null key removes an optional field; the rest stays.
    await m.call("homebrew_edit", { id, patch: { facets: { rarity: null } } });
    const mundane = (await m.call("compendium_get", { id })).json.entry as CompendiumEntry;
    expect(mundane.facets).toEqual({ category: "magic", attunement: false });
    expect(mundane.imageAssetIds).toEqual(imageIds);
    expect(mundane.derivedFromId).toBe(fireball.id);
  });

  test("FR-AGENT-26 edit / share errors: bad patch, imported, unknown id, kind is immutable", async () => {
    const lantern = await dmEntry("Hb Lantern of Echoes");
    const bad = await m.call("homebrew_edit", {
      id: lantern.id,
      patch: { facets: { category: "spaceship" } },
    });
    expect(bad.json).toMatchObject({
      code: "invalid",
      issues: [{ path: ["patch", "facets", "category"] }],
    });
    expect(m.reaches).toEqual(["GET /api/compendium/entries/:id"]);
    expect((await m.call("homebrew_edit", { id: lantern.id, patch: {} })).json.code).toBe(
      "invalid",
    );
    expect(
      (await m.call("homebrew_edit", { id: lantern.id, patch: { kind: "spell" } })).json.code,
    ).toBe("invalid");
    const srd = await dmEntry("Fireball", "spell");
    const imp = await m.call("homebrew_share", { id: srd.id, shared: true });
    expect(imp.json.code).toBe("forbidden");
    expect(m.reaches).toEqual(["GET /api/compendium/entries/:id"]);
    expect((await m.call("homebrew_edit", { id: "no-such", patch: { name: "X" } })).json.code).toBe(
      "not_found",
    );
  });

  test("FR-AGENT-26 homebrew_share: player-1's search finds the entry; unshare → gone", async () => {
    const secret = await dmEntry(SECRET_ITEM);
    expect(await playerSearch("Player 1", "CMP-SECRET")).toEqual([]);
    const on = await m.call("homebrew_share", { id: secret.id, shared: true });
    expect(on.json).toEqual({ entryId: secret.id, kind: "item", name: SECRET_ITEM, shared: true });
    expect(m.reaches).toEqual([
      "GET /api/compendium/entries/:id",
      "PUT /api/compendium/entries/:id",
    ]);
    expect(await playerSearch("Player 1", "CMP-SECRET")).toEqual([SECRET_ITEM]);
    // Only `shared` changed (FR-AGENT-17).
    const shared = await dmEntry(SECRET_ITEM);
    expect({ ...shared, shared: false, updatedAt: "" }).toEqual({ ...secret, updatedAt: "" });
    await m.call("homebrew_share", { id: secret.id, shared: false });
    expect(await playerSearch("Player 1", "CMP-SECRET")).toEqual([]);
    expect(await playerSearch("Player 2", "CMP-SECRET")).toEqual([]);
  });

  test("FR-AGENT-19 plan_check of a Reddit-style item plan → ok, nothing written", async () => {
    const before = eventCount();
    const srdFireball = await dmEntry("Fireball", "spell");
    const r = await m.call("plan_check", {
      calls: [
        { tool: "compendium_search", input: { q: "lantern", kind: "item" } },
        {
          tool: "homebrew_create",
          input: {
            entry: {
              kind: "item",
              name: "Bag of Infinite Snacks",
              facets: { category: "magic", rarity: "uncommon", attunement: false },
              body: {
                typeLine: "Wondrous item",
                weight: "1 lb.",
                text: "Once per long rest, pull out a snack. Eating it as a bonus action restores 1d4 hit points.",
              },
            },
            derivedFromId: srdFireball.id,
          },
        },
        {
          tool: "homebrew_share",
          input: { id: (await dmEntry("Hb Lantern of Echoes")).id, shared: true },
        },
      ],
    });
    expect(r.json).toEqual({
      ok: true,
      issues: [],
      would: [
        "compendium_search: read only",
        'homebrew_create: item "Bag of Infinite Snacks", DM only',
        'homebrew_share: item "Hb Lantern of Echoes" → shared with players',
      ],
    });
    expect(eventCount()).toBe(before);
    expect(await playerSearch("Player 1", "Infinite Snacks")).toEqual([]);
  });

  test("FR-AGENT-19 plan_check: taken names (campaign, duplicate group, earlier in the plan), monster, bad refs", async () => {
    // A homebrew spell named as the SRD one: the search collapses both into a duplicate group.
    const srd = await dmEntry("Fireball", "spell");
    const own = await m.call("homebrew_create", {
      entry: { kind: "spell", name: "Fireball", facets: srd.facets, body: srd.body },
    });
    expect(own.isError).toBe(false);
    const ember = await dmEntry("Hb Ember Charm II");
    const before = eventCount();
    const r = await m.call("plan_check", {
      calls: [
        { tool: "homebrew_create", input: { entry: draft("MOONBLADE shard") } },
        {
          tool: "homebrew_create",
          input: {
            entry: {
              ...draft("x"),
              kind: "spell",
              name: "fireBALL",
              facets: srd.facets,
              body: srd.body,
            },
          },
        },
        { tool: "homebrew_create", input: { entry: draft("Hb Twin") } },
        { tool: "homebrew_edit", input: { id: ember.id, patch: { name: "hb twin" } } },
        {
          tool: "homebrew_create",
          input: { entry: { kind: "monster", name: "Orc", facets: {}, body: {} } },
        },
        { tool: "homebrew_create", input: { entry: draft("Hb Orphan"), derivedFromId: "no-such" } },
        { tool: "homebrew_share", input: { id: srd.id, shared: true } },
        {
          tool: "homebrew_edit",
          input: { id: ember.id, patch: { facets: { attunement: "yes" } } },
        },
        // A spell may share an item's name (FR-CMP-24: per kind).
        {
          tool: "homebrew_create",
          input: { entry: { kind: "spell", name: "Hb Twin", facets: srd.facets, body: srd.body } },
        },
      ],
    });
    expect(r.json.ok).toBe(false);
    // Call 4 also gets the monster facet issues; its kind pointer is what counts here.
    const issues = r.json.issues.filter(
      (i: { call: number; path: unknown[] }) => i.call !== 4 || i.path[2] === "kind",
    );
    expect(issues.map((i: { call: number; path: unknown[] }) => [i.call, i.path])).toEqual([
      [0, ["input", "entry", "name"]],
      [1, ["input", "entry", "name"]],
      [3, ["input", "patch", "name"]],
      [4, ["input", "entry", "kind"]],
      [5, ["input", "derivedFromId"]],
      [6, ["input", "id"]],
      [7, ["input", "patch", "facets", "attunement"]],
    ]);
    expect(r.json.issues[2].message).toBe('Name "hb twin" is already used by call 2');
    expect(eventCount()).toBe(before);
  });

  test("FR-AGENT-17 putBodyOf sends every stored field with only the change applied", () => {
    const e = {
      id: "e1",
      campaignId: "c1",
      kind: "item",
      source: null,
      sourceKey: null,
      name: "Thing",
      line: "",
      facets: { category: "gear", attunement: false },
      body: { typeLine: "Gear", text: "T" },
      definitionId: null,
      shared: true,
      derivedFromId: "base-1",
      imageAssetIds: ["AAAAAAAAAAAAAAAAAAAAAA"],
      createdAt: "x",
      updatedAt: "x",
      importedAt: null,
    } as CompendiumEntry;
    expect(putBodyOf(e, { shared: false })).toEqual({
      body: {
        entry: { kind: "item", name: "Thing", facets: e.facets, body: e.body },
        shared: false,
        derivedFromId: "base-1",
        imageAssetIds: ["AAAAAAAAAAAAAAAAAAAAAA"],
      },
    } as never);
    expect(putBodyOf(e, { patch: { derivedFromId: null } })).toMatchObject({
      body: { derivedFromId: null, imageAssetIds: ["AAAAAAAAAAAAAAAAAAAAAA"], shared: true },
    });
  });

  test("FR-CMP-14 FR-AGENT-16 unshared homebrew never reaches a player frame or search; no secret anywhere", async () => {
    // Hb Ember Charm II is shared: players find it (FR-CMP-14), still never on the WS.
    expect(await playerSearch("Player 2", "Hb Ember")).toEqual(["Hb Ember Charm II"]);
    for (const q of ["Hb Lantern", "Infinite Snacks", "CMP-SECRET", "Hb Twin"]) {
      expect(await playerSearch("Player 2", q)).toEqual([]);
    }
    // Entries never travel on the WS (CON-44): no name, shared or not, in any player frame.
    for (const p of players) {
      const raw = p.raw();
      for (const name of [
        SECRET_ITEM,
        "Hb Lantern of Echoes",
        "Hb Ember Charm",
        "Bag of Infinite Snacks",
      ]) {
        expect(raw).not.toContain(name);
      }
    }
    const all = [...outputs, ...logLines].join("\n");
    expect(outputs.length).toBeGreaterThan(20);
    expect(all).not.toContain(TEST_SECRET);
  });
});
