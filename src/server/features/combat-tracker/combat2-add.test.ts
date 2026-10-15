// Sprint 2, N5 (fix/combat2-add): builder options and Start (FR-CBT-62, -64–66), rolled HP and
// definition edits (FR-CBT-67), deleting a removed combatant's token (FR-CBT-68), monster
// initiative DM-only (FR-CBT-69).
import { describe, expect, test } from "bun:test";
import {
  COMBATANT_TYPE,
  type CombatantRecord,
  type EncounterRecord,
} from "@shared/combat-tracker/schemas";
import { GAME_LOG_ENTRY_TYPE, type GameLogEntryRecord } from "@shared/dice-roll-log/schemas";
import { FOG_INTENTS } from "@shared/fog-of-war/schemas";
import { MAP_INTENTS, TOKEN_TYPE, type TokenRecord } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { createApp } from "../../app";
import { conflict } from "../../commands/errors";
import { token } from "../../db/schema";
import { TEST_SECRET } from "../../testing/services";
import { UPDATE } from "../entities/commands";
import { createScene, placeToken } from "../scenes-map/commands";
import { addAsset } from "../scenes-map/testing";
import { createEncounter, updateEncounter } from "./encounters";
import { TOKEN_IN_ENCOUNTER } from "./hooks";
import { rollInitiative, setRemoved } from "./initiative";
import { anchorCell, SCENE_FULL } from "./join";
import { combatRuleHooksOf } from "./rule-hooks";
import { combatSetup, eliteBlock } from "./testing";

const START = "cbt.start";

/** Imported definitions are read-only: set / drop a stat block's `hpFormula` in the test DB. */
function setFormula(t: ReturnType<typeof combatSetup>, id: string, formula: string | null) {
  const sql =
    formula === null
      ? "update entity set stat_block = json_remove(stat_block, '$.hpFormula') where id = ?"
      : "update entity set stat_block = json_set(stat_block, '$.hpFormula', ?) where id = ?";
  t.s.db.$client.run(sql, formula === null ? [id] : [formula, id]);
}

/** combatSetup with Goblin's `hpFormula` 2d6 (FR-ENT-25), like the SRD fixture. */
function setup() {
  const t = combatSetup();
  setFormula(t, t.h.goblinId, "2d6");
  const sceneTokenRows = () =>
    t.s.db
      .select()
      .from(token)
      .where(eq(token.sceneId, t.sceneId))
      .all() as unknown as TokenRecord[];
  const startEvent = () => t.events.find((e) => e.event.type === "EncounterStarted")?.event;
  return { ...t, sceneTokenRows, startEvent };
}

/** encounter-1 plus one extra Goblin entry (rolled), as CBT §13's FR-CBT-64 test. */
function ambushPlus(t: ReturnType<typeof setup>, extra: Record<string, unknown> = {}) {
  return t.run<EncounterRecord>(createEncounter.name, {
    name: "Ambush at the Ford",
    partyCharacterIds: null,
    entries: [
      { definitionId: t.h.goblinId, quantity: 3, hpMode: "rolled" },
      { definitionId: t.h.wolfId, quantity: 1 },
      { definitionId: t.eliteId, quantity: 1 },
    ],
    ...extra,
  });
}

const entriesOf = (changes: { type: string; after: unknown }[] = []) =>
  changes.filter((c) => c.type === GAME_LOG_ENTRY_TYPE).map((c) => c.after as GameLogEntryRecord);

