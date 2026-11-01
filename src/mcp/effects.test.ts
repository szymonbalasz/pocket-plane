// biome-ignore-all lint/suspicious/noThenProperty: `then` is the rule's effect field (MOD §8.4); rules are data, never awaited.
// AGENT §13 character effects (FR-AGENT-33–40): a real in-process server (port 0) on the
// `rule-triggers` bundle, a harness-written server.lock, the MCP server on the SDK in-memory
// transport, live player sockets and a DM socket for what the tools don't do (lock, combat, rest).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadBundle } from "@fixtures/index";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { closeDb, type Db, openFileDb } from "@server/db/client";
import { eventLog, notification, player } from "@server/db/schema";
import { startTestServer, type TestClient, type TestServer } from "@server/testing/harness";
import { TEST_SECRET } from "@server/testing/services";
import { CREATURE_SHEET_TYPE, type CreatureSheetRecord } from "@shared/character-sheet/sheet";
import { EFFECT_TYPE, type EffectRecord } from "@shared/combat-extras/schemas";
import {
  COMBATANT_TYPE,
  type CombatantRecord,
  type DamageCardPayload,
  ENCOUNTER_TYPE,
  type EncounterRecord,
} from "@shared/combat-tracker/schemas";
import { builtinPreset } from "@shared/effect-modifiers/presets";
import {
  CHARACTER_PRESET_EMPTY,
  EFFECT_PRESET_TYPE,
  type EffectPresetRecord,
} from "@shared/effect-modifiers/schemas";
import { recordsOf } from "@shared/protocol/store";
import { eq } from "drizzle-orm";
import { Caller } from "./client";
import { createMcpServer } from "./server";
import { NOT_A_CHARACTER } from "./tools/character";
import { BOTH_REQUIRES, BOTH_USES, NEEDS_FIELDS, ONE_PRESET } from "./tools/effects";

const DM = { role: "dm" as const, secret: TEST_SECRET };
const FORMULA = "1d6 + floor(level(barbarian) / 2)";
const NOTE = "ULFA-ENLARGE-NOTE-77";
const ROW_ENLARGE = "Frostcleaver: Enlarge";

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

const reaches: string[] = [];
let client: Client;
const call = async (name: string, args: Record<string, unknown> = {}): Promise<Result> => {
  reaches.length = 0;
  const r = await client.callTool({ name, arguments: args });
  const text = (r.content as { text: string }[]).map((c) => c.text).join("");
  return { isError: r.isError === true, json: JSON.parse(text) };
};

let p1: TestClient;
let p2: TestClient;
let dm: TestClient;
let ulfa: string;
let brakka: string;
let elite: string;

async function answer(c: TestClient, intentId: string) {
  for (;;) {
    const f = await c.next(undefined, 2000);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === intentId) return f;
  }
}
/** A DM intent that must succeed: its ack's result. */
async function dmDo<T = unknown>(name: string, payload: unknown): Promise<T> {
  const f = await answer(dm, dm.intent(name, payload));
  if (f.type !== "ack") throw new Error(`${name} rejected: ${JSON.stringify(f)}`);
  return f.result as T;
}
async function until(pred: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!pred()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await Bun.sleep(20);
  }
}

const eventCount = () => db.select().from(eventLog).all().length;
const sheetOf = (id: string) =>
  recordsOf<CreatureSheetRecord>(dm.store, CREATURE_SHEET_TYPE).find((s) => s.id === id);
const rowOf = (id: string, name: string) => sheetOf(id)?.features.find((f) => f.name === name);
const presetsIn = (c: TestClient) => recordsOf<EffectPresetRecord>(c.store, EFFECT_PRESET_TYPE);
const effectIn = (id: string) =>
  recordsOf<EffectRecord>(dm.store, EFFECT_TYPE).find((e) => e.id === id);

const rageRow = { name: "Rage", usesMax: 4, reset: "long" };
const furyRule = {
  on: "hit",
  when: [{ if: "via", via: "weapon" }, { if: "ownTurn" }],
  every: "turn",
  then: { do: "damage", formula: FORMULA, type: "radiant" },
};

