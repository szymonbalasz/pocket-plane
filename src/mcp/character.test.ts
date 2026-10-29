// AGENT §13 slice 4 (characters): a real in-process server (port 0) on the `agent-api` bundle, a
// harness-written server.lock, the MCP server on the SDK in-memory transport, live player sockets
// (Live + leak scan) and a DM socket that locks Mira's sheet and makes a draft (FR-CHARX-12).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadBundle } from "@fixtures/index";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { closeDb, type Db, openFileDb } from "@server/db/client";
import { entity, eventLog, player } from "@server/db/schema";
import { startTestServer, type TestClient, type TestServer } from "@server/testing/harness";
import { TEST_SECRET } from "@server/testing/services";
import {
  CREATURE_SHEET_TYPE,
  type CreatureSheetRecord,
  ROW_LIMITS,
} from "@shared/character-sheet/sheet";
import { ENTITY_TYPE, REDACTED_CHARACTER_KEYS } from "@shared/entities/schemas";
import { recordsOf } from "@shared/protocol/store";
import { eq } from "drizzle-orm";
import { Caller } from "./client";
import { createMcpServer } from "./server";
import { CLASS_ROWS, NO_CR, NOT_A_CHARACTER, OWNER_FIXED } from "./tools/character";

const NOTE = "MIRA-AGENT-NOTE-41";
const NECKLACE = "Orc-tooth necklace";
const DM = { role: "dm" as const, secret: TEST_SECRET };

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
let p1: TestClient;
let p2: TestClient;
let dm: TestClient;
const tokens: Record<string, string> = {};
const playerIds: Record<string, string> = {};
let mira: string;
let elite: string;

/** Ack / reject of one intent; other frames are left for the store. */
async function answer(c: TestClient, intentId: string) {
  for (;;) {
    const f = await c.next(undefined, 1500);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
}

/** Polls until `pred` holds (≤ `ms`). */
async function until(pred: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await Bun.sleep(20);
  }
}

const sheetIn = (c: TestClient, id: string) =>
  recordsOf<CreatureSheetRecord>(c.store, CREATURE_SHEET_TYPE).find((s) => s.id === id);
const entityIn = (c: TestClient, id: string) =>
  recordsOf<Record<string, unknown>>(c.store, ENTITY_TYPE).find((e) => e.id === id);
const eventCount = () => db.select().from(eventLog).all().length;
const ownerOf = (id: string) =>
  db.select({ o: entity.ownerPlayerId }).from(entity).where(eq(entity.id, id)).get()?.o;

beforeAll(async () => {
  const loaded = await loadBundle("agent-api", { dmSecret: TEST_SECRET, testMode: true });
  bundleDir = loaded.dir;
  db = openFileDb(loaded.config.dbPath);
  for (const p of db.select().from(player).all()) {
    tokens[p.name] = p.linkToken;
    playerIds[p.name] = p.id;
  }
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
  p1 = await h.live({ role: "player", token: tokens["Player 1"] as string });
  p2 = await h.live({ role: "player", token: tokens["Player 2"] as string });
  dm = await h.live(DM);
  m = await mcp();
  mira = (await m.call("characters_list", { q: "Mira" })).json.characters[0].id;
  elite = (await m.call("creatures_list", { q: "Elite Goblin Warrior" })).json.creatures[0].id;
});