describe("FR-CBT-62 builder options", () => {
  test("FR-CBT-62 add options: defaults true / average; createTokens false and rolled Goblin ✓; Elite rolled → invalid", () => {
    const t = setup();
    const plain = t.createAmbush();
    expect(plain).toMatchObject({ createTokens: true, addHidden: true });
    const ev = t.events.at(-1)?.event;
    expect(ev?.changes.filter((c) => c.type === "encounter-entry").map((c) => c.after)).toEqual(
      expect.arrayContaining([expect.objectContaining({ hpMode: "average" })]),
    );
    const e = ambushPlus(t, { createTokens: false, addHidden: false });
    expect(e).toMatchObject({ createTokens: false, addHidden: false });
    const n = t.count("encounter");
    const bad = t.err(() =>
      t.run(createEncounter.name, {
        name: "Bad",
        partyCharacterIds: null,
        entries: [{ definitionId: t.eliteId, quantity: 1, hpMode: "rolled" }],
      }),
    );
    expect(bad).toMatchObject({
      code: "invalid",
      message: "Elite Goblin Warrior has no HP formula",
    });
    expect(bad.issues?.[0]?.path).toEqual(["entries", 0, "hpMode"]);
    expect(t.count("encounter")).toBe(n);
    // PUT is a whole replace: omitted options go back to true.
    const put = t.run<EncounterRecord>(updateEncounter.name, {
      id: e.id,
      name: "Ford",
      partyCharacterIds: null,
      entries: [],
    });
    expect(put).toMatchObject({ createTokens: true, addHidden: true });
  });

  test("FR-CBT-62 REST bodies carry createTokens / addHidden / hpMode", async () => {
    const t = setup();
    const app = createApp(t.s);
    const headers = { authorization: `Bearer ${TEST_SECRET}`, "content-type": "application/json" };
    const res = await app.request("/api/encounters", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Ford",
        partyCharacterIds: null,
        entries: [{ definitionId: t.h.goblinId, quantity: 2, hpMode: "rolled" }],
        createTokens: false,
        addHidden: true,
      }),
    });
    expect(res.status).toBe(201);
    const { encounter } = (await res.json()) as { encounter: EncounterRecord };
    expect(encounter).toMatchObject({ createTokens: false, addHidden: true });
    const bad = await app.request("/api/encounters", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "Ford",
        partyCharacterIds: null,
        entries: [{ definitionId: t.eliteId, quantity: 1, hpMode: "rolled" }],
      }),
    });
    expect(bad.status).toBe(400);
  });
});

