// AGENT §13 slice 2: the custom creature tools on a real in-process server (port 0) on the
// `agent-api` bundle, a harness-written server.lock, the MCP server on the in-memory transport,
// and live player connections for the visibility and leak checks.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadBundle } from "@fixtures/index";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { closeDb, type Db, openFileDb } from "@server/db/client";
import { asset, entity, eventLog, player } from "@server/db/schema";
import { startTestServer, type TestClient, type TestServer } from "@server/testing/harness";
import { TEST_SECRET } from "@server/testing/services";
import type { EntryResponse } from "@shared/compendium/rest";
import { ENTITY_TYPE, type EntityRecord, type MonsterRecord } from "@shared/entities/schemas";
import { recordsOf } from "@shared/protocol/store";
import { isNull } from "drizzle-orm";
import { Caller } from "./client";
import { createMcpServer } from "./server";
import { copiedFeatures, NOT_A_CREATURE, putBody } from "./tools/creature";

let h: TestServer;
let db: Db;
let bundleDir: string;
let lockDir: string;
let p1: TestClient;
let p2: TestClient;
const outputs: string[] = [];
const quietLog = { info() {}, warn() {}, error() {} };

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
    log: quietLog,
    trace: (r) => reaches.push(r),
  });
  const server = createMcpServer({ caller, log: quietLog, dmSecret: TEST_SECRET });
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
type Mcp = Awaited<ReturnType<typeof mcp>>;
let m: Mcp;

const ids: Record<string, string> = {};
let portraitId = "";
let goblinEntry: EntryResponse;
let wolfEntryId = "";

const block = (over: Record<string, unknown> = {}) => ({
  size: "medium",
  ac: 13,
  hpMax: 15,
  initBonus: 1,
  attacks: [],
  cr: "1/2",
  type: "humanoid",
  ...over,
});

const stored = (id: string) => {
  const row = db
    .select()
    .from(entity)
    .all()
    .find((e) => e.id === id);
  if (!row) throw new Error(`no entity ${id}`);
  return row;
};
const get = async (id: string) => (await m.call("creature_get", { id })).json;
const eventCount = () => db.select().from(eventLog).all().length;