afterAll(async () => {
  await m.close();
  for (const c of [p1, p2, dm]) c.close();
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

const necklace = { name: NECKLACE, qty: 1, equipped: false, notes: "" };

describe("agent-api character tools on a real server", () => {
  test("FR-AGENT-28 FR-AGENT-16 character_put_row reaches only char.putRow; Live: player-1 gets the row, player-2 nothing", async () => {
    const n2 = p2.frames.length;
    const r = await m.call("character_put_row", {
      creatureId: mira,
      list: "items",
      row: necklace,
    });
    expect(r.isError).toBe(false);
    expect(r.json).toEqual({
      campaign: { id: expect.any(String), name: expect.any(String) },
      creatureId: mira,
      list: "items",
      rowId: expect.any(String),
    });
    expect(m.reaches).toEqual(["ws", "intent char.putRow"]);
    // The owner's sheet upsert, live, no reload.
    await until(() => (sheetIn(p1, mira)?.items ?? []).some((i) => i.name === NECKLACE));
    expect(sheetIn(p1, mira)?.items.find((i) => i.name === NECKLACE)?.id).toBe(r.json.rowId);
    await until(() => (sheetIn(dm, mira)?.items ?? []).some((i) => i.id === r.json.rowId));
    await Bun.sleep(100);
    expect(JSON.stringify(p2.frames.slice(n2))).not.toContain(NECKLACE);
    expect(sheetIn(p2, mira)).toBeUndefined();

    // With the row's id: replaces that row, no new one.
    const again = await m.call("character_put_row", {
      creatureId: mira,
      list: "items",
      row: { ...necklace, id: r.json.rowId, qty: 2 },
    });
    expect(again.json.rowId).toBe(r.json.rowId);
    await until(() => sheetIn(p1, mira)?.items.find((i) => i.id === r.json.rowId)?.qty === 2);
    expect(sheetIn(p1, mira)?.items.filter((i) => i.name === NECKLACE)).toHaveLength(1);
  });

  test("FR-AGENT-27 FR-AGENT-16 character_edit reaches only char.edit; owner full, player-2 the whitelist only", async () => {
    const n2 = p2.frames.length;
    const r = await m.call("character_edit", {
      id: mira,
      set: { notes: NOTE, ac: 17, species: "Half-orc", level: 2 },
    });
    expect(r.isError).toBe(false);
    expect(r.json).toEqual({
      campaign: { id: expect.any(String), name: expect.any(String) },
      character: { id: mira, name: "Mira" },
      changed: expect.any(Array),
    });
    expect(r.json.changed.sort()).toEqual(["ac", "level", "notes", "species"]);
    expect(m.reaches).toEqual(["ws", "intent char.edit"]);
    await until(() => sheetIn(p1, mira)?.notes === NOTE);
    expect(entityIn(p1, mira)).toMatchObject({ statBlock: { ac: 17, level: 2 } });
    // player-2: the summary keys change live, nothing else.
    await until(() => entityIn(p2, mira)?.species === "Half-orc");
    expect(Object.keys(entityIn(p2, mira) ?? {}).sort()).toEqual(
      [...REDACTED_CHARACTER_KEYS].sort(),
    );
    expect(entityIn(p2, mira)).toMatchObject({ level: 2, className: "Fighter" });
    const after2 = JSON.stringify(p2.frames.slice(n2));
    expect(after2).not.toContain(NOTE);
    expect(after2).not.toContain("statBlock");
  });

  test("FR-AGENT-27 FR-AGENT-14 ownerPlayerId is refused before anything is sent; the owner stays", async () => {
    const r = await m.call("character_edit", {
      id: mira,
      set: { ownerPlayerId: playerIds["Player 2"], ac: 12 },
    });
    expect(r.isError).toBe(true);
    expect(r.json).toEqual({
      code: "invalid",
      message: "Invalid input",
      issues: [{ path: ["set"], message: OWNER_FIXED }],
    });
    expect(m.reaches).toEqual([]);
    expect(ownerOf(mira)).toBe(playerIds["Player 1"]);
    expect((await m.call("character_edit", { id: mira, set: {} })).json.code).toBe("invalid");
  });

  test("FR-AGENT-27 FR-AGENT-28 a monster → invalid Not a character, no intent; unknown id → not_found", async () => {
    const before = eventCount();
    const edit = await m.call("character_edit", { id: elite, set: { ac: 3 } });
    expect(edit.json).toEqual({ code: "invalid", message: NOT_A_CHARACTER });
    expect(m.reaches).toEqual(["ws"]);
    const row = await m.call("character_put_row", {
      creatureId: elite,
      list: "items",
      row: necklace,
    });
    expect(row.json).toEqual({ code: "invalid", message: NOT_A_CHARACTER });
    expect(m.reaches).toEqual(["ws"]);
    expect(eventCount()).toBe(before);
    const none = await m.call("character_put_row", {
      creatureId: "no-such",
      list: "items",
      row: necklace,
    });
    expect(none.json.code).toBe("not_found");
    // A row that doesn't fit its list: the intent's own zod, nothing sent.
    const bad = await m.call("character_put_row", {
      creatureId: mira,
      list: "items",
      row: { name: "Spear", toHit: 4 },
    });
    expect(bad.json).toMatchObject({ code: "invalid", issues: [{ path: ["row"] }] });
    expect(m.reaches).toEqual([]);
  });

  test("FR-AGENT-27 FR-CHARX-12 DM authority: a locked sheet and a draft both take the agent's edits", async () => {
    expect(
      (await answer(dm, dm.intent("char.setLock", { characterId: mira, locked: true }))).type,
    ).toBe("ack");
    // The lock is real: the owner's own edit is refused.
    expect(
      await answer(p1, p1.intent("char.edit", { creatureId: mira, set: { notes: "x" } })),
    ).toMatchObject({ type: "reject", code: "forbidden" });
    const edit = await m.call("character_edit", { id: mira, set: { background: "Soldier" } });
    expect(edit.isError).toBe(false);
    const row = await m.call("character_put_row", {
      creatureId: mira,
      list: "features",
      row: { name: "Second Wind", text: "Regain 1d10 + level HP." },
    });
    expect(row.isError).toBe(false);
    await until(() => (sheetIn(p1, mira)?.features ?? []).some((f) => f.name === "Second Wind"));
    expect(sheetIn(p1, mira)).toMatchObject({ locked: true, background: "Soldier" });
    expect(
      (await answer(dm, dm.intent("char.setLock", { characterId: mira, locked: false }))).type,
    ).toBe("ack");

    const created = await answer(
      dm,
      dm.intent("char.create", {
        name: "Agent Draft",
        ownerPlayerId: playerIds["Player 2"],
        draft: true,
      }),
    );
    expect(created.type).toBe("ack");
    const draftId = (created as { result: { characterId: string } }).result.characterId;
    const d = await m.call("character_edit", { id: draftId, set: { hpMax: 9 } });
    expect(d.isError).toBe(false);
    const dr = await m.call("character_put_row", {
      creatureId: draftId,
      list: "items",
      row: { name: "Draft rope" },
    });
    expect(dr.isError).toBe(false);
    await until(() => (sheetIn(p2, draftId)?.items ?? []).some((i) => i.name === "Draft rope"));
    expect(sheetIn(p2, draftId)?.status).toBe("draft");
  });

  test("FR-AGENT-19 plan_check: character targets, row limits incl. planned rows, cr, names, class rows; no write", async () => {
    const before = eventCount();
    const block = entityIn(dm, mira)?.statBlock as { attacks: unknown[] } | undefined;
    const attacks = block?.attacks.length ?? 0;
    const room = ROW_LIMITS.attacks - attacks;
    const attack = (i: number) => ({
      tool: "character_put_row",
      input: {
        creatureId: mira,
        list: "attacks",
        row: { name: `Jab ${i}`, toHit: 3, damage: "1d4", damageType: "piercing" },
      },
    });
    const calls = [
      ...Array.from({ length: room + 1 }, (_, i) => attack(i)),
      { tool: "character_put_row", input: { creatureId: elite, list: "items", row: necklace } },
      { tool: "character_edit", input: { id: mira, set: { cr: "1" } } },
      { tool: "character_edit", input: { id: mira, set: { name: "agent DRAFT" } } },
      {
        tool: "character_edit",
        input: {
          id: mira,
          set: { classes: [{ name: "Fighter", level: 2, hitDie: "d10" }], level: 3 },
        },
      },
      {
        tool: "character_put_row",
        input: { creatureId: mira, list: "items", row: { ...necklace, id: "no-such-row" } },
      },
      { tool: "character_edit", input: { id: mira, set: { ownerPlayerId: "p" } } },
      { tool: "character_edit", input: { id: mira, set: { name: "Mira the Bold" } } },
    ];
    const r = await m.call("plan_check", { calls });
    expect(r.json.ok).toBe(false);
    const at = (i: number) => room + 1 + i;
    expect(r.json.issues.map((i: { call: number; path: unknown[] }) => [i.call, i.path])).toEqual([
      [room, ["input", "row"]],
      [at(0), ["input", "creatureId"]],
      [at(1), ["input", "set", "cr"]],
      [at(2), ["input", "set", "name"]],
      [at(3), ["input", "set", "level"]],
      [at(4), ["input", "row", "id"]],
      [at(5), ["input", "set"]],
      [at(5), ["input", "set"]],
    ]);
    const msg = (i: number) => r.json.issues[i].message;
    expect(msg(0)).toBe(
      `Too many attacks: ${ROW_LIMITS.attacks} max (has ${attacks}, the plan adds ${room + 1})`,
    );
    expect(msg(1)).toBe("Not a character: Elite Goblin Warrior");
    expect(msg(2)).toBe(NO_CR);
    expect(msg(3)).toBe('Name "agent DRAFT" is taken');
    expect(msg(4)).toBe(CLASS_ROWS);
    expect([msg(6), msg(7)]).toEqual([OWNER_FIXED, "Nothing to change"]);
    expect(r.json.would[0]).toBe('character_put_row: add attacks row "Jab 0" on Mira');
    expect(r.json.would.at(-1)).toBe("character_edit: Mira, set name");
    expect(eventCount()).toBe(before);
  });

  test("FR-AGENT-16 FR-AGENT-03 leak scan: no non-owner frame holds Mira's sheet or stat block; no secret anywhere", () => {
    const raw2 = p2.raw();
    for (const text of [NOTE, NECKLACE, "Second Wind", "Soldier"]) {
      expect(raw2).not.toContain(text);
    }
    expect(sheetIn(p2, mira)).toBeUndefined();
    expect(Object.keys(entityIn(p2, mira) ?? {}).sort()).toEqual(
      [...REDACTED_CHARACTER_KEYS].sort(),
    );
    // player-1 isn't the draft's owner: only its summary.
    expect(p1.raw()).not.toContain("Draft rope");
    const all = [...outputs, ...logLines].join("\n");
    expect(outputs.length).toBeGreaterThan(10);
    expect(all).not.toContain(TEST_SECRET);
  });
});