describe("FR-CBT-64 FR-CBT-65 start applies the options", () => {
  test("FR-CBT-64 start creates tokens: one hidden token at the nearest free cell, bound; rolled HP; monster initiative DM-only; tokens before combatants", () => {
    const t = setup();
    const enc = ambushPlus(t);
    const before = t.sceneTokenRows().length;
    t.run(START, { encounterId: enc.id, sceneId: t.sceneId, at: { col: 10, row: 8 } });
    const created = t.sceneTokenRows().slice(before);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ name: "Goblin 3", hidden: true, col: 10, row: 8 });
    const by = t.byName(enc.id);
    expect(by["Goblin 3"]).toMatchObject({ tokenId: created[0]?.id, hidden: true });
    // Rolled HP: 2d6, one DM-only `other` entry per Goblin.
    const goblins = ["Goblin", "Goblin 2", "Goblin 3"].map((n) => by[n] as CombatantRecord);
    for (const g of goblins) {
      expect(g.hpMax).toBe(g.hpCurrent);
      expect(g.hpMax).toBeGreaterThanOrEqual(2);
      expect(g.hpMax).toBeLessThanOrEqual(12);
    }
    expect(by.Wolf).toMatchObject({ hpMax: 11, hpCurrent: 11 });
    const ev = t.startEvent();
    const entries = entriesOf(ev?.changes);
    const hp = entries.filter((e) => e.category === "other");
    expect(hp.map((e) => [e.actorName, e.public, e.encounterId])).toEqual(
      ["Goblin", "Goblin 2", "Goblin 3"].map((n) => [n, false, enc.id]),
    );
    expect((hp[0]?.payload as { label: string }[] | undefined)?.[0]?.label).toBe("HP (2d6)");
    // Every monster has initiative; PCs stay null; the initiative entries are DM-only.
    for (const c of Object.values(by)) expect(c.initiative === null).toBe(c.kind === "pc");
    const init = entries.filter((e) => e.category === "initiative");
    expect(init).toHaveLength(5);
    expect(init.every((e) => e.public === false)).toBe(true);
    // Token creates first, then the encounter and combatants, then the roll entries.
    const types = (ev?.changes ?? []).map((c) => c.type);
    expect(types[0]).toBe(TOKEN_TYPE);
    expect(types.lastIndexOf(COMBATANT_TYPE)).toBeLessThan(types.indexOf(GAME_LOG_ENTRY_TYPE));
  });

  test("FR-CBT-64 created hidden token never reaches players", () => {
    const t = setup();
    const enc = ambushPlus(t);
    t.run(START, { encounterId: enc.id, sceneId: t.sceneId });
    const ev = t.startEvent();
    const g3 = t.byName(enc.id)["Goblin 3"] as CombatantRecord;
    for (const v of [t.h.viewer("player", t.h.p1.id), t.h.viewer("player", t.h.p2.id)]) {
      const wire = (ev?.changes ?? []).map((c) => t.s.records.filterChange(c, v)).filter(Boolean);
      const raw = JSON.stringify(wire);
      expect(raw).not.toContain(g3.id);
      expect(raw).not.toContain(g3.tokenId as string);
      expect(wire.some((w) => w?.type === GAME_LOG_ENTRY_TYPE)).toBe(false);
      const snap = JSON.stringify(t.h.snapshot(v));
      expect(snap).not.toContain(g3.tokenId as string);
      expect(snap).not.toContain(g3.id);
      expect(snap).not.toContain("HP (2d6)");
    }
  });

  test("FR-CBT-64 one transaction: a throwing started hook → no token, encounter planned", () => {
    const t = setup();
    const enc = ambushPlus(t);
    combatRuleHooksOf(t.s).register("test.fail", {
      started: () => {
        throw conflict("hook failed");
      },
    });
    const counts = () => [t.sceneTokenRows().length, t.count("combatant"), t.count("roll")];
    const before = counts();
    expect(t.err(() => t.run(START, { encounterId: enc.id, sceneId: t.sceneId })).code).toBe(
      "conflict",
    );
    expect(counts()).toEqual(before);
    expect(t.s.db.$client.query("select status from encounter").all()).toEqual([
      { status: "planned" },
    ]);
  });

  test("FR-CBT-64 createTokens off → token-less, visible; addHidden off → visible created token", () => {
    const t = setup();
    const off = ambushPlus(t, { createTokens: false });
    const before = t.sceneTokenRows().length;
    t.run(START, { encounterId: off.id, sceneId: t.sceneId });
    expect(t.sceneTokenRows().length).toBe(before);
    expect(t.byName(off.id)["Goblin 3"]).toMatchObject({ tokenId: null, hidden: false });

    const u = setup();
    const visible = ambushPlus(u, { addHidden: false });
    u.run(START, { encounterId: visible.id, sceneId: u.sceneId });
    expect(u.byName(visible.id)["Goblin 3"]).toMatchObject({ hidden: false });
    expect(u.byName(visible.id)["Goblin 3"]?.tokenId).not.toBeNull();
  });

  test("FR-CBT-64 a definition that lost its formula since → average HP, no HP entry", () => {
    const t = setup();
    const enc = ambushPlus(t);
    setFormula(t, t.h.goblinId, null);
    t.run(START, { encounterId: enc.id, sceneId: t.sceneId });
    expect(t.byName(enc.id).Goblin).toMatchObject({ hpMax: 7, hpCurrent: 7 });
    expect(entriesOf(t.startEvent()?.changes).some((e) => e.category === "other")).toBe(false);
  });

  test("FR-CBT-65 placement: at clamped into the map; omitted → centre; earlier tokens occupied; no room → the rest at at", () => {
    const t = setup();
    const scene = t.s.db.$client.query("select * from scene where id = ?").get(t.sceneId) as Record<
      string,
      number
    >;
    const m = {
      mapWidth: scene.map_width as number,
      mapHeight: scene.map_height as number,
      gridCellSize: scene.grid_cell_size as number,
      gridOffsetX: 0,
      gridOffsetY: 0,
    } as Parameters<typeof anchorCell>[0];
    // 1400 × 980 at 70 px: 20 × 14 cells.
    expect(anchorCell(m)).toEqual({ col: 10, row: 7 });
    expect(anchorCell(m, { col: 99, row: -5 })).toEqual({ col: 19, row: 0 });
    expect(anchorCell(m, { col: 3, row: 4 })).toEqual({ col: 3, row: 4 });

    // Three created wolves near (10, 8): (10, 8), then the d = 5 ring by row, col.
    const enc = t.run<EncounterRecord>(createEncounter.name, {
      name: "Many",
      partyCharacterIds: [],
      entries: [{ definitionId: t.h.wolfId, quantity: 4 }],
    });
    const before = t.sceneTokenRows().length;
    t.run(START, { encounterId: enc.id, sceneId: t.sceneId, at: { col: 10, row: 8 } });
    // The placed Wolf token binds first; three created, each taking the next free cell.
    expect(
      t
        .sceneTokenRows()
        .slice(before)
        .map((x) => [x.col, x.row]),
    ).toEqual([
      [10, 8],
      [9, 7],
      [10, 7],
    ]);

    // A 2 × 1 cell map: two goblins fit, the third goes to `at`.
    const u = setup();
    addAsset(u.s, "map-tiny", u.h.campaignId, { w: 140, h: 70 });
    const tiny = u.run<{ id: string }>(createScene.name, { name: "Tiny", mapAssetId: "map-tiny" });
    u.run(FOG_INTENTS.setAll, { sceneId: tiny.id, fogged: false }); // FR-FOG-25 ripple
    const small = u.run<EncounterRecord>(createEncounter.name, {
      name: "Tiny fight",
      partyCharacterIds: [],
      entries: [{ definitionId: u.h.goblinId, quantity: 3 }],
    });
    u.run(START, { encounterId: small.id, sceneId: tiny.id, at: { col: 1, row: 0 } });
    const placed = u.s.db.select().from(token).where(eq(token.sceneId, tiny.id)).all();
    expect(placed.map((x) => [x.col, x.row])).toEqual([
      [1, 0],
      [0, 0],
      [1, 0],
    ]);
  });

  test("FR-CBT-65 created token image (sim-5 glitch 4): the portrait, else the image of the definition's latest token on the scene, else none; the combatant copies it", () => {
    const t = setup();
    for (const id of ["art-goblin-a", "art-goblin-b"]) addAsset(t.s, id, t.h.campaignId);
    const setImage = (tokenId: string, imageAssetId: string) =>
      t.run(MAP_INTENTS.updateToken, { tokenId, imageAssetId });
    // SRD Goblin has no portrait (imports never do): its art lives on its tokens only.
    setImage(t.tokens.goblin, "art-goblin-a");
    setImage(t.tokens.goblin2, "art-goblin-b");
    // Elite has a portrait: that wins over its token's own image.
    setImage(t.tokens.elite, "art-goblin-a");
    const enc = ambushPlus(t, {
      entries: [
        { definitionId: t.h.goblinId, quantity: 3 },
        { definitionId: t.h.wolfId, quantity: 2 },
        { definitionId: t.eliteId, quantity: 2 },
      ],
    });
    const before = t.sceneTokenRows().length;
    t.run(START, { encounterId: enc.id, sceneId: t.sceneId });
    const created = t.sceneTokenRows().slice(before);
    const images = Object.fromEntries(created.map((x) => [x.name, x.imageAssetId]));
    expect(images).toEqual({
      "Goblin 3": "art-goblin-b",
      "Wolf 2": null,
      "Elite Goblin Warrior 2": "art-elite",
    });
    const by = t.byName(enc.id);
    expect(by["Goblin 3"]?.imageAssetId).toBe("art-goblin-b");
  });

  test("FR-CBT-65 scene at its token cap → conflict 'Scene is full', nothing written", () => {
    const t = setup();
    const enc = ambushPlus(t);
    // Fill the scene to its cap (200) with Mira tokens.
    for (let i = t.sceneTokenRows().length; i < 200; i++) {
      t.run(placeToken.name, { sceneId: t.sceneId, definitionId: t.miraId, col: 0, row: 0 });
    }
    const counts = () => [t.sceneTokenRows().length, t.count("combatant"), t.count("roll")];
    const before = counts();
    const e = t.err(() => t.run(START, { encounterId: enc.id, sceneId: t.sceneId }));
    expect([e.code, e.message]).toEqual(["conflict", SCENE_FULL]);
    expect(counts()).toEqual(before);
  });
});

