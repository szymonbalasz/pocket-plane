// character-sheet-full commands on in-memory services (CHARX §13 integration): lifecycle, per-field
// edit, rows, counters, owner change, hooks, rolls, the permission matrix, rollback and crash.
import { describe, expect, test } from "bun:test";
import { CHARX_INTENTS, CREATURE_SHEET_TYPE } from "@shared/character-sheet/sheet";
import { GAME_LOG_ENTRY_TYPE } from "@shared/dice-roll-log/schemas";
import { ENTITY_TYPE, type EntityRecord, REDACTED_CHARACTER_KEYS } from "@shared/entities/schemas";
import { TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { asc, eq, sql } from "drizzle-orm";
import { armCrashHook } from "../../commands/crash";
import { CommandError } from "../../commands/errors";
import { creatureSheet, entity, eventLog, gameLogEntry, roll, scene } from "../../db/schema";
import type { Actor, DispatchedEvent, RecordChange } from "../../events/types";
import type { Viewer } from "../../ws/records";
import { diceServices, seedDice } from "../dice-roll-log/testing";
import { createEntity } from "../entities/commands";
import { goblinBlock } from "../entities/testing";
import { placeToken } from "../scenes-map/commands";
import { OPEN_DRAFT_MESSAGE } from "./lifecycle";
import { toSheetRecord } from "./sheet-rows";

const I = CHARX_INTENTS;

function setup(seed = "charx") {
  const { s } = diceServices(seed);
  const t = seedDice(s);
  const events: DispatchedEvent[] = [];
  s.bus.subscribe("test-capture", (e) => {
    events.push(e);
  });
  const run = <R = Record<string, unknown>>(name: string, input: unknown, actor: Actor = t.dm) =>
    s.commands.run(name, input, { actor }) as R;
  const elite = run<{ id: string }>(createEntity.name, {
    kind: "monster",
    name: "Elite",
    statBlock: { ...goblinBlock, cr: "1/2" },
  }).id;
  events.length = 0;
  const fail = (fn: () => unknown): CommandError => {
    try {
      fn();
    } catch (e) {
      if (e instanceof CommandError) return e;
      throw e;
    }
    throw new Error("expected a CommandError");
  };
  const ent = (id: string) => {
    const row = s.db.select().from(entity).where(eq(entity.id, id)).get();
    return row as unknown as EntityRecord & { statBlock: Record<string, unknown> };
  };
  const sheet = (id: string) => {
    const row = s.db.select().from(creatureSheet).where(eq(creatureSheet.entityId, id)).get();
    return row ? toSheetRecord(row) : null;
  };
  const logCount = () => s.db.select().from(eventLog).all().length;
  const create = (name: string, actor: Actor = t.p1Actor, extra: object = {}) =>
    run<{ characterId: string }>(I.create, { name, ...extra }, actor).characterId;
  return { s, t, events, run, fail, ent, sheet, logCount, create, elite };
}

const types = (changes: RecordChange[]) => changes.map((c) => c.type);

describe("FR-CHARX-08 char.create", () => {
  test("FR-CHARX-08 FR-CHARX-09 player: own draft, starting block, entity + sheet + event in one tx, IDs from ctx", () => {
    const t = setup();
    const id = t.create("Brin");
    const e = t.ent(id);
    expect(e).toMatchObject({
      kind: "character",
      name: "Brin",
      ownerPlayerId: t.t.p1.id,
      hpCurrent: 1,
    });
    expect(e.statBlock).toEqual({
      size: "medium",
      ac: 10,
      hpMax: 1,
      initBonus: 0,
      attacks: [],
      abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
      level: 1,
      className: "",
    });
    expect(t.sheet(id)).toMatchObject({ status: "draft", locked: false, ownerPlayerId: t.t.p1.id });
    expect(t.events.map((x) => x.event.type)).toEqual(["CharacterCreated"]);
    const ev = t.events[0]?.event;
    expect(ev?.payload).toEqual({ characterId: id, ownerPlayerId: t.t.p1.id, status: "draft" });
    expect(types(ev?.changes ?? [])).toEqual([ENTITY_TYPE, CREATURE_SHEET_TYPE]);
    // Same seed → same IDs (ctx.ids, AGENTS §9.3).
    expect(setup().create("Brin")).toBe(id);
    // The link token is never stored on the character (FR-CHARX-09).
    expect(JSON.stringify(e)).not.toContain("linkToken");
  });

  test("FR-CHARX-08 one open draft per player → conflict; after approval a new one is fine", () => {
    const t = setup();
    const id = t.create("Brin");
    const n = t.logCount();
    const err = t.fail(() => t.create("Brin Two"));
    expect([err.code, err.message]).toEqual(["conflict", OPEN_DRAFT_MESSAGE]);
    expect(t.logCount()).toBe(n);
    // Another player is not blocked.
    t.create("Tess", t.t.p2Actor);
    t.run(I.approve, { characterId: id });
    t.create("Brin Two");
  });

  test("FR-CHARX-08 player ownerPlayerId / draft → invalid; DM needs an owner, ready by default or draft", () => {
    const t = setup();
    for (const extra of [{ ownerPlayerId: t.t.p1.id }, { draft: false }]) {
      expect(t.fail(() => t.create("Brin", t.t.p1Actor, extra)).code).toBe("invalid");
    }
    expect(t.fail(() => t.create("Kell", t.t.dm)).code).toBe("invalid");
    const kell = t.create("Kell", t.t.dm, { ownerPlayerId: t.t.p2.id });
    expect(t.sheet(kell)?.status).toBe("ready");
    const dr = t.create("Dru", t.t.dm, { ownerPlayerId: t.t.p2.id, draft: true });
    expect(t.sheet(dr)?.status).toBe("draft");
    // Owner from another campaign; duplicate name (FR-ENT-08) → nothing written.
    const n = t.logCount();
    expect(t.fail(() => t.create("Zed", t.t.dm, { ownerPlayerId: "nope" })).code).toBe("invalid");
    expect(t.fail(() => t.create("mira", t.t.dm, { ownerPlayerId: t.t.p2.id })).code).toBe(
      "conflict",
    );
    expect(t.logCount()).toBe(n);
    expect(t.s.db.select().from(creatureSheet).all()).toHaveLength(2);
  });
});

describe("FR-CHARX-10 FR-CHARX-12 approve and lock", () => {
  test("FR-CHARX-10 approve: draft → ready + event; again (or MVP row-less) → success, no event", () => {
    const t = setup();
    const id = t.create("Brin");
    t.events.length = 0;
    t.run(I.approve, { characterId: id });
    expect(t.sheet(id)?.status).toBe("ready");
    t.run(I.approve, { characterId: id });
    t.run(I.approve, { characterId: t.t.miraId });
    expect(t.events.map((e) => e.event.type)).toEqual(["CharacterApproved"]);
    expect(t.events[0]?.event.payload).toEqual({ characterId: id });
    expect(t.sheet(t.t.miraId)).toBeNull();
  });

  test("FR-CHARX-12 locked: player edits forbidden; rolls, HP, counters stay; DM never locked out", () => {
    const t = setup();
    t.run(I.setLock, { characterId: t.t.miraId, locked: true });
    t.run(I.setLock, { characterId: t.t.miraId, locked: true });
    expect(t.events.map((e) => e.event.type)).toEqual(["CharacterLockSet"]);
    const p1 = t.t.p1Actor;
    for (const [name, input] of [
      [I.edit, { creatureId: t.t.miraId, set: { ac: 18 } }],
      [I.putRow, { creatureId: t.t.miraId, list: "items", row: { name: "Rope" } }],
      [I.moveRow, { creatureId: t.t.miraId, list: "attacks", rowId: "x", toIndex: 0 }],
    ] as const) {
      const err = t.fail(() => t.run(name, input, p1));
      expect([err.code, err.message]).toEqual(["forbidden", "Locked by the DM"]);
    }
    t.run("char.roll", { characterId: t.t.miraId, kind: "initiative" }, p1);
    t.run("char.adjustHp", { characterId: t.t.miraId, delta: -2 }, p1);
    t.run(I.useResource, { characterId: t.t.miraId, resource: { slot: 1 }, delta: 1 }, p1);
    t.run(I.edit, { creatureId: t.t.miraId, set: { ac: 18 } });
    expect(t.ent(t.t.miraId).statBlock.ac).toBe(18);
    t.run(I.setLock, { characterId: t.t.miraId, locked: false });
    t.run(I.edit, { creatureId: t.t.miraId, set: { ac: 17 } }, p1);
    expect(t.ent(t.t.miraId).statBlock.ac).toBe(17);
  });
});

describe("FR-CHARX-15 char.edit", () => {
  test("FR-CHARX-15 per-field set: stat block + sheet fields, one event listing keys only", () => {
    const t = setup();
    t.run(
      I.edit,
      {
        creatureId: t.t.miraId,
        set: { species: "Human", ac: 17, skills: { athletics: "proficient" }, notes: "N-1" },
      },
      t.t.p1Actor,
    );
    const e = t.ent(t.t.miraId);
    expect(e.statBlock).toMatchObject({
      species: "Human",
      ac: 17,
      skills: { athletics: "proficient" },
    });
    // Untouched fields stay (per-field merge).
    expect(e.statBlock).toMatchObject({ hpMax: 12, initBonus: 2, speed: 30 });
    expect(t.sheet(t.t.miraId)).toMatchObject({ notes: "N-1", status: "ready" });
    const ev = t.events[0]?.event;
    expect(ev?.payload).toEqual({
      creatureId: t.t.miraId,
      op: "set",
      fields: ["species", "ac", "skills", "notes"],
    });
    expect(types(ev?.changes ?? []).sort()).toEqual([CREATURE_SHEET_TYPE, ENTITY_TYPE]);
    expect(JSON.stringify(ev?.payload)).not.toContain("N-1");
    // Nothing changed → success, no event.
    t.run(I.edit, { creatureId: t.t.miraId, set: { ac: 17, notes: "N-1" } }, t.t.p1Actor);
    expect(t.events).toHaveLength(1);
    // null clears an optional field.
    t.run(I.edit, { creatureId: t.t.miraId, set: { species: null, speed: null } });
    expect(t.ent(t.t.miraId).statBlock).not.toHaveProperty("species");
    expect(t.ent(t.t.miraId).statBlock).not.toHaveProperty("speed");
  });

  test("FR-CHARX-15 HP max: draft follows; full follows; wounded keeps; lower clamps", () => {
    const t = setup();
    const brin = t.create("Brin");
    const hp = (id: string) => t.ent(id).hpCurrent;
    const max = (id: string, hpMax: number) => t.run(I.edit, { creatureId: id, set: { hpMax } });
    max(brin, 9);
    expect(hp(brin)).toBe(9);
    t.run("char.adjustHp", { characterId: brin, delta: -4 });
    max(brin, 11);
    expect(hp(brin)).toBe(11); // a draft always follows
    const thorn = t.t.thornId; // ready, 10 / 10
    max(thorn, 12);
    expect(hp(thorn)).toBe(12);
    t.run("char.adjustHp", { characterId: thorn, delta: -5 });
    max(thorn, 14);
    expect(hp(thorn)).toBe(7);
    max(thorn, 6);
    expect(hp(thorn)).toBe(6);
    max(thorn, 10);
    expect(hp(thorn)).toBe(10); // 6 / 6 is full HP: it follows
  });

  test("FR-CHARX-04 classes write level + className; level / className with classes → invalid", () => {
    const t = setup();
    t.run(I.edit, {
      creatureId: t.t.miraId,
      set: {
        classes: [
          { name: "Fighter", level: 3, hitDie: "d10" },
          { name: "Wizard", level: 2, hitDie: "d6" },
        ],
      },
    });
    expect(t.ent(t.t.miraId).statBlock).toMatchObject({ level: 5, className: "Fighter/Wizard" });
    expect(t.fail(() => t.run(I.edit, { creatureId: t.t.miraId, set: { level: 2 } })).code).toBe(
      "invalid",
    );
    const big = [
      { name: "Fighter", level: 20, hitDie: "d10" },
      { name: "Rogue", level: 1, hitDie: "d8" },
    ];
    expect(
      t.fail(() => t.run(I.edit, { creatureId: t.t.miraId, set: { classes: big } })).code,
    ).toBe("invalid");
    t.run(I.edit, {
      creatureId: t.t.miraId,
      set: { classes: null, level: 4, className: "Knight" },
    });
    expect(t.ent(t.t.miraId).statBlock).toMatchObject({ level: 4, className: "Knight" });
  });

  test("FR-CHARX-15 kind and role rules: DM-only keys, CR vs classes, needs-abilities → rejected, no change", () => {
    const t = setup();
    const n = t.logCount();
    const p1 = t.t.p1Actor;
    for (const set of [
      { ownerPlayerId: t.t.p2.id },
      { size: "large" },
      { portraitAssetId: null },
    ]) {
      expect(t.fail(() => t.run(I.edit, { creatureId: t.t.miraId, set }, p1)).code).toBe(
        "forbidden",
      );
    }
    expect(t.fail(() => t.run(I.edit, { creatureId: t.t.miraId, set: { cr: "1" } })).code).toBe(
      "invalid",
    );
    for (const set of [{ species: "Orc" }, { classes: [{ name: "X", level: 1, hitDie: "d6" }] }]) {
      expect(t.fail(() => t.run(I.edit, { creatureId: t.elite, set })).code).toBe("invalid");
    }
    const noScores = t.fail(() =>
      t.run(I.edit, { creatureId: t.t.miraId, set: { abilities: null } }),
    );
    expect(noScores.code).toBe("invalid");
    expect(noScores.issues?.[0]?.path).toEqual(["set", "saveProficiencies"]);
    // A taken name (FR-ENT-08).
    expect(
      t.fail(() => t.run(I.edit, { creatureId: t.t.miraId, set: { name: "Thorn" } }, p1)).code,
    ).toBe("conflict");
    expect(t.logCount()).toBe(n);
    expect(t.sheet(t.t.miraId)).toBeNull();
  });

  test("FR-CHARX-15 concurrent DM + player edits of different fields both survive (per-field merge)", () => {
    const t = setup();
    // Both clients loaded the same committed sheet; their intents commit one after the other.
    t.run(I.edit, { creatureId: t.t.miraId, set: { ac: 15, notes: "DM note" } });
    t.run(
      I.edit,
      { creatureId: t.t.miraId, set: { hpMax: 10, background: "Sailor" } },
      t.t.p1Actor,
    );
    expect(t.ent(t.t.miraId).statBlock).toMatchObject({ ac: 15, hpMax: 10 });
    expect(t.sheet(t.t.miraId)).toMatchObject({ notes: "DM note", background: "Sailor" });
    // Same field: last commit wins.
    t.run(I.edit, { creatureId: t.t.miraId, set: { ac: 14 } }, t.t.p1Actor);
    t.run(I.edit, { creatureId: t.t.miraId, set: { ac: 16 } });
    expect(t.ent(t.t.miraId).statBlock.ac).toBe(16);
  });

  test("FR-ENT-19 size / speed edits refresh token copies in the same event", () => {
    const t = setup();
    const sceneId = t.s.db
      .select()
      .from(scene)
      .where(eq(scene.campaignId, t.t.campaignId))
      .get()?.id;
    const { tokenId } = t.s.commands.run(
      placeToken,
      { sceneId: sceneId as string, definitionId: t.t.miraId, col: 2, row: 2 },
      { actor: t.t.dm },
    );
    t.events.length = 0;
    t.run(I.edit, { creatureId: t.t.miraId, set: { size: "large", speed: 25 } });
    const ev = t.events[0]?.event;
    const tok = ev?.changes.find((c) => c.type === TOKEN_TYPE);
    expect(tok?.id).toBe(tokenId);
    expect(tok?.after).toMatchObject({ size: "large", speed: 25 });
  });

  test("FR-CHARX-39 rollback: a failing stat-block write leaves the sheet write undone", () => {
    const t = setup();
    const n = t.logCount();
    const err = t.fail(() =>
      t.run(I.edit, { creatureId: t.t.miraId, set: { notes: "LOST", ownerPlayerId: "nope" } }),
    );
    expect(err.code).toBe("invalid");
    expect(t.sheet(t.t.miraId)).toBeNull();
    expect(t.logCount()).toBe(n);
    expect(t.events).toHaveLength(0);
  });
});

describe("FR-CHARX-16 rows", () => {
  test("FR-CHARX-16 putRow create / replace / unknown / limit; legacy attack gets an id", () => {
    const t = setup();
    const put = (list: string, row: object, actor: Actor = t.t.p1Actor) =>
      t.run<{ rowId: string }>(I.putRow, { creatureId: t.t.miraId, list, row }, actor).rowId;
    const lc = put("attacks", { name: "Light crossbow", toHit: 4, damage: "1d8+2" });
    const attacks = t.ent(t.t.miraId).statBlock.attacks as { id: string; name: string }[];
    expect(attacks.map((a) => a.name)).toEqual(["Shortsword", "Light crossbow"]);
    expect(attacks[1]?.id).toBe(lc);
    expect(typeof attacks[0]?.id).toBe("string");
    put("attacks", { id: lc, name: "Heavy crossbow", toHit: 4, damage: "1d10+2" });
    expect((t.ent(t.t.miraId).statBlock.attacks as { name: string }[])[1]?.name).toBe(
      "Heavy crossbow",
    );
    const gone = t.fail(() => put("items", { id: "nope", name: "Rope" }));
    expect([gone.code, gone.message]).toEqual(["not_found", "Row was deleted"]);
    for (let i = 2; i < 20; i++) put("attacks", { name: `A${i}`, toHit: 1, damage: "1d4" });
    expect(t.fail(() => put("attacks", { name: "A21", toHit: 1, damage: "1d4" })).code).toBe(
      "conflict",
    );
    const ev = t.events.find((e) => e.event.type === "CharacterSheetEdited")?.event;
    expect(ev?.payload).toEqual({
      creatureId: t.t.miraId,
      op: "putRow",
      list: "attacks",
      rowId: lc,
    });
  });

  test("FR-CHARX-16 feature used is a counter: kept on replace, clamped to new uses", () => {
    const t = setup();
    const f = t.run<{ rowId: string }>(I.putRow, {
      creatureId: t.t.miraId,
      list: "features",
      row: { name: "Rage", usesMax: 3, used: 3 },
    }).rowId;
    expect(t.sheet(t.t.miraId)?.features[0]?.used).toBe(0);
    t.run(I.useResource, { characterId: t.t.miraId, resource: { feature: f }, delta: 3 });
    t.run(I.putRow, {
      creatureId: t.t.miraId,
      list: "features",
      row: { id: f, name: "Rage", usesMax: 2, used: 0 },
    });
    expect(t.sheet(t.t.miraId)?.features[0]).toMatchObject({ usesMax: 2, used: 2 });
  });

  test("FR-CHARX-16 deleteRow / moveRow: clamped index; unknown → not_found", () => {
    const t = setup();
    const ids = ["A", "B", "C"].map(
      (name) =>
        t.run<{ rowId: string }>(I.putRow, {
          creatureId: t.t.miraId,
          list: "items",
          row: { name },
        }).rowId,
    );
    const names = () => t.sheet(t.t.miraId)?.items.map((i) => i.name);
    t.run(I.moveRow, { creatureId: t.t.miraId, list: "items", rowId: ids[0], toIndex: 99 });
    expect(names()).toEqual(["B", "C", "A"]);
    t.run(I.moveRow, { creatureId: t.t.miraId, list: "items", rowId: ids[0], toIndex: 0 });
    expect(names()).toEqual(["A", "B", "C"]);
    t.run(I.deleteRow, { creatureId: t.t.miraId, list: "items", rowId: ids[1] });
    expect(names()).toEqual(["A", "C"]);
    expect(
      t.fail(() => t.run(I.deleteRow, { creatureId: t.t.miraId, list: "items", rowId: ids[1] }))
        .code,
    ).toBe("not_found");
    expect(t.events.at(-1)?.event.payload).toEqual({
      creatureId: t.t.miraId,
      op: "deleteRow",
      list: "items",
      rowId: ids[1],
    });
  });

  test("FR-CHARX-03 a sheet over 48 KB → invalid Sheet is full, nothing written", () => {
    const t = setup();
    const fill = (n: number) => "x".repeat(n);
    const put = (list: string, row: object) =>
      t.run(I.putRow, { creatureId: t.t.miraId, list, row });
    for (let i = 0; i < 30; i++) {
      put("features", { name: fill(60), source: fill(40), text: fill(600) });
    }
    for (let i = 0; i < 40; i++) put("spells", { name: fill(60), level: 1, notes: fill(200) });
    let err: CommandError | null = null;
    for (let i = 0; i < 80 && !err; i++) {
      try {
        put("items", { name: fill(60), notes: fill(120) });
      } catch (e) {
        err = e as CommandError;
      }
    }
    expect([err?.code, err?.message]).toEqual(["invalid", "Sheet is full"]);
    const stored = t.sheet(t.t.miraId);
    expect(new TextEncoder().encode(JSON.stringify(stored)).length).toBeLessThanOrEqual(48 * 1024);
  });
});

describe("FR-CHARX-17 counters", () => {
  test("FR-CHARX-17 slots, hit dice, features: deltas clamp; reset; unchanged → no event", () => {
    const t = setup();
    t.run(I.edit, {
      creatureId: t.t.miraId,
      set: {
        spellcasting: { ability: "wis", slots: { "1": 2 } },
        classes: [{ name: "Fighter", level: 1, hitDie: "d10" }],
      },
    });
    t.events.length = 0;
    const use = (resource: object, op: object) =>
      t.run<{ before: number; after: number }>(
        I.useResource,
        { characterId: t.t.miraId, resource, ...op },
        t.t.p1Actor,
      );
    expect(use({ slot: 1 }, { delta: 1 })).toEqual({ before: 0, after: 1 });
    expect(use({ slot: 1 }, { delta: 5 })).toEqual({ before: 1, after: 2 });
    expect(use({ slot: 1 }, { delta: 1 })).toEqual({ before: 2, after: 2 });
    expect(use({ slot: 2 }, { delta: 1 })).toEqual({ before: 0, after: 0 });
    expect(use({ hitDie: "d10" }, { delta: 1 })).toEqual({ before: 0, after: 1 });
    expect(use({ slot: 1 }, { reset: true })).toEqual({ before: 2, after: 0 });
    expect(t.fail(() => use({ feature: "nope" }, { delta: 1 })).code).toBe("not_found");
    expect(t.events.map((e) => e.event.payload)).toEqual([
      { characterId: t.t.miraId, resource: { slot: 1 }, before: 0, after: 1 },
      { characterId: t.t.miraId, resource: { slot: 1 }, before: 1, after: 2 },
      { characterId: t.t.miraId, resource: { hitDie: "d10" }, before: 0, after: 1 },
      { characterId: t.t.miraId, resource: { slot: 1 }, before: 2, after: 0 },
    ]);
    expect(t.sheet(t.t.miraId)?.hitDiceUsed).toEqual({ d10: 1 });
    // NPC definitions have no counters.
    const err = t.fail(() =>
      t.run(I.useResource, { characterId: t.elite, resource: { slot: 1 }, delta: 1 }),
    );
    expect([err.code, err.message]).toEqual(["invalid", "No counters on NPC definitions"]);
  });

  test("FR-CHARX-17 lowering a maximum (edit or PUT) clamps used in the same transaction", () => {
    const t = setup();
    t.run(I.edit, {
      creatureId: t.t.miraId,
      set: { spellcasting: { ability: "wis", slots: { "1": 3 } } },
    });
    t.run(I.useResource, { characterId: t.t.miraId, resource: { slot: 1 }, delta: 3 });
    t.events.length = 0;
    t.run(I.edit, {
      creatureId: t.t.miraId,
      set: { spellcasting: { ability: "wis", slots: { "1": 1 } } },
    });
    expect(t.sheet(t.t.miraId)?.slotsUsed).toEqual({ "1": 1 });
    expect(types(t.events[0]?.event.changes ?? []).sort()).toEqual([
      CREATURE_SHEET_TYPE,
      ENTITY_TYPE,
    ]);
    // entities' PUT (creature form): sheet data kept, the hook clamps.
    const m = t.ent(t.t.miraId);
    t.run("entities.update", {
      id: m.id,
      name: m.name,
      ownerPlayerId: m.ownerPlayerId,
      statBlock: { ...m.statBlock, spellcasting: undefined },
    });
    const sh = t.sheet(t.t.miraId);
    expect(sh?.slotsUsed).toEqual({});
    expect(t.events.at(-1)?.event.changes.map((c) => c.type)).toContain(CREATURE_SHEET_TYPE);
  });
});

describe("FR-CHARX-13 owner change", () => {
  test("FR-CHARX-13 FR-CHARX-37 DM reassigns: sheet copy follows; old owner gets entity redacted + sheet delete", () => {
    const t = setup();
    t.run(I.edit, { creatureId: t.t.miraId, set: { notes: "MIRA-NOTE" } });
    t.events.length = 0;
    t.run(I.edit, { creatureId: t.t.miraId, set: { ownerPlayerId: t.t.p2.id } });
    expect(t.sheet(t.t.miraId)?.ownerPlayerId).toBe(t.t.p2.id);
    const ev = t.events[0]?.event;
    expect(types(ev?.changes ?? []).sort()).toEqual([CREATURE_SHEET_TYPE, ENTITY_TYPE]);
    const wire = (v: Viewer) =>
      Object.fromEntries((ev?.changes ?? []).map((c) => [c.type, t.s.records.filterChange(c, v)]));
    const old = wire(t.t.viewer("player", t.t.p1.id));
    expect(old[CREATURE_SHEET_TYPE]).toEqual({
      type: CREATURE_SHEET_TYPE,
      id: t.t.miraId,
      op: "delete",
    });
    expect(Object.keys(old[ENTITY_TYPE]?.data as object).sort()).toEqual(
      [...REDACTED_CHARACTER_KEYS].sort(),
    );
    const neu = wire(t.t.viewer("player", t.t.p2.id));
    expect(neu[CREATURE_SHEET_TYPE]).toMatchObject({ op: "upsert", data: { notes: "MIRA-NOTE" } });
    expect(neu[ENTITY_TYPE]?.data).toHaveProperty("statBlock");
    // entities' PUT also moves the copy (hook).
    const m = t.ent(t.t.miraId);
    t.run("entities.update", {
      id: m.id,
      name: m.name,
      ownerPlayerId: t.t.p1.id,
      statBlock: m.statBlock,
    });
    expect(t.sheet(t.t.miraId)?.ownerPlayerId).toBe(t.t.p1.id);
    expect(t.sheet(t.t.miraId)?.notes).toBe("MIRA-NOTE");
  });
});

describe("FR-CHARX-18 permission matrix (CHARX §10)", () => {
  type Code = "ok" | "forbidden" | "not_found" | "invalid";
  test("FR-CHARX-18 DM / owner / other player × character / draft / locked / custom NPC / imported / other campaign × every intent", () => {
    const t = setup();
    const brin = t.create("Brin"); // p1's draft
    const lockie = t.create("Lockie", t.t.dm, { ownerPlayerId: t.t.p1.id });
    t.run(I.setLock, { characterId: lockie, locked: true });
    const targets = {
      character: t.t.miraId,
      draft: brin,
      locked: lockie,
      npc: t.elite,
      imported: t.t.goblinId,
      other: t.t.strangerId,
    };
    // One item row per editable target for move / delete.
    const rows: Record<string, string> = {};
    for (const [k, id] of Object.entries(targets)) {
      if (k === "imported" || k === "other") continue;
      rows[k] = t.run<{ rowId: string }>(I.putRow, {
        creatureId: id,
        list: "items",
        row: { name: "Rope" },
      }).rowId;
    }
    let n = 0;
    const intents: Record<string, (id: string, k: string) => [string, unknown]> = {
      edit: (id) => [I.edit, { creatureId: id, set: { notes: `n${n++}` } }],
      putRow: (id) => [I.putRow, { creatureId: id, list: "items", row: { name: `R${n++}` } }],
      moveRow: (id, k) => [
        I.moveRow,
        { creatureId: id, list: "items", rowId: rows[k] ?? "x", toIndex: 0 },
      ],
      useResource: (id) => [I.useResource, { characterId: id, resource: { slot: 1 }, delta: 1 }],
      roll: (id) => ["char.roll", { characterId: id, kind: "initiative" }],
      approve: (id) => [I.approve, { characterId: id }],
      setLock: (id, k) => [I.setLock, { characterId: id, locked: k === "locked" }],
    };
    const F = "forbidden";
    const N = "not_found";
    // Rows: character, draft, locked, npc, imported, other.
    const expected: Record<string, Record<string, Code[]>> = {
      dm: {
        edit: ["ok", "ok", "ok", "ok", F, N],
        putRow: ["ok", "ok", "ok", "ok", F, N],
        moveRow: ["ok", "ok", "ok", "ok", F, N],
        useResource: ["ok", "ok", "ok", "invalid", F, N],
        roll: ["ok", "ok", "ok", "ok", "ok", N],
        approve: ["ok", "ok", "ok", N, N, N],
        setLock: ["ok", "ok", "ok", N, N, N],
      },
      owner: {
        edit: ["ok", "ok", F, N, N, N],
        putRow: ["ok", "ok", F, N, N, N],
        moveRow: ["ok", "ok", F, N, N, N],
        useResource: ["ok", "ok", "ok", N, N, N],
        roll: ["ok", "ok", "ok", N, N, N],
        approve: [F, F, F, F, F, F],
        setLock: [F, F, F, F, F, F],
      },
      other: {
        edit: [F, F, F, N, N, N],
        putRow: [F, F, F, N, N, N],
        moveRow: [F, F, F, N, N, N],
        useResource: [F, F, F, N, N, N],
        roll: [F, F, F, N, N, N],
        approve: [F, F, F, F, F, F],
        setLock: [F, F, F, F, F, F],
      },
    };
    const actors: Record<string, Actor> = { dm: t.t.dm, owner: t.t.p1Actor, other: t.t.p2Actor };
    const got: Record<string, Record<string, Code[]>> = {};
    for (const [who, actor] of Object.entries(actors)) {
      got[who] = {};
      for (const [intent, make] of Object.entries(intents)) {
        got[who][intent] = Object.entries(targets).map(([k, id]) => {
          const [name, input] = make(id, k);
          const before = t.logCount();
          try {
            t.s.commands.run(name, input, { actor });
            return "ok";
          } catch (e) {
            if (!(e instanceof CommandError)) throw e;
            // FR-CHARX-18: a failure changes nothing and logs nothing.
            expect(t.logCount()).toBe(before);
            return e.code as Code;
          }
        });
      }
    }
    expect(got).toEqual(expected);
  });

  test("FR-CHARX-22 DM roll on a definition: DM-only entry; `public` → invalid", () => {
    const t = setup();
    t.run("char.roll", { characterId: t.elite, kind: "skill", skill: "stealth" });
    const [e] = t.s.db.select().from(gameLogEntry).all();
    expect(e).toMatchObject({ actorName: "Elite", public: false, category: "skill-check" });
    for (const pub of [true, false]) {
      const err = t.fail(() =>
        t.run("char.roll", { characterId: t.t.goblinId, kind: "initiative", public: pub }),
      );
      expect(err.code).toBe("invalid");
    }
    // A player-sent `public` stays forbidden (FR-CHAR-17).
    expect(
      t.fail(() =>
        t.run(
          "char.roll",
          { characterId: t.t.miraId, kind: "initiative", public: true },
          t.t.p1Actor,
        ),
      ).code,
    ).toBe("forbidden");
  });
});

describe("FR-CHARX-20 FR-CHARX-21 char.roll kinds", () => {
  function sela() {
    const t = setup();
    const id = t.create("Sela", t.t.p2Actor);
    t.run(I.edit, {
      creatureId: id,
      set: {
        abilities: { str: 10, dex: 10, con: 14, int: 10, wis: 16, cha: 10 },
        skills: { medicine: "proficient" },
        spellcasting: { ability: "wis", slots: { "1": 2 } },
        hpMax: 10,
      },
    });
    const spell = (row: object) =>
      t.run<{ rowId: string }>(I.putRow, { creatureId: id, list: "spells", row }).rowId;
    const sf = spell({
      name: "Sacred Flame",
      level: 0,
      roll: "save",
      saveAbility: "dex",
      damage: "1d8",
      damageType: "radiant",
    });
    const gb = spell({
      name: "Guiding Bolt",
      level: 1,
      roll: "attack",
      damage: "4d6",
      damageType: "radiant",
    });
    const sh = spell({ name: "Shield", level: 1 });
    t.s.db.delete(roll).run();
    return { ...t, id, sf, gb, sh };
  }
  const lastRolls = (t: ReturnType<typeof setup>) =>
    t.s.db
      .select()
      .from(roll)
      .orderBy(asc(sql`rowid`))
      .all()
      .map((r) => [r.expression, r.category, r.label, r.mode]);

  test("FR-CHARX-21 skill, spellAttack (one entry, 2 rolls), spellDamage with DC; payload refs", () => {
    const t = sela();
    const p2 = t.t.p2Actor;
    t.run(
      "char.roll",
      { characterId: t.id, kind: "skill", skill: "medicine", mode: "advantage" },
      p2,
    );
    t.run("char.roll", { characterId: t.id, kind: "spellAttack", spellId: t.gb }, p2);
    t.run("char.roll", { characterId: t.id, kind: "spellDamage", spellId: t.sf }, p2);
    expect(lastRolls(t)).toEqual([
      ["2d20kh1+5", "skill-check", "Medicine check", "advantage"],
      ["1d20+5", "attack", "Guiding Bolt attack", "normal"],
      ["4d6", "damage", "Guiding Bolt damage (radiant)", "normal"],
      ["1d8", "damage", "Sacred Flame damage (radiant), DC 13 DEX", "normal"],
    ]);
    const entries = t.s.db.select().from(gameLogEntry).all();
    expect(entries.map((e) => [e.category, (e.rollIds as string[]).length])).toEqual([
      ["skill-check", 1],
      ["attack", 2],
      ["damage", 1],
    ]);
    const rolled = t.events
      .filter((e) => e.event.type === "CharacterRolled")
      .map((e) => e.event.payload);
    expect(rolled[0]).toMatchObject({ kind: "skill", skill: "medicine" });
    expect(rolled[1]).toMatchObject({ kind: "spellAttack", spellId: t.gb });
    // FR-CHARX-25: rolls never touch counters or HP.
    expect(t.sheet(t.id)?.slotsUsed).toEqual({});
    expect(t.ent(t.id).hpCurrent).toBe(10);
  });

  test("FR-CHARX-21 conflicts and not_found; manual count follows the spell", () => {
    const t = sela();
    const p2 = t.t.p2Actor;
    const r = (p: object) => t.run("char.roll", { characterId: t.id, ...p }, p2);
    const noAttack = t.fail(() => r({ kind: "spellAttack", spellId: t.sh }));
    expect([noAttack.code, noAttack.message]).toEqual(["conflict", "No attack roll for Shield"]);
    expect(t.fail(() => r({ kind: "spellDamage", spellId: t.sh })).code).toBe("conflict");
    expect(t.fail(() => r({ kind: "spellDamage", spellId: "gone" })).code).toBe("not_found");
    expect(t.fail(() => r({ kind: "damage", attackId: "gone" })).code).toBe("not_found");
    const m = { diceTotal: 12 };
    expect(t.fail(() => r({ kind: "spellAttack", spellId: t.gb, manual: [m] })).code).toBe(
      "invalid",
    );
    r({ kind: "spellAttack", spellId: t.gb, manual: [m, { diceTotal: 14 }] });
    expect(t.s.db.select().from(gameLogEntry).all()).toHaveLength(1);
  });

  test("FR-CHARX-20 attack / damage by attackId; absent = the first attack", () => {
    const t = setup();
    const lc = t.run<{ rowId: string }>(I.putRow, {
      creatureId: t.t.miraId,
      list: "attacks",
      row: { name: "Light crossbow", toHit: 4, damage: "1d8+2", damageType: "piercing" },
    }).rowId;
    t.run("char.roll", { characterId: t.t.miraId, kind: "attack", attackId: lc }, t.t.p1Actor);
    t.run("char.roll", { characterId: t.t.miraId, kind: "damage" }, t.t.p1Actor);
    expect(lastRolls(t)).toEqual([
      ["1d20+4", "attack", "Light crossbow attack", "normal"],
      ["1d8+2", "damage", "Light crossbow damage (piercing)", "normal"],
      ["1d6+2", "damage", "Shortsword damage (piercing)", "normal"],
    ]);
    const rolled = t.events
      .filter((e) => e.event.type === "CharacterRolled")
      .map((e) => e.event.payload);
    expect(rolled[0]).toMatchObject({ attackId: lc, attackName: "Light crossbow" });
    expect(rolled[1]).toMatchObject({ kind: "damage", attackName: "Shortsword" });
    expect(t.events.at(-1)?.event.changes.map((c) => c.type)).toEqual([GAME_LOG_ENTRY_TYPE]);
  });
});

describe("FR-CHARX-39 crash", () => {
  class Killed extends Error {}
  test("FR-CHARX-39 hard kill before commit: entity, sheet and log unchanged; after commit: all kept", () => {
    const t = setup();
    t.run(I.edit, { creatureId: t.t.miraId, set: { notes: "BEFORE" } });
    const before = { e: t.ent(t.t.miraId), s: t.sheet(t.t.miraId), n: t.logCount() };
    armCrashHook({ point: "before-commit", target: I.edit }, (w) => {
      throw new Killed(w);
    });
    try {
      const err = t.fail(() =>
        t.run(I.edit, { creatureId: t.t.miraId, set: { notes: "MID", ac: 20, hpMax: 30 } }),
      );
      expect(err.code).toBe("internal");
    } finally {
      armCrashHook(null);
    }
    expect({ e: t.ent(t.t.miraId), s: t.sheet(t.t.miraId), n: t.logCount() }).toEqual(before);
    armCrashHook({ point: "after-commit", target: I.putRow }, (w) => {
      throw new Killed(w);
    });
    try {
      expect(() =>
        t.run(I.putRow, { creatureId: t.t.miraId, list: "items", row: { name: "Rope" } }),
      ).toThrow(Killed);
    } finally {
      armCrashHook(null);
    }
    expect(t.sheet(t.t.miraId)?.items.map((i) => i.name)).toEqual(["Rope"]);
    expect(t.logCount()).toBe(before.n + 1);
  });
});