beforeAll(async () => {
  const loaded = await loadBundle("agent-api", { dmSecret: TEST_SECRET, testMode: true });
  bundleDir = loaded.dir;
  db = openFileDb(loaded.config.dbPath);
  for (const e of db.select().from(entity).where(isNull(entity.campaignId)).all()) {
    ids[`imported:${e.name}`] = e.id;
  }
  for (const e of db.select().from(entity).all()) if (e.campaignId) ids[e.name] = e.id;
  portraitId = db.select({ id: asset.id }).from(asset).all()[0]?.id ?? "";
  const tokens = new Map(
    db
      .select()
      .from(player)
      .all()
      .map((p) => [p.name, p.linkToken]),
  );
  h = await startTestServer({ db });
  lockDir = mkdtempSync(path.join(os.tmpdir(), "pp-mcp-creature-"));
  writeFileSync(
    path.join(lockDir, "server.lock"),
    JSON.stringify({
      owner: "server",
      pid: process.pid,
      port: Number(new URL(h.http).port),
      startedAt: "2026-03-01T00:00:00Z",
    }),
  );
  p1 = await h.live({ role: "player", token: tokens.get("Player 1") as string });
  p2 = await h.live({ role: "player", token: tokens.get("Player 2") as string });
  m = await mcp();
  const search = await m.call("compendium_search", { q: "goblin", kind: "monster" });
  goblinEntry = (await m.call("compendium_get", { id: search.json.results[0].id })).json;
  const wolf = await m.call("compendium_search", { q: "wolf", kind: "monster" });
  wolfEntryId = wolf.json.results[0].id;
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

describe("FR-AGENT-17 bodies", () => {
  test("FR-AGENT-17 the PUT body sends every unchanged field as stored, a pet's link included", () => {
    const pet = {
      kind: "monster",
      name: "Owlbear",
      portraitAssetId: "a-1",
      tokenShape: "square",
      companionOf: "char-1",
      turnMode: "own",
      statBlock: block({ hpFormula: "7d10+21", speed: 40 }),
    } as unknown as MonsterRecord;
    expect(putBody(pet, { type: "monstrosity" })).toEqual({
      name: "Owlbear",
      portraitAssetId: "a-1",
      tokenShape: "square",
      statBlock: block({ hpFormula: "7d10+21", speed: 40, type: "monstrosity" }),
      companionOf: "char-1",
      turnMode: "own",
    });
    // null clears; an unset key keeps the stored value.
    expect(putBody(pet, { hpFormula: null, tokenShape: null })).toMatchObject({
      tokenShape: null,
      statBlock: { speed: 40, type: "humanoid" },
    });
    expect(putBody(pet, { hpFormula: null }).statBlock).not.toHaveProperty("hpFormula");
  });
});

describe("custom creature tools on a real server", () => {
  test("FR-AGENT-14 FR-AGENT-09 each creature tool reaches only its §9 route / intent", async () => {
    const goblinDef = ids["imported:Goblin"] as string;
    const cases: [string, Record<string, unknown>, string[]][] = [
      [
        "creature_create",
        { name: "Reach Plain", statBlock: block() },
        ["ws", "POST /api/entities"],
      ],
      [
        "creature_create",
        {
          name: "Reach Rows",
          statBlock: block(),
          rows: [{ list: "features", row: { name: "Pack Tactics" } }],
          notes: "Reach notes",
        },
        ["ws", "POST /api/entities", "intent char.putRow", "intent char.edit"],
      ],
      [
        "creature_derive",
        { baseId: ids["Elite Goblin Warrior"], name: "Reach Custom Base" },
        ["ws", "POST /api/entities"],
      ],
      [
        "creature_derive",
        { baseId: goblinDef, name: "Reach Imported Base" },
        ["ws", "intent sync.load", "POST /api/entities"],
      ],
      [
        "creature_derive",
        { entryId: goblinEntry.entry.id, name: "Reach Entry" },
        ["ws", "GET /api/compendium/entries/:id", "POST /api/compendium/derive-monster"],
      ],
      [
        "creature_put_row",
        {
          creatureId: ids["Elite Goblin Warrior"],
          list: "items",
          row: { name: "Rope", qty: 1 },
        },
        ["ws", "intent char.putRow"],
      ],
      [
        "creature_edit",
        { id: ids["Elite Goblin Warrior"], set: { ac: 16 } },
        ["ws", "intent char.edit"],
      ],
      [
        "creature_edit",
        { id: ids["Elite Goblin Warrior"], set: { type: "humanoid" } },
        ["ws", "PUT /api/entities/:id"],
      ],
      [
        "plan_check",
        {
          calls: [{ tool: "creature_derive", input: { entryId: wolfEntryId, name: "Plan Wolf" } }],
        },
        ["ws", "GET /api/compendium/entries/:id"],
      ],
    ];
    for (const [tool, args, want] of cases) {
      const r = await m.call(tool, args);
      expect({
        tool,
        isError: r.isError,
        error: r.isError ? r.json : null,
        reaches: m.reaches,
      }).toEqual({ tool, isError: false, error: null, reaches: want });
    }
  });

  test("FR-AGENT-20 creature_create: the creature, then each row, then the notes", async () => {
    const r = await m.call("creature_create", {
      name: "Orc Grunt",
      tokenShape: "square",
      statBlock: block({ attacks: [{ name: "Greataxe", toHit: 5, damage: "1d12+3" }] }),
      rows: [
        { list: "features", row: { name: "Aggressive", text: "Bonus action: move toward a foe." } },
        { list: "attacks", row: { name: "Javelin", toHit: 5, damage: "1d6+3" } },
        { list: "items", row: { name: "Orc tusk", qty: 2 } },
      ],
      notes: "Rider: none",
    });
    expect(r.isError).toBe(false);
    expect(r.json.campaign.name).toBeTruthy();
    expect(r.json.done.map((s: { step: string }) => s.step)).toEqual([
      "create",
      "row",
      "row",
      "row",
      "notes",
    ]);
    expect(r.json.failedAt).toBeUndefined();
    const got = await get(r.json.creature.id);
    expect(got.creature).toMatchObject({
      name: "Orc Grunt",
      tokenShape: "square",
      derivedFromId: null,
      statBlock: { attacks: [{ name: "Greataxe" }, { name: "Javelin" }] },
    });
    expect(got.sheet.features.map((f: { name: string }) => f.name)).toEqual(["Aggressive"]);
    expect(got.sheet.items).toEqual([expect.objectContaining({ name: "Orc tusk", qty: 2 })]);
    expect(got.sheet.notes).toBe("Rider: none");
  });

  test("FR-AGENT-21 derive from a custom base: its full stat block + set, art and shape; server copies no sheet", async () => {
    const base = stored(ids["Elite Goblin Warrior"] as string);
    const r = await m.call("creature_derive", {
      baseId: base.id,
      name: "Orc Spear Runner",
      set: { speed: 40, hpFormula: "3d8+3" },
      notes: "Fast.",
    });
    expect(r.json.done.map((s: { step: string }) => s.step)).toEqual(["create", "notes"]);
    const got = await get(r.json.creature.id);
    expect(got.creature).toMatchObject({
      derivedFromId: base.id,
      portraitAssetId: base.portraitAssetId,
      tokenShape: base.tokenShape,
      statBlock: { ...(base.statBlock as object), speed: 40, hpFormula: "3d8+3" },
    });
    // The base's NPC sheet (features, NPC-NOTE-9) is not copied (FR-ENT-09): only our notes.
    expect(got.sheet).toMatchObject({ notes: "Fast.", features: [] });
  });

  test("FR-AGENT-21 derive from a compendium entry: definition stat block + set, text copied as features", async () => {
    const r = await m.call("creature_derive", {
      entryId: goblinEntry.entry.id,
      name: "Goblin Boss Variant",
      set: { ac: 17, type: "humanoid" },
      rows: [{ list: "features", row: { name: "Redirect Attack" } }],
    });
    expect(r.isError).toBe(false);
    const got = await get(r.json.creature.id);
    const def = goblinEntry.definition as NonNullable<EntryResponse["definition"]>;
    expect(got.creature).toMatchObject({
      derivedFromId: def.id,
      statBlock: { ...def.statBlock, ac: 17, type: "humanoid" },
    });
    const copied = copiedFeatures(goblinEntry, def.statBlock.attacks);
    expect(copied).toBeGreaterThan(0);
    expect(got.sheet.features).toHaveLength(copied + 1);
    expect(got.sheet.features.at(-1).name).toBe("Redirect Attack");
  });

  test("FR-AGENT-21 exactly one of baseId / entryId; nothing reached otherwise", async () => {
    for (const args of [
      { name: "Nope" },
      { name: "Nope", baseId: ids["Elite Goblin Warrior"], entryId: goblinEntry.entry.id },
    ]) {
      const r = await m.call("creature_derive", args);
      expect(r.json).toMatchObject({ code: "invalid", issues: [{ path: ["baseId"] }] });
      expect(m.reaches).toEqual([]);
    }
    const missing = await m.call("creature_derive", { baseId: "no-such", name: "Nope" });
    expect(missing.json.code).toBe("not_found");
    expect(m.reaches).toEqual(["ws", "intent sync.load"]);
  });

  test("FR-AGENT-22 creature_edit: char.edit keys, then type / hpFormula / tokenShape by PUT from the edited record", async () => {
    const id = ids["Elite Goblin Warrior"] as string;
    const before = stored(id);
    const r = await m.call("creature_edit", {
      id,
      set: {
        ac: 18,
        speed: 35,
        notes: "Edited",
        type: "fey",
        hpFormula: "4d6",
        tokenShape: "none",
      },
    });
    expect(r.json.done.map((s: { step: string }) => s.step)).toEqual([
      "char.edit",
      "PUT /api/entities/:id",
    ]);
    expect(m.reaches).toEqual(["ws", "intent char.edit", "PUT /api/entities/:id"]);
    const got = await get(id);
    // The PUT kept char.edit's changes (it read the record after the edit's events).
    expect(got.creature).toMatchObject({
      name: before.name,
      tokenShape: "none",
      statBlock: { ac: 18, speed: 35, type: "fey", hpFormula: "4d6" },
    });
    expect(got.sheet.notes).toBe("Edited");
  });

  test("FR-AGENT-22 FR-AGENT-17 Pet: creature_edit {type} on Mira's Owlbear keeps companionOf, turnMode, tokenShape, portrait", async () => {
    const id = ids.Owlbear as string;
    expect(portraitId).not.toBe("");
    const setup = await m.call("creature_edit", {
      id,
      set: { portraitAssetId: portraitId, tokenShape: "square" },
    });
    expect(setup.isError).toBe(false);
    const before = stored(id);
    expect(before).toMatchObject({ portraitAssetId: portraitId, tokenShape: "square" });
    const r = await m.call("creature_edit", { id, set: { type: "monstrosity" } });
    expect(r.json.done).toEqual([{ step: "PUT /api/entities/:id", keys: ["type"] }]);
    const after = stored(id);
    expect(after).toMatchObject({
      companionOf: ids.Mira,
      turnMode: before.turnMode,
      tokenShape: "square",
      portraitAssetId: portraitId,
      hpCurrent: before.hpCurrent,
      ownerPlayerId: before.ownerPlayerId,
      statBlock: { ...(before.statBlock as object), type: "monstrosity" },
    });
  });

  test("FR-AGENT-23 creature_put_row adds without an id, replaces with one", async () => {
    const id = ids["Elite Goblin Warrior"] as string;
    const add = await m.call("creature_put_row", {
      creatureId: id,
      list: "features",
      row: { name: "Nimble Escape", text: "Disengage or Hide as a bonus action." },
    });
    const rowId: string = add.json.rowId;
    expect(typeof rowId).toBe("string");
    expect(add.json).toMatchObject({ creatureId: id, list: "features" });
    const put = await m.call("creature_put_row", {
      creatureId: id,
      list: "features",
      row: { id: rowId, name: "Nimble Escape", text: "Edited." },
    });
    expect(put.json.rowId).toBe(rowId);
    const rows = (await get(id)).sheet.features.filter((f: { id: string }) => f.id === rowId);
    expect(rows).toEqual([expect.objectContaining({ text: "Edited." })]);
  });

  test("FR-AGENT-24 a character → invalid before any intent; imported → the server's forbidden", async () => {
    for (const [tool, args] of [
      ["creature_edit", { id: ids.Mira, set: { ac: 12 } }],
      ["creature_edit", { id: ids.Mira, set: { type: "beast" } }],
      ["creature_put_row", { creatureId: ids.Mira, list: "items", row: { name: "Rope" } }],
      ["creature_derive", { baseId: ids.Mira, name: "Mira Clone" }],
    ] as const) {
      const r = await m.call(tool, args);
      expect(r.json).toEqual({ code: "invalid", message: NOT_A_CREATURE });
      expect(m.reaches).toEqual(["ws"]);
    }
    const goblin = ids["imported:Goblin"] as string;
    const viaEdit = await m.call("creature_edit", { id: goblin, set: { ac: 9 } });
    expect(viaEdit.json.code).toBe("forbidden");
    expect(m.reaches).toEqual(["ws", "intent char.edit"]);
    const viaPut = await m.call("creature_edit", { id: goblin, set: { type: "fey" } });
    expect(viaPut.json.code).toBe("forbidden");
    expect(m.reaches).toEqual(["ws", "intent sync.load", "PUT /api/entities/:id"]);
    const viaRow = await m.call("creature_put_row", {
      creatureId: goblin,
      list: "items",
      row: { name: "Rope" },
    });
    expect(viaRow.json.code).toBe("forbidden");
    expect(stored(goblin).statBlock).not.toMatchObject({ type: "fey" });
  });

  test("FR-AGENT-18 multi-step: a first-step failure is the tool error; a later one returns done / failedAt / error", async () => {
    const taken = await m.call("creature_create", {
      name: "elite goblin warrior",
      statBlock: block(),
    });
    expect(taken.json.code).toBe("conflict");
    expect(m.reaches).toEqual(["ws", "POST /api/entities"]);
    const rows = Array.from({ length: 31 }, (_, i) => ({
      list: "features",
      row: { name: `Trait ${i}` },
    }));
    const r = await m.call("creature_create", {
      name: "Overfull Orc",
      statBlock: block(),
      rows,
      notes: "never written",
    });
    expect(r.json.done).toHaveLength(31);
    expect(r.json.failedAt).toEqual({ step: "row", index: 30, list: "features", name: "Trait 30" });
    expect(r.json.error).toMatchObject({ code: "conflict" });
    const got = await get(r.json.creature.id);
    expect(got.sheet.features).toHaveLength(30);
    expect(got.sheet.notes).toBe("");
  });

  test("FR-AGENT-16 Live: a creature edit reaches player-1 in full for the Owlbear; a monster never reaches a player", async () => {
    const owl = ids.Owlbear as string;
    const n1 = p1.frames.length;
    const n2 = p2.frames.length;
    await m.call("creature_edit", { id: owl, set: { ac: 15, type: "beast" } });
    await m.call("creature_edit", { id: ids["Elite Goblin Warrior"], set: { ac: 19 } });
    await m.call("creature_derive", {
      baseId: ids["Elite Goblin Warrior"],
      name: "Live Orc Shield",
    });
    // The owner's copy arrived first, so "nothing else arrived" isn't just "not yet".
    await Bun.sleep(100);
    const pet = recordsOf<EntityRecord>(p1.store, ENTITY_TYPE).find((e) => e.id === owl);
    expect(pet).toMatchObject({ companionOf: ids.Mira, statBlock: { ac: 15, type: "beast" } });
    const after1 = JSON.stringify(p1.frames.slice(n1));
    const after2 = JSON.stringify(p2.frames.slice(n2));
    expect(after1).toContain('"ac":15');
    for (const text of [after1, after2]) {
      expect(text).not.toContain("Live Orc Shield");
      expect(text).not.toContain(ids["Elite Goblin Warrior"]);
    }
    // player-2 is not the owner: at most the redacted band, never the stats.
    const other = recordsOf<Record<string, unknown>>(p2.store, ENTITY_TYPE).find(
      (e) => e.id === owl,
    );
    expect(other?.statBlock).toBeUndefined();
    expect(after2).not.toContain('"ac":15');
  });

  test("FR-AGENT-19 plan_check: 3 orc variants + a mount → ok, no write", async () => {
    const before = eventCount();
    const elite = ids["Elite Goblin Warrior"];
    const plan = {
      calls: [
        { tool: "creatures_list", input: { q: "orc" } },
        {
          tool: "creature_derive",
          input: {
            baseId: elite,
            name: "Orc Shield and Mace",
            set: { ac: 21 },
            rows: [{ list: "attacks", row: { name: "Mace", toHit: 4, damage: "1d6+2" } }],
          },
        },
        {
          tool: "creature_derive",
          input: {
            baseId: elite,
            name: "Orc Spear Sprinter",
            set: { speed: 40 },
            rows: [{ list: "attacks", row: { name: "Spear", toHit: 4, damage: "1d6+2" } }],
          },
        },
        {
          tool: "creature_derive",
          input: { baseId: elite, name: "Orc Wolf Rider", notes: "Mount: Orc Wolf Rider's Wolf" },
        },
        {
          tool: "creature_derive",
          input: {
            entryId: wolfEntryId,
            name: "Orc Wolf Rider's Wolf",
            notes: "Rider: Orc Wolf Rider",
          },
        },
      ],
    };
    const r = await m.call("plan_check", plan);
    expect(r.json).toMatchObject({ ok: true, issues: [] });
    expect(r.json.would).toEqual([
      "creatures_list: read only",
      'creature_derive: new custom creature "Orc Shield and Mace" from Elite Goblin Warrior, set ac (+1 row)',
      'creature_derive: new custom creature "Orc Spear Sprinter" from Elite Goblin Warrior, set speed (+1 row)',
      'creature_derive: new custom creature "Orc Wolf Rider" from Elite Goblin Warrior (notes)',
      `creature_derive: new custom creature "Orc Wolf Rider's Wolf" from Wolf (notes)`,
    ]);
    expect(eventCount()).toBe(before);
    expect((await m.call("creatures_list", { q: "orc wolf" })).json.creatures).toEqual([]);

    // The same plan with two equal names → exactly one issue.
    const dup = structuredClone(plan);
    (dup.calls[3]?.input as { name: string }).name = "orc spear SPRINTER";
    const bad = await m.call("plan_check", dup);
    expect(bad.json.ok).toBe(false);
    expect(bad.json.issues).toEqual([
      {
        call: 3,
        path: ["input", "name"],
        message: 'Name "orc spear SPRINTER" is already used by call 2',
      },
    ]);
    expect(eventCount()).toBe(before);
  });

  test("FR-AGENT-19 plan_check per-tool checks: names, rows incl. copied ones, kinds, bodies", async () => {
    const elite = ids["Elite Goblin Warrior"] as string;
    const feats = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ list: "features", row: { name: `F${i}` } }));
    const copied = copiedFeatures(
      goblinEntry,
      (goblinEntry.definition as NonNullable<EntryResponse["definition"]>).statBlock.attacks,
    );
    const r = await m.call("plan_check", {
      calls: [
        { tool: "creature_create", input: { name: "Orc Grunt", statBlock: block() } },
        {
          tool: "creature_create",
          input: { name: "Big Sheet", statBlock: block(), rows: feats(31) },
        },
        {
          tool: "creature_derive",
          input: { entryId: goblinEntry.entry.id, name: "Copied Over", rows: feats(31 - copied) },
        },
        {
          tool: "creature_derive",
          input: { baseId: elite, name: "Bad Set", set: { hpFormula: null, ac: 31 } },
        },
        { tool: "creature_edit", input: { id: ids.Mira, set: { ac: 12 } } },
        { tool: "creature_edit", input: { id: elite, set: { level: 3, name: "Orc Grunt" } } },
        { tool: "creature_edit", input: { id: elite, set: { name: "ELITE goblin warrior" } } },
        {
          tool: "creature_put_row",
          input: { creatureId: ids["imported:Goblin"], list: "items", row: { name: "Rope" } },
        },
        {
          tool: "creature_put_row",
          input: { creatureId: elite, list: "items", row: { id: "no-row", name: "Rope" } },
        },
        { tool: "creature_derive", input: { entryId: "no-entry", name: "Lost" } },
        {
          tool: "creature_derive",
          input: { baseId: elite, name: "No Scores", set: { abilities: null } },
        },
      ],
    });
    expect(r.json.ok).toBe(false);
    expect(r.json.issues.map((i: { call: number; path: unknown[] }) => [i.call, i.path])).toEqual([
      [0, ["input", "name"]],
      [1, ["input", "rows"]],
      [2, ["input", "rows"]],
      [3, ["input", "set", "ac"]],
      [4, ["input", "id"]],
      [5, ["input", "set", "level"]],
      [5, ["input", "set", "name"]],
      [7, ["input", "creatureId"]],
      [8, ["input", "row", "id"]],
      [9, ["input", "entryId"]],
      // The route's own body check: the base's saves and skills need ability scores.
      [10, ["input", "statBlock", "saveProficiencies"]],
      [10, ["input", "statBlock", "skills"]],
    ]);
    // A creature's own name (any case) is not "taken" by itself.
    expect(r.json.issues.some((i: { call: number }) => i.call === 6)).toBe(false);
    expect(r.json.issues[4].message).toBe(NOT_A_CREATURE);
    expect(r.json.issues[1].message).toBe("Too many features: 30 max (has 0, the plan adds 31)");
  });

  test("FR-AGENT-03 leak scan: no player frame holds a derived name, a custom creature or the secret", () => {
    const names = [
      "Orc Grunt",
      "Orc Spear Runner",
      "Goblin Boss Variant",
      "Reach Custom Base",
      "Reach Entry",
      "Live Orc Shield",
      "Overfull Orc",
      "Elite Goblin Warrior",
      "NPC-NOTE-9",
      "CMP-SECRET-ITEM",
    ];
    for (const c of [p1, p2]) {
      const raw = c.raw();
      for (const n of names) expect(raw).not.toContain(n);
      expect(raw).not.toContain(TEST_SECRET);
    }
    expect(outputs.join("\n")).not.toContain(TEST_SECRET);
  });
});