describe("FR-CBT-66 party PCs not on the map", () => {
  test("FR-CBT-66 Thorn's token deleted, excludeCharacterIds [Thorn] → no Thorn combatant; a non-party id → invalid", () => {
    const t = setup();
    const enc = t.createAmbush();
    t.run(MAP_INTENTS.deleteToken, { tokenId: t.tokens.thorn });
    const bad = t.err(() =>
      t.run(START, {
        encounterId: enc.id,
        sceneId: t.sceneId,
        excludeCharacterIds: [t.h.goblinId],
      }),
    );
    expect(bad.code).toBe("invalid");
    expect(t.count("combatant")).toBe(0);
    const party = t.run<EncounterRecord>(createEncounter.name, {
      name: "Mira only",
      partyCharacterIds: [t.miraId],
      entries: [],
    });
    expect(
      t.err(() =>
        t.run(START, {
          encounterId: party.id,
          sceneId: t.sceneId,
          excludeCharacterIds: [t.thornId],
        }),
      ).code,
    ).toBe("invalid");
    t.run(START, { encounterId: enc.id, sceneId: t.sceneId, excludeCharacterIds: [t.thornId] });
    const names = Object.keys(t.byName(enc.id));
    expect(names).toContain("Mira");
    expect(names).not.toContain("Thorn");
  });
});

