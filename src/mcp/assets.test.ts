// AGENT §13 slice 7 (images): a real in-process server (port 0) on the `agent-api` bundle, a
// harness-written server.lock, the MCP server on the SDK in-memory transport, live player sockets.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadBundle } from "@fixtures/index";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { closeDb, type Db, openFileDb } from "@server/db/client";
import { asset, eventLog, player } from "@server/db/schema";
import { testPng } from "@server/features/assets-pipeline/testing";
import { startTestServer, type TestClient, type TestServer } from "@server/testing/harness";
import { TEST_SECRET } from "@server/testing/services";
import { eq } from "drizzle-orm";
import { Caller } from "./client";
import { createMcpServer } from "./server";
import { listedByDefault, UPLOAD_FILE_MAX } from "./tools/assets";

let h: TestServer;
let db: Db;
let bundleDir: string;
let lockDir: string;
let filesDir: string;
const outputs: string[] = [];
const log = { info: () => {}, warn: () => {}, error: () => {} };
const players: TestClient[] = [];

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

const file = (name: string, bytes: Uint8Array | string) => {
  const p = path.join(filesDir, name);
  writeFileSync(p, bytes);
  return p;
};
const dir = (name: string) => {
  const p = path.join(filesDir, name);
  mkdirSync(p, { recursive: true });
  return p;
};
const svg = (attrs: string, fill: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}><circle cx="50%" cy="50%" r="40%" fill="${fill}"/></svg>`;
const eventCount = () => db.select().from(eventLog).all().length;
const row = (id: string) => db.select().from(asset).where(eq(asset.id, id)).get();

beforeAll(async () => {
  const loaded = await loadBundle("agent-api", { dmSecret: TEST_SECRET, testMode: true });
  bundleDir = loaded.dir;
  db = openFileDb(loaded.config.dbPath);
  const tokens = db.select().from(player).all();
  h = await startTestServer({ db });
  lockDir = mkdtempSync(path.join(os.tmpdir(), "pp-mcp-lock-"));
  filesDir = mkdtempSync(path.join(os.tmpdir(), "pp-mcp-files-"));
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
  for (const p of tokens) players.push(await h.live({ role: "player", token: p.linkToken }));
  m = await mcp();
});

afterAll(async () => {
  await m.close();
  await h.stop();
  closeDb(db);
  for (const d of [bundleDir, lockDir, filesDir]) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // Windows may hold the WAL briefly; a leftover temp dir is harmless.
    }
  }
});

describe("agent-api image tools on a real server", () => {
  let itemImageId = "";

  test("FR-AGENT-42 FR-AGENT-43 FR-AGENT-45 a PNG file for an item → an attachment tagged Items; again → existing, same id", async () => {
    const p = file("Ember Charm.png", await testPng(7));
    const r = await m.call("asset_upload", { path: p, context: "compendium-item" });
    expect(r.isError).toBe(false);
    expect(r.json).toEqual({
      assetId: expect.any(String),
      name: "Ember Charm",
      outcome: "created",
      width: 64,
      height: 48,
      tags: ["Items"],
    });
    expect(m.reaches).toEqual(["POST /api/assets"]);
    itemImageId = r.json.assetId;
    expect(row(itemImageId)?.listed).toBe(false);

    const again = await m.call("asset_upload", { path: p, context: "compendium-item" });
    expect(again.json).toMatchObject({ assetId: itemImageId, outcome: "existing" });
  });

  test("FR-AGENT-46 an attachment isn't in assets_list; its display file is served", async () => {
    const list = await m.call("assets_list", { tag: "items" });
    expect(list.json.assets.map((a: { id: string }) => a.id)).not.toContain(itemImageId);
    const res = await fetch(`${h.http}/api/assets/${itemImageId}/display`);
    expect(res.status).toBe(200);
  });

  test("FR-AGENT-44 FR-AGENT-45 SVG text as a portrait → listed, tagged Portraits, in assets_list", async () => {
    const r = await m.call("asset_upload", {
      svg: svg('width="128" height="128"', "#a33"),
      name: "Ruby Sigil",
      context: "portrait",
    });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({
      name: "Ruby Sigil",
      outcome: "created",
      width: 128,
      height: 128,
      tags: ["Portraits"],
    });
    expect(row(r.json.assetId)?.listed).toBe(true);
    const list = await m.call("assets_list", { q: "ruby", tag: "PORTRAITS" });
    expect(list.json.assets).toEqual([
      {
        id: r.json.assetId,
        name: "Ruby Sigil",
        tags: ["Portraits"],
        width: 128,
        height: 128,
        createdAt: expect.any(String),
      },
    ]);
    expect(list.json.nextCursor).toBeNull();
  });

  test("FR-AGENT-45 listed overrides the context default; no context → listed, no tag", async () => {
    expect(listedByDefault(undefined)).toBe(true);
    expect(listedByDefault("compendium")).toBe(false);
    const r = await m.call("asset_upload", {
      svg: svg('viewBox="0 0 64 64"', "#3a3"),
      name: "Green Mark",
      context: "compendium-item",
      listed: true,
    });
    expect(r.json.tags).toEqual(["Items"]);
    expect(row(r.json.assetId)?.listed).toBe(true);
    const plain = await m.call("asset_upload", {
      svg: svg('width="32" height="32"', "#33a"),
      name: "Blue Mark",
    });
    expect(plain.json.tags).toEqual([]);
    expect(row(plain.json.assetId)?.listed).toBe(true);
  });

  test("FR-AGENT-47 the id goes into homebrew_create imageAssetIds", async () => {
    const r = await m.call("homebrew_create", {
      entry: {
        kind: "item",
        name: "Img Ember Charm",
        facets: { category: "magic", rarity: "uncommon", attunement: false },
        body: { typeLine: "Wondrous item", text: "Warm to the touch." },
      },
      imageAssetIds: [itemImageId],
    });
    expect(r.isError).toBe(false);
    const got = await m.call("compendium_get", { id: r.json.entryId });
    expect(got.json.entry.imageAssetIds).toEqual([itemImageId]);
  });

  test("FR-AGENT-43 FR-AGENT-44 local refusals: invalid, nothing sent", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{}, "Give exactly one of path or svg"],
      [{ path: file("a.png", "x"), svg: "<svg/>", name: "x" }, "Give exactly one of path or svg"],
      [{ path: "relative/a.png" }, "Use an absolute path"],
      [{ path: file("notes.txt", "hello") }, "Not an image file: .png, .jpg, .jpeg, .webp or .svg"],
      [{ path: path.join(filesDir, "missing.png") }, "No file at"],
      [{ path: dir("dir.png") }, "Not a file"],
      [{ path: file("empty.png", "") }, "The file is empty"],
      [{ svg: "<div>no</div>", name: "x" }, "Not SVG text (no <svg> element)"],
      [{ svg: svg('width="9" height="9"', "#000") }, "Name the SVG image"],
    ];
    for (const [input, message] of cases) {
      const r = await m.call("asset_upload", input);
      expect({ input, code: r.json.code }).toEqual({ input, code: "invalid" });
      expect(JSON.stringify(r.json)).toContain(message);
      expect(m.reaches).toEqual([]);
    }
  });

  test("FR-AGENT-43 a file over 25 MB → invalid before anything is read or sent", async () => {
    const big = file("huge.png", new Uint8Array(UPLOAD_FILE_MAX + 1));
    const r = await m.call("asset_upload", { path: big });
    expect(r.json).toMatchObject({ code: "invalid", message: "File over 25 MB" });
    expect(m.reaches).toEqual([]);
  });

  test("FR-AGENT-48 server refusals: text in a .png → 415, an SVG with no size → 422, both invalid", async () => {
    const before = db.select().from(asset).all().length;
    const fake = await m.call("asset_upload", { path: file("fake.png", "not an image at all") });
    expect(fake.json.code).toBe("invalid");
    expect(m.reaches).toEqual(["POST /api/assets"]);
    const nosize = await m.call("asset_upload", {
      svg: '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
      name: "No Size",
    });
    expect(nosize.json).toMatchObject({
      code: "invalid",
      message: "SVG needs width and height or a viewBox",
    });
    expect(db.select().from(asset).all().length).toBe(before);
  });

  test("FR-AGENT-47 FR-AGENT-19 plan_check on uploads writes nothing; a missing file is an issue", async () => {
    const before = eventCount();
    const r = await m.call("plan_check", {
      calls: [
        {
          tool: "asset_upload",
          input: { path: file("Plan Shield.png", await testPng(9)), context: "compendium-item" },
        },
        { tool: "asset_upload", input: { path: path.join(filesDir, "gone.png") } },
        {
          tool: "asset_upload",
          input: { svg: svg('width="8" height="8"', "#999"), name: "Dot", context: "portrait" },
        },
      ],
    });
    expect(r.json.ok).toBe(false);
    expect(r.json.issues).toEqual([
      {
        call: 1,
        path: ["input", "path"],
        message: `No file at ${path.join(filesDir, "gone.png")}`,
      },
    ]);
    expect(r.json.would).toEqual([
      'asset_upload: "Plan Shield.png" (attachment, Items)',
      'asset_upload: "gone.png" (in the library)',
      'asset_upload: "Dot" (in the library, Portraits)',
    ]);
    expect(eventCount()).toBe(before);
  });

  test("FR-ASSET-24 FR-AGENT-03 leak scan: no player frame holds the attachment id; no secret in any output", async () => {
    await Bun.sleep(50);
    for (const p of players) expect(p.raw()).not.toContain(itemImageId);
    for (const o of outputs) expect(o).not.toContain(TEST_SECRET);
  });
});