beforeAll(async () => {
  const loaded = await loadBundle("rule-triggers", { dmSecret: TEST_SECRET, testMode: true });
  bundleDir = loaded.dir;
  db = openFileDb(loaded.config.dbPath);
  const players = Object.fromEntries(
    db
      .select()
      .from(player)
      .all()
      .map((p) => [p.name, p]),
  );
  h = await startTestServer({ db });
  lockDir = mkdtempSync(path.join(os.tmpdir(), "pp-mcp-effects-"));
  writeFileSync(
    path.join(lockDir, "server.lock"),
    JSON.stringify({
      owner: "server",
      pid: process.pid,
      port: Number(new URL(h.http).port),
      startedAt: "2026-03-01T00:00:00Z",
    }),
  );
  p1 = await h.live({ role: "player", token: players["Player 1"]?.linkToken as string });
  p2 = await h.live({ role: "player", token: players["Player 2"]?.linkToken as string });
  dm = await h.live(DM);
  const caller = new Caller({
    dataDir: lockDir,
    profile: "verify",
    dmSecret: TEST_SECRET,
    log,
    trace: (r) => reaches.push(r),
  });
  const server = createMcpServer({ caller, log, dmSecret: TEST_SECRET });
  client = new Client({ name: "test", version: "0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  const created = await dmDo<{ characterId: string }>("char.create", {
    name: "Ulfa",
    ownerPlayerId: players["Player 1"]?.id,
  });
  ulfa = created.characterId;
  await call("character_edit", {
    id: ulfa,
    set: {
      classes: [{ name: "Barbarian", level: 5, hitDie: "d12" }],
      abilities: { str: 18, dex: 12, con: 16, int: 8, wis: 12, cha: 10 },
    },
  });
  await call("character_put_row", {
    creatureId: ulfa,
    list: "attacks",
    row: { name: "Greataxe", toHit: 7, damage: "1d12+4", damageType: "slashing" },
  });
  brakka = (await call("characters_list", { q: "Brakka" })).json.characters[0].id;
  elite = (await call("creatures_list", { q: "Elite" })).json.creatures[0].id;
});