describe("FR-CBT-67 FR-CBT-68 FR-CBT-69", () => {
  test("FR-CBT-67 rolled Elite keeps hpMax after a definition edit; one at the old average follows", () => {
    const t = setup();
    t.run(UPDATE, {
      id: t.eliteId,
      name: "Elite Goblin Warrior",
      statBlock: { ...eliteBlock, hpFormula: "2d8+6" },
    });
    const enc = t.run<EncounterRecord>(createEncounter.name, {
      name: "Two",
      partyCharacterIds: [],
      entries: [{ definitionId: t.eliteId, quantity: 2, hpMode: "rolled" }],
    });
    t.run(START, { encounterId: enc.id, sceneId: t.sceneId, at: { col: 5, row: 5 } });
    // Make the rule observable: one rolled value at the old average (15), one away from it.
    const [a, b] = Object.values(t.byName(enc.id)) as CombatantRecord[];
    const sql = "update combatant set hp_max = ?, hp_current = ? where id = ?";
    t.s.db.$client.run(sql, [15, 15, a?.id as string]);
    t.s.db.$client.run(sql, [8, 8, b?.id as string]);
    t.run(UPDATE, {
      id: t.eliteId,
      name: "Elite Goblin Warrior",
      statBlock: { ...eliteBlock, hpMax: 20, hpFormula: "2d8+6" },
    });
    const now = (id?: string) => t.combatants(enc.id).find((c) => c.id === id);
    expect(now(a?.id)).toMatchObject({ hpMax: 20, hpCurrent: 20 });
    expect(now(b?.id)).toMatchObject({ hpMax: 8, hpCurrent: 8 });
  });

  test("FR-CBT-68 removed Goblin 2 → its token deletes, combatant tokenId null, players get the removed upsert; not removed → conflict", () => {
    const t = setup();
    const enc = t.createAmbush();
    t.run(START, { encounterId: enc.id, sceneId: t.sceneId });
    const g2 = t.byName(enc.id)["Goblin 2"] as CombatantRecord;
    const e = t.err(() => t.run(MAP_INTENTS.deleteToken, { tokenId: t.tokens.goblin2 }));
    expect([e.code, e.message]).toEqual(["conflict", TOKEN_IN_ENCOUNTER]);
    t.run(setRemoved.name, { combatantId: g2.id, removed: true });
    t.run(MAP_INTENTS.deleteToken, { tokenId: t.tokens.goblin2 });
    expect(t.byName(enc.id)["Goblin 2"]?.tokenId).toBeNull();
    const ev = t.events.at(-1)?.event;
    expect(ev?.type).toBe("TokenDeleted");
    const v = t.h.viewer("player", t.h.p1.id);
    const wire = (ev?.changes ?? []).map((c) => t.s.records.filterChange(c, v));
    expect(wire).toContainEqual(
      expect.objectContaining({
        type: COMBATANT_TYPE,
        id: g2.id,
        op: "upsert",
        data: expect.objectContaining({ removed: true, tokenId: null }),
      }),
    );
  });

  test("FR-CBT-69 monster initiative never public by default", () => {
    const t = setup();
    const enc = t.createAmbush();
    t.run(START, { encounterId: enc.id, sceneId: t.sceneId });
    t.run("dice.setCategoryPublic", { category: "initiative", public: true });
    const g = t.byName(enc.id).Goblin as CombatantRecord;
    const players = [t.h.viewer("player", t.h.p1.id), t.h.viewer("player", t.h.p2.id)];
    const lines = () =>
      entriesOf(t.events.at(-1)?.event.changes).map((e) => [e.actorName, e.public]);
    t.run(rollInitiative.name, { combatantIds: [g.id] });
    expect(lines()).toEqual([["Goblin", false]]);
    for (const v of players) {
      const wire = (t.events.at(-1)?.event.changes ?? [])
        .filter((c) => c.type === GAME_LOG_ENTRY_TYPE)
        .map((c) => t.s.records.filterChange(c, v))
        .filter(Boolean);
      expect(wire).toEqual([]);
    }
    // Start's lines too.
    const start = entriesOf(t.startEvent()?.changes);
    expect(start.length).toBeGreaterThan(0);
    expect(start.every((e) => !e.public)).toBe(true);
    // The DM may send one public; a hidden monster stays DM-only.
    t.run(rollInitiative.name, { combatantIds: [g.id], public: true });
    expect(lines()).toEqual([["Goblin", true]]);
    t.run(rollInitiative.name, { combatantIds: [t.byName(enc.id).Wolf?.id], public: true });
    expect(lines()).toEqual([["Wolf", false]]);
    // PCs unchanged: the category setting.
    t.run(rollInitiative.name, { combatantIds: [t.byName(enc.id).Mira?.id] });
    expect(lines()).toEqual([["Mira", true]]);
  });
});