afterAll(async () => {
  await client.close();
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

/** The acceptance plan, before any of its ids exist (FR-AGENT-38). */
const rageCalls = () => [
  { tool: "character_put_row", input: { creatureId: ulfa, list: "features", row: rageRow } },
  { tool: "character_put_preset", input: { characterId: ulfa, from: "rage", usesFeature: "rage" } },
  {
    tool: "character_put_trigger",
    input: { characterId: ulfa, name: "Divine Fury", requiresPreset: "Rage", rule: furyRule },
  },
];

let ragePresetId: string;
let furyId: string;

describe("agent-api effect tools on a real server", () => {
  test("FR-AGENT-33 character_effects: presets, triggers, active effects with ids; a monster or unknown id refused", async () => {
    const r = await call("character_effects", { id: brakka });
    expect(r.isError).toBe(false);
    expect(reaches).toEqual(["ws", "intent sync.load"]);
    expect(r.json.character).toEqual({ id: brakka, name: "Brakka" });
    const rage = r.json.presets.find((p: { name: string }) => p.name === "Rage");
    expect(rage).toMatchObject({ id: expect.any(String), originKey: "rage" });
    const fury = r.json.triggers.find((t: { name: string }) => t.name === "Divine Fury");
    expect(fury).toMatchObject({ id: expect.any(String), characterId: brakka });
    expect(r.json.activeEffects).toEqual([]);

    expect((await call("character_effects", { id: elite })).json).toEqual({
      code: "invalid",
      message: NOT_A_CHARACTER,
    });
    expect((await call("character_effects", { id: "no-such" })).json.code).toBe("not_found");
  });

  test("FR-AGENT-38 FR-AGENT-40 one plan before any ids exist: row, preset spending it, trigger requiring it, toggle → ok, nothing written", async () => {
    const before = eventCount();
    const r = await call("plan_check", {
      calls: [
        ...rageCalls(),
        {
          tool: "character_toggle_preset",
          input: { characterId: ulfa, presetName: "Rage", on: true },
        },
      ],
    });
    expect(r.json).toEqual({
      ok: true,
      issues: [],
      would: [
        'character_put_row: add features row "Rage" on Ulfa',
        'character_put_preset: add "Rage" on Ulfa from rage, spends "rage"',
        'character_put_trigger: add "Divine Fury" on Ulfa, requires "Rage"',
        'character_toggle_preset: "Rage" on on Ulfa',
      ],
    });
    expect(eventCount()).toBe(before);
    expect((await call("character_effects", { id: ulfa })).json.presets).toEqual([]);
  });

  test("FR-AGENT-40 plan_check: names not planned earlier, too many uses rows, taken names, bad rules, bad targets", async () => {
    const preset = (o: Record<string, unknown>) => ({
      tool: "character_put_preset",
      input: { characterId: ulfa, from: "rage", ...o },
    });
    const trigger = (o: Record<string, unknown>) => ({
      tool: "character_put_trigger",
      input: { characterId: ulfa, name: "T", rule: furyRule, ...o },
    });
    const r = await call("plan_check", {
      calls: [
        // A later row doesn't count: order matters.
        preset({ name: "Early", usesFeature: "Rage" }),
        { tool: "character_put_row", input: { creatureId: ulfa, list: "features", row: rageRow } },
        { tool: "character_put_row", input: { creatureId: ulfa, list: "features", row: rageRow } },
        preset({ name: "Twice", usesFeature: "Rage" }),
        {
          tool: "character_put_row",
          input: { creatureId: ulfa, list: "features", row: { name: "Plain" } },
        },
        preset({ name: "Plain one", usesFeature: "Plain" }),
        trigger({ requiresPreset: "No such" }),
        { ...trigger({ name: "U", rule: { ...furyRule, requires: { preset: "no-such" } } }) },
        trigger({
          name: "V",
          rule: { ...furyRule, then: { do: "damage", formula: "1d(5)", type: null } },
        }),
        trigger({ name: "W", rule: { ...furyRule, every: { feature: "no-such-row" } } }),
        preset({ name: "Fourth", id: "no-such-preset" }),
        { tool: "character_put_preset", input: { characterId: elite, from: "rage" } },
        {
          tool: "character_toggle_preset",
          input: { characterId: ulfa, presetName: "Nope", on: true },
        },
        {
          tool: "character_toggle_preset",
          input: { characterId: ulfa, presetId: "nope", on: true },
        },
        preset({ name: "Early" }),
        preset({ name: "Mark", from: "hunters-mark" }),
      ],
    });
    expect(r.json.ok).toBe(false);
    const issues = r.json.issues.map((i: { call: number; path: string[]; message: string }) => [
      i.call,
      i.path.slice(1).join("."),
      i.message,
    ]);
    expect(issues).toEqual([
      [0, "usesFeature", 'No feature row "Rage" on Ulfa'],
      [3, "usesFeature", expect.stringContaining('2 feature rows with uses are named "Rage"')],
      [5, "usesFeature", 'Feature row "Plain" on Ulfa has no uses: set its usesMax'],
      [6, "requiresPreset", 'No preset "No such" on Ulfa'],
      [7, "rule.requires.preset", "Requires: no such preset"],
      [8, "rule.then.formula", expect.any(String)],
      [9, "rule.every.feature", "Uses: a feature row with uses"],
      [10, "id", "No preset no-such-preset on Ulfa"],
      [11, "characterId", "Not a character: Elite Goblin Warrior"],
      [12, "presetName", 'No preset "Nope" on Ulfa'],
      [13, "presetId", "No preset nope on Ulfa"],
      [14, "name", 'Name "Early" is already used by call 0'],
      [15, "modifiers", CHARACTER_PRESET_EMPTY],
    ]);
  });

  test("FR-AGENT-34 FR-AGENT-35 FR-AGENT-36 FR-AGENT-16 row, then a preset from built-in rage spending it, then Divine Fury: as the sheet's Start from", async () => {
    const n2 = p2.frames.length;
    const n1 = p1.frames.length;
    const [row, preset, trigger] = rageCalls();
    const a = await call("character_put_row", row?.input);
    expect(a.isError).toBe(false);
    const b = await call("character_put_preset", preset?.input);
    expect(b.isError).toBe(false);
    expect(reaches).toEqual(["ws", "intent mod.putPreset"]);
    expect(b.json).toMatchObject({ name: "Rage", created: true, usesFeatureId: a.json.rowId });
    ragePresetId = b.json.presetId;
    const c = await call("character_put_trigger", trigger?.input);
    expect(c.isError).toBe(false);
    expect(reaches).toEqual(["ws", "intent sync.load", "intent mod.putTrigger"]);
    expect(c.json).toMatchObject({ created: true, requiresPresetId: ragePresetId });
    furyId = c.json.triggerId;

    const read = await call("character_effects", { id: ulfa });
    const built = builtinPreset("rage");
    expect(read.json.presets[0]).toMatchObject({
      id: ragePresetId,
      name: built?.name,
      modifiers: built?.modifiers,
      durationRounds: built?.durationRounds,
      concentration: built?.concentration,
      note: built?.note,
      originKey: "rage",
      usesFeatureId: a.json.rowId,
      activeEffectId: null,
    });
    expect(read.json.triggers[0]).toMatchObject({
      id: furyId,
      name: "Divine Fury",
      enabled: true,
      public: true,
      rule: { on: "hit", requires: { preset: ragePresetId }, every: "turn" },
    });
    expect(read.json.triggers[0].rule.then).toEqual(furyRule.then);

    // FR-AGENT-16: the owner gets both live; another player neither.
    await until(() => presetsIn(p1).some((p) => p.id === ragePresetId));
    await until(() => JSON.stringify(p1.frames.slice(n1)).includes(furyId));
    expect(presetsIn(p2).some((p) => p.id === ragePresetId)).toBe(false);
    await Bun.sleep(100);
    const later = JSON.stringify(p2.frames.slice(n2));
    expect(later).not.toContain(ragePresetId);
    expect(later).not.toContain(furyId);
    expect(later).not.toContain("level(barbarian)");
  });

  test("FR-AGENT-38 run time: a name with no match, or two, is refused before anything is sent", async () => {
    const before = eventCount();
    const none = await call("character_put_preset", {
      characterId: ulfa,
      from: "bless",
      usesFeature: "Not a row",
    });
    expect(none.json).toMatchObject({
      code: "invalid",
      message: 'No feature row "Not a row" on Ulfa',
    });
    expect(reaches).toEqual(["ws"]);

    const twice = { name: "Twice", usesMax: 2, reset: "long" };
    await call("character_put_row", { creatureId: ulfa, list: "features", row: twice });
    const second = await call("character_put_row", {
      creatureId: ulfa,
      list: "features",
      row: twice,
    });
    const after = eventCount();
    expect(after).toBeGreaterThan(before);
    const dup = await call("character_put_preset", {
      characterId: ulfa,
      from: "bless",
      usesFeature: "twice",
    });
    expect(dup.json.code).toBe("invalid");
    expect(dup.json.message).toContain('2 feature rows with uses are named "twice"');
    expect(dup.json.message).toContain(second.json.rowId);
    expect(reaches).toEqual(["ws"]);

    const noPreset = await call("character_put_trigger", {
      characterId: ulfa,
      name: "Nope",
      requiresPreset: "Nope",
      rule: furyRule,
    });
    expect(noPreset.json).toMatchObject({ code: "invalid", message: 'No preset "Nope" on Ulfa' });
    expect(reaches).toEqual(["ws", "intent sync.load"]);
    expect(eventCount()).toBe(after);

    // Both ways of naming one thing are refused by the input alone.
    const both = await call("character_put_preset", {
      characterId: ulfa,
      from: "bless",
      usesFeature: "x",
      usesFeatureId: "y",
    });
    expect(both.json.issues[0].message).toBe(BOTH_USES);
    const bothReq = await call("character_put_trigger", {
      characterId: ulfa,
      name: "Nope",
      requiresPreset: "Rage",
      rule: { ...furyRule, requires: { preset: "rage" } },
    });
    expect(bothReq.json.issues[0].message).toBe(BOTH_REQUIRES);
    const empty = await call("character_put_preset", { characterId: ulfa, name: "Half" });
    expect(empty.json.issues[0].message).toBe(NEEDS_FIELDS);
    expect(reaches).toEqual([]);
  });

  test("FR-AGENT-39 a rerun leaves no duplicates: conflict naming the id; plan_check too; replace by id keeps what it doesn't name", async () => {
    const before = eventCount();
    const [, preset, trigger] = rageCalls();
    const again = await call("character_put_preset", { ...preset?.input, usesFeature: undefined });
    expect(again.json.code).toBe("conflict");
    expect(again.json.message).toBe(
      `Ulfa already has a preset named "Rage" (id ${ragePresetId}): pass id ${ragePresetId} to replace it`,
    );
    expect(reaches).toEqual(["ws"]);
    const upper = await call("character_put_trigger", {
      ...trigger?.input,
      name: "DIVINE fury",
    });
    expect(upper.json.code).toBe("conflict");
    expect(upper.json.message).toContain(furyId);
    expect(eventCount()).toBe(before);

    const plan = await call("plan_check", { calls: [preset, trigger] });
    expect(plan.json.ok).toBe(false);
    expect(plan.json.issues.map((i: { path: string[] }) => i.path.at(-1))).toEqual([
      "name",
      "name",
    ]);
    expect(plan.json.issues[0].message).toContain(ragePresetId);
    expect(plan.json.issues[1].message).toContain(furyId);

    // A disabled trigger stays disabled when replaced without `enabled`.
    const off = await call("character_put_trigger", {
      ...trigger?.input,
      id: furyId,
      enabled: false,
    });
    expect(off.json).toMatchObject({ triggerId: furyId, created: false });
    const kept = await call("character_put_trigger", { ...trigger?.input, id: furyId });
    expect(kept.isError).toBe(false);
    let read = await call("character_effects", { id: ulfa });
    expect(read.json.triggers).toHaveLength(1);
    expect(read.json.triggers[0].enabled).toBe(false);
    await call("character_put_trigger", { ...trigger?.input, id: furyId, enabled: true });

    // Replacing a preset: only `note` named, the rest as stored (origin, uses link, modifiers).
    const stored = read.json.presets[0];
    const replaced = await call("character_put_preset", {
      characterId: ulfa,
      id: ragePresetId,
      note: "Rage note",
    });
    expect(replaced.json).toMatchObject({ presetId: ragePresetId, created: false, name: "Rage" });
    read = await call("character_effects", { id: ulfa });
    expect(read.json.presets).toHaveLength(1);
    expect(read.json.presets[0]).toMatchObject({
      name: "Rage",
      note: "Rage note",
      originKey: "rage",
      usesFeatureId: stored.usesFeatureId,
      modifiers: stored.modifiers,
    });

    // No id of another character's preset, and no rename onto a taken name.
    const foreign = (await call("character_effects", { id: brakka })).json.presets[0].id;
    expect(
      (await call("character_put_preset", { characterId: ulfa, id: foreign, note: "x" })).json.code,
    ).toBe("not_found");
    const other = await call("character_put_preset", { characterId: ulfa, from: "bless" });
    const rename = await call("character_put_preset", {
      characterId: ulfa,
      id: other.json.presetId,
      name: "rage",
    });
    expect(rename.json.code).toBe("conflict");
    expect(rename.json.message).toContain(ragePresetId);
  });

  test("FR-AGENT-36 FR-AGENT-37 Divine Fury end to end: Rage off, no part; Rage on, a use spent and the radiant part offered", async () => {
    const enc = recordsOf<EncounterRecord>(dm.store, ENCOUNTER_TYPE).find(
      (e) => e.status === "started",
    ) as EncounterRecord;
    await dmDo("cbtx.addCombatants", { encounterId: enc.id, items: [{ characterId: ulfa }] });
    const me = () =>
      recordsOf<CombatantRecord>(dm.store, COMBATANT_TYPE).find((c) => c.name === "Ulfa");
    await until(() => me() !== undefined);
    const combatantId = (me() as CombatantRecord).id;
    await dmDo("cbt.setInitiative", { combatantId, value: 19 });
    for (let i = 0; i < 10; i++) {
      const now = recordsOf<EncounterRecord>(dm.store, ENCOUNTER_TYPE).find((e) => e.id === enc.id);
      if (now?.turnCombatantId === combatantId) break;
      await dmDo("cbt.nextTurn", {
        encounterId: enc.id,
        expectedRound: now?.round,
        expectedTurnId: now?.turnCombatantId,
      });
    }
    const offered = async () => {
      const { cardId } = await dmDo<{ cardId: string }>("cbt.attack", {
        attackerId: combatantId,
        mode: "normal",
        manual: [{ diceTotal: 15 }, { diceTotal: 8 }],
      });
      const row = db.select().from(notification).where(eq(notification.id, cardId)).get();
      return (row?.payload as DamageCardPayload | undefined)?.damage?.triggers ?? [];
    };

    expect(await offered()).toEqual([]);
    expect(rowOf(ulfa, "Rage")?.used ?? 0).toBe(0);

    const on = await call("character_toggle_preset", {
      characterId: ulfa,
      presetName: "Rage",
      on: true,
    });
    expect(on.isError).toBe(false);
    expect(reaches).toEqual(["ws", "intent mod.toggle"]);
    expect(on.json).toMatchObject({
      presetId: ragePresetId,
      on: true,
      effectId: expect.any(String),
    });
    await until(() => rowOf(ulfa, "Rage")?.used === 1);

    const parts = await offered();
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      triggerId: furyId,
      label: "Divine Fury",
      type: "radiant",
      expression: "1d6+2",
    });

    // A built-in key in `requires` matches by origin (FR-MOD-36), with no id needed.
    const byKey = await call("character_put_trigger", {
      characterId: ulfa,
      id: furyId,
      name: "Divine Fury",
      rule: { ...furyRule, requires: { preset: "rage" } },
    });
    expect(byKey.isError).toBe(false);
    expect((await offered()).map((p) => p.triggerId)).toEqual([furyId]);

    const off = await call("character_toggle_preset", {
      characterId: ulfa,
      presetId: ragePresetId,
      on: false,
    });
    expect(off.json).toMatchObject({ on: false, effectId: null });
    await until(() => (effectIn(on.json.effectId)?.endedAt ?? "x") !== null);
    expect(await offered()).toEqual([]);
    expect(rowOf(ulfa, "Rage")?.used).toBe(1);
  });

  test("FR-AGENT-34 FR-AGENT-37 custom Enlarge: dice and advantage, 10 rounds, concentration, spends its row; no uses left → refusal; no force, no overspend", async () => {
    const row = await call("character_put_row", {
      creatureId: ulfa,
      list: "features",
      row: { name: ROW_ENLARGE, usesMax: 1, reset: "long" },
    });
    const modifiers = [
      { kind: "dice", on: { roll: "damage", via: "weapon" }, dice: "1d4", sign: 1 },
      { kind: "mode", on: { roll: "check", abilities: ["str"] }, mode: "advantage" },
      { kind: "mode", on: { roll: "save", abilities: ["str"] }, mode: "advantage" },
    ];
    const put = await call("character_put_preset", {
      characterId: ulfa,
      name: "Enlarge",
      modifiers,
      durationRounds: 10,
      concentration: true,
      usesFeature: ROW_ENLARGE,
      note: NOTE,
    });
    expect(put.isError).toBe(false);
    const presetId = put.json.presetId;
    await until(() => presetsIn(dm).some((p) => p.id === presetId));
    expect(presetsIn(dm).find((p) => p.id === presetId)).toMatchObject({
      name: "Enlarge",
      modifiers,
      durationRounds: 10,
      concentration: true,
      usesFeatureId: row.json.rowId,
      originKey: null,
      note: NOTE,
    });

    const toggle = (on: boolean, extra: Record<string, unknown> = {}) =>
      call("character_toggle_preset", { characterId: ulfa, presetId, on, ...extra });
    const on = await toggle(true);
    expect(on.isError).toBe(false);
    await until(() => effectIn(on.json.effectId) !== undefined);
    expect(effectIn(on.json.effectId)).toMatchObject({
      kind: "custom",
      label: "Enlarge",
      modifiers,
      durationRounds: 10,
      targetCharacterId: ulfa,
      presetKey: presetId,
    });
    await until(() => rowOf(ulfa, ROW_ENLARGE)?.used === 1);

    // Already on: success, the same effect, no second use.
    const n = eventCount();
    const same = await toggle(true);
    expect(same.json.effectId).toBe(on.json.effectId);
    expect(eventCount()).toBe(n);

    expect((await toggle(false)).json.effectId).toBeNull();
    const refused = await toggle(true);
    expect(refused.json).toEqual({ code: "conflict", message: `No ${ROW_ENLARGE} uses left` });
    expect(rowOf(ulfa, ROW_ENLARGE)?.used).toBe(1);

    // The tool has neither escape hatch: refused by the input, nothing sent.
    for (const extra of [{ force: true }, { overspend: true }]) {
      const r = await toggle(true, extra);
      expect(r.json.code).toBe("invalid");
      expect(reaches).toEqual([]);
    }
    const both = await call("character_toggle_preset", {
      characterId: ulfa,
      presetId,
      presetName: "Enlarge",
      on: true,
    });
    expect(both.json.issues[0].message).toBe(ONE_PRESET);

    // plan_check sees the same refusal, on the same state.
    const plan = await call("plan_check", {
      calls: [
        { tool: "character_toggle_preset", input: { characterId: ulfa, presetId, on: true } },
      ],
    });
    expect(plan.json.issues.map((i: { message: string }) => i.message)).toEqual([
      `No ${ROW_ENLARGE} uses left`,
    ]);

    // The note and the row name never reach another player.
    expect(p2.raw()).not.toContain(NOTE);
    expect(p2.raw()).not.toContain(ROW_ENLARGE);
  });

  test("FR-AGENT-34 FR-AGENT-37 Luckstone: flat +1 checks and saves, no duration, no uses; on stays on through a long rest", async () => {
    const put = await call("character_put_preset", {
      characterId: ulfa,
      name: "Luckstone",
      modifiers: [
        { kind: "flat", on: { roll: "check" }, value: 1 },
        { kind: "flat", on: { roll: "save" }, value: 1 },
      ],
      durationRounds: null,
      concentration: false,
    });
    expect(put.isError).toBe(false);
    const on = await call("character_toggle_preset", {
      characterId: ulfa,
      presetName: "luckstone",
      on: true,
    });
    expect(on.isError).toBe(false);
    await until(() => effectIn(on.json.effectId) !== undefined);
    expect(effectIn(on.json.effectId)).toMatchObject({ durationRounds: null, endsRound: null });

    const used = rowOf(ulfa, ROW_ENLARGE)?.used;
    expect(used).toBe(1);
    await dmDo("char.rest", { characterIds: [ulfa], kind: "long" });
    await until(() => (rowOf(ulfa, ROW_ENLARGE)?.used ?? 0) === 0);

    const read = await call("character_effects", { id: ulfa });
    const stone = read.json.presets.find((p: { name: string }) => p.name === "Luckstone");
    expect(stone.activeEffectId).toBe(on.json.effectId);
    expect(read.json.activeEffects.map((e: { id: string }) => e.id)).toContain(on.json.effectId);
  });

  test("FR-AGENT-27 FR-CHARX-12 a locked sheet still works for the DM; the owner's own edit is refused", async () => {
    await dmDo("char.setLock", { characterId: ulfa, locked: true });
    const mine = await answer(
      p1,
      p1.intent("mod.putPreset", {
        preset: {
          characterId: ulfa,
          name: "Owner's",
          modifiers: [{ kind: "flat", on: { roll: "check" }, value: 1 }],
          durationRounds: null,
          concentration: false,
        },
      }),
    );
    expect(mine).toMatchObject({ type: "reject", code: "forbidden" });

    const preset = await call("character_put_preset", { characterId: ulfa, from: "reckless" });
    expect(preset.isError).toBe(false);
    const trigger = await call("character_put_trigger", {
      characterId: ulfa,
      name: "Locked Fury",
      requiresPreset: "Reckless Attack",
      rule: furyRule,
    });
    expect(trigger.isError).toBe(false);
    const on = await call("character_toggle_preset", {
      characterId: ulfa,
      presetId: preset.json.presetId,
      on: true,
    });
    expect(on.isError).toBe(false);
    const edited = await call("character_put_preset", {
      characterId: ulfa,
      id: preset.json.presetId,
      note: "Locked edit",
    });
    expect(edited.isError).toBe(false);
    await dmDo("char.setLock", { characterId: ulfa, locked: false });
  });

  test("FR-AGENT-34 at most six presets: plan_check counts planned ones; the server's conflict passes through", async () => {
    const read = await call("character_effects", { id: ulfa });
    const room = 6 - read.json.presets.length;
    const mod = [{ kind: "flat", on: { roll: "check" }, value: 1 }];
    const add = (i: number) => ({
      tool: "character_put_preset",
      input: {
        characterId: ulfa,
        name: `Extra ${i}`,
        modifiers: mod,
        durationRounds: null,
        concentration: false,
      },
    });
    const plan = await call("plan_check", {
      calls: Array.from({ length: room + 1 }, (_, i) => add(i)),
    });
    expect(plan.json.issues).toEqual([
      { call: room, path: ["input", "characterId"], message: "At most 6 presets per character" },
    ]);
    for (let i = 0; i < room; i++) {
      expect((await call("character_put_preset", add(i).input)).isError).toBe(false);
    }
    const over = await call("character_put_preset", add(room).input);
    expect(over.json).toEqual({ code: "conflict", message: "At most 6 presets per character" });
  });
});
