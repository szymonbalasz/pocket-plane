// CMP §13 integration (C1) on the `compendium` bundle: `cmp.import` / `cmp.importRecorded`
// (FR-CMP-02–04, 07–09, 31), homebrew `cmp.putEntry` rules (FR-CMP-02, -24), crash seams.
// No network: the bundled source and the mini set are repo files.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import { srdMini } from "@fixtures/srd/open5e";
import { IMPORTED_ENTITY_TYPE } from "@shared/entities/schemas";
import { TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { defineCommand } from "../../commands/commands";
import { seededContext } from "../../commands/context";
import { armCrashHook } from "../../commands/crash";
import { CommandError } from "../../commands/errors";
import { closeDb, openMemoryDb } from "../../db/client";
import {
  asset,
  assetSeqNext,
  campaign,
  compendiumEntry,
  compendiumSource,
  encounter,
  entity,
  scene,
  token,
} from "../../db/schema";
import { readEventLog } from "../../events/log";
import type { Actor, DomainEvent } from "../../events/types";
import { createTestServices, TEST_SECRET } from "../../testing/services";
import { adaptOpen5e } from "./adapter/open5e";
import { NAME_TAKEN, PUT_ENTRY, READ_ONLY_ENTRY } from "./homebrew";
import { END_COMBAT_FIRST, IMPORT, IMPORT_RECORDED, type ImportResult, runImport } from "./import";
import { bundledSource } from "./sources";
import { SRD_51_SOURCE } from "./sources/srd-5.1/source";

const AT = "2026-01-01T00:00:00.000Z";
let bytes: Uint8Array;

beforeAll(async () => {
  globalThis.fetch = (() => {
    throw new Error("No network in tests (FR-CMP-06)");
  }) as unknown as typeof fetch;
  const loaded = await loadBundle("compendium", { testMode: true, dmSecret: TEST_SECRET });
  const db = loaded.openDb();
  db.$client.run("PRAGMA journal_mode = DELETE");
  bytes = db.$client.serialize();
  closeDb(db);
  try {
    loaded.cleanup();
  } catch {
    // Windows may hold the temp dir a moment longer.
  }
}, 60_000);

afterAll(() => armCrashHook(null));

/** A fresh in-memory copy of the loaded bundle, with event capture. */
function fresh() {
  const s = createTestServices({ db: openMemoryDb(bytes) });
  const events: DomainEvent[] = [];
  s.bus.subscribe("test-capture", ({ event }) => {
    events.push(event);
  });
  const camps = Object.fromEntries(
    s.db
      .select()
      .from(campaign)
      .all()
      .map((c) => [c.name, c.id]),
  ) as Record<string, string>;
  const fixtureCid = camps["Fixture Campaign"] as string;
  const secondCid = camps["Second Campaign"] as string;
  const dm = (campaignId: string | null = fixtureCid): Actor => ({
    role: "dm",
    playerId: null,
    campaignId,
  });
  let n = 0;
  const run = <R>(name: string, input: unknown, actor = dm()) =>
    s.commands.run(name, input, {
      actor,
      ctx: seededContext({ disposable: true, key: `cmp-test-${n++}` }),
    }) as R;
  const recorded = (responses: unknown, version = "mini") =>
    run<ImportResult>(IMPORT_RECORDED, { source: { ...SRD_51_SOURCE }, version, responses });
  const changes = () =>
    s.db.$client.query<{ n: number }, []>("SELECT total_changes() AS n").get()?.n;
  const entries = () => s.db.select().from(compendiumEntry).all();
  const imported = () => entries().filter((e) => e.campaignId === null);
  const entry = (sourceKey: string) => imported().find((e) => e.sourceKey === sourceKey);
  const def = (id: string) => s.db.select().from(entity).where(eq(entity.id, id)).get();
  return {
    s,
    events,
    fixtureCid,
    secondCid,
    dm,
    run,
    recorded,
    changes,
    entries,
    imported,
    entry,
    def,
  };
}

/** The mini set with the goblin grown to Medium (definition + entry change). */
function editedMini() {
  const edited = structuredClone(srdMini) as { monsters: Record<string, unknown>[] };
  const g = edited.monsters.find((m) => m.slug === "goblin");
  if (!g) throw new Error("mini goblin missing");
  g.size = "Medium";
  return edited;
}

/** A definition row's stat block (size, senses). */
const block = (row: { statBlock: unknown } | undefined) =>
  (row?.statBlock ?? {}) as { size?: string; senses?: { darkvisionFt: number } };

function errorOf(fn: () => unknown): CommandError {
  try {
    fn();
  } catch (e) {
    if (e instanceof CommandError) return e;
    throw e;
  }
  throw new Error("expected a CommandError");
}

/** A goblin token of the SRD goblin in a campaign (a scene on a fresh map asset first). */
function placeGoblin(t: ReturnType<typeof fresh>, cid: string, goblinId: string) {
  const mapId = `map_${cid.slice(0, 18)}`.padEnd(22, "a").slice(0, 22);
  t.s.db
    .insert(asset)
    .values({
      id: mapId,
      campaignId: cid,
      seq: assetSeqNext,
      name: "map",
      hash: `hash-${mapId}`,
      mime: "image/png",
      bytes: 100,
      width: 700,
      height: 700,
      displayWidth: 700,
      displayHeight: 700,
      createdAt: AT,
    })
    .run();
  const sc = t.run<{ id: string }>(
    "map.createScene",
    { name: `Lair ${cid}`, mapAssetId: mapId },
    t.dm(cid),
  );
  t.run("map.placeToken", { sceneId: sc.id, definitionId: goblinId, col: 1, row: 1 }, t.dm(cid));
  return t.s.db
    .select()
    .from(token)
    .where(and(eq(token.sceneId, sc.id), eq(token.definitionId, goblinId)))
    .get();
}

describe("FR-CMP-02 FR-CMP-03 FR-CMP-04 imported entries and source (cmp-srd-mini)", () => {
  test("FR-CMP-02 FR-CMP-03 imported: global, read-only provenance; a monster links its definition (same source, sourceKey)", () => {
    const t = fresh();
    const goblin = t.entry("monster/goblin");
    expect(goblin).toMatchObject({
      campaignId: null,
      kind: "monster",
      source: "srd-5.1",
      name: "Goblin",
      nameKey: "goblin",
      line: "CR 1/4 · Small humanoid",
      shared: false,
    });
    const d = t.def(goblin?.definitionId as string);
    expect(d).toMatchObject({
      campaignId: null,
      kind: "monster",
      source: "srd-5.1",
      sourceKey: "monster/goblin",
      licence: "CC BY 4.0",
    });
    expect(block(d).senses?.darkvisionFt).toBe(60);
    // Monster entries only hold reference text: Nimble Escape is a trait, not in the definition.
    expect(JSON.stringify(goblin?.body)).toContain("Nimble Escape");
    expect(JSON.stringify(d?.statBlock)).not.toContain("Nimble Escape");
    for (const e of t.imported()) {
      expect(e.definitionId === null).toBe(e.kind !== "monster");
      expect(e.sourceKey?.startsWith(`${e.kind}/`)).toBe(true);
    }
    expect(t.entry("feature/rogue/sneak-attack")?.searchText).toContain("sneak attack");
  });

  test("FR-CMP-04 source row: attribution once, version `mini`, importedAt, counts per kind", () => {
    const t = fresh();
    const src = t.s.db.select().from(compendiumSource).all();
    expect(src).toEqual([
      {
        key: "srd-5.1",
        name: "SRD 5.1",
        licence: "CC BY 4.0",
        attribution: SRD_51_SOURCE.attribution,
        url: SRD_51_SOURCE.url,
        version: "mini",
        importedAt: expect.any(String),
        counts: { monster: 5, spell: 4, item: 4, condition: 3, feature: 39 },
      },
    ]);
    expect(t.imported()).toHaveLength(55);
    // The bundled version differs (so the DM sees Update, FR-CMP-20).
    expect(bundledSource("srd-5.1").bundled.version).not.toBe("mini");
    // Entries carry no attribution of their own.
    expect(Object.keys(t.imported()[0] ?? {})).not.toContain("attribution");
  });
});

describe("FR-CMP-07 FR-CMP-08 FR-CMP-09 cmp.import upsert", () => {
  test("FR-CMP-07 import idempotency: mini again → all existing, no event, no log entry, no writes", () => {
    const t = fresh();
    const log = readEventLog(t.s.db).length;
    const before = t.changes();
    const r = t.recorded(srdMini);
    expect(r.changed).toBe(false);
    for (const c of Object.values(r.counts)) expect(c.created + c.updated).toBe(0);
    expect(r.counts.monster.existing).toBe(5);
    expect(r.counts.feature.existing).toBe(39);
    expect(t.events).toEqual([]);
    expect(readEventLog(t.s.db)).toHaveLength(log);
    expect(t.changes()).toBe(before);
  });

  test("FR-CMP-07 FR-CMP-08 edited goblin → updated in place; ImportedEntityUpdated with the token size copy; one log row per campaign; CompendiumImported last", () => {
    const t = fresh();
    const goblin = t.entry("monster/goblin");
    const goblinId = goblin?.definitionId as string;
    const tokA = placeGoblin(t, t.fixtureCid, goblinId);
    const tokB = placeGoblin(t, t.secondCid, goblinId);
    expect([tokA?.size, tokB?.size]).toEqual(["small", "small"]);
    const log0 = readEventLog(t.s.db).length;
    t.events.length = 0;

    const r = t.recorded(editedMini());
    expect(r.counts.monster).toEqual({ created: 0, updated: 1, existing: 4 });
    expect(r.counts.spell).toEqual({ created: 0, updated: 0, existing: 4 });
    expect(t.entry("monster/goblin")).toMatchObject({
      id: goblin?.id,
      definitionId: goblinId,
      line: "CR 1/4 · Medium humanoid",
    });
    expect(block(t.def(goblinId)).size).toBe("medium");
    const tok = (id?: string) =>
      t.s.db
        .select()
        .from(token)
        .where(eq(token.id, id as string))
        .get();
    expect([tok(tokA?.id)?.size, tok(tokB?.id)?.size]).toEqual(["medium", "medium"]);

    // Events: the definition upsert (null), then one per affected campaign, then CompendiumImported.
    expect(t.events.map((e) => [e.type, e.campaignId])).toEqual([
      ["ImportedEntityUpdated", null],
      ["ImportedEntityUpdated", t.fixtureCid],
      ["ImportedEntityUpdated", t.secondCid],
      ["CompendiumImported", null],
    ]);
    const [defEvent, a, b] = t.events;
    expect(defEvent?.changes.map((c) => c.type)).toEqual([IMPORTED_ENTITY_TYPE]);
    const sizeOf = (e: DomainEvent | undefined, id?: string) =>
      (e?.changes.find((c) => c.type === TOKEN_TYPE && c.id === id)?.after as { size?: string })
        ?.size;
    expect(sizeOf(a, tokA?.id)).toBe("medium");
    expect(sizeOf(b, tokB?.id)).toBe("medium");
    expect(a?.changes.some((c) => c.id === tokB?.id)).toBe(false);
    expect(t.events.at(-1)?.payload).toEqual({
      source: "srd-5.1",
      version: "mini",
      counts: r.counts,
    });
    const log = readEventLog(t.s.db).slice(log0);
    expect(log.map((e) => [e.type, e.campaignId])).toEqual([
      ["ImportedEntityUpdated", null],
      ["ImportedEntityUpdated", t.fixtureCid],
      ["ImportedEntityUpdated", t.secondCid],
      ["CompendiumImported", null],
    ]);
  });

  test("FR-CMP-09 re-import never touches homebrew, derived customs or NPC sheets; entries missing from a newer source stay", () => {
    const t = fresh();
    const goblinId = t.entry("monster/goblin")?.definitionId as string;
    // A custom derived from the SRD goblin (independent copy, ADR-0010 i).
    const sneak = t.run<{ id: string }>("entities.create", {
      kind: "monster",
      name: "Goblin Sneak",
      derivedFromId: goblinId,
      statBlock: t.def(goblinId)?.statBlock,
    });
    const homebrew = t.entries().filter((e) => e.campaignId !== null);
    expect(homebrew.map((e) => e.name).sort()).toEqual([
      "CMP-SECOND-HOMEBREW",
      "CMP-SECRET-ITEM",
      "Divine Fury",
      "Fireball (house)",
      "Moonblade Shard",
    ]);
    const customs = t.s.db.select().from(entity).where(eq(entity.kind, "monster")).all();
    const elite = customs.find((e) => e.name === "Elite Goblin Warrior");
    expect(elite).toBeDefined();
    const sneakRow = t.def(sneak.id);
    const wolf = t.entry("monster/wolf");

    const edited = editedMini();
    edited.monsters = edited.monsters.filter((m) => m.slug !== "wolf");
    t.recorded(edited);

    expect(t.entries().filter((e) => e.campaignId !== null)).toEqual(homebrew);
    expect(t.def(elite?.id as string)).toEqual(elite as NonNullable<typeof elite>);
    expect(t.def(sneak.id)).toEqual(sneakRow as NonNullable<typeof sneakRow>);
    expect(block(t.def(sneak.id)).size).toBe("small");
    expect(t.entry("monster/wolf")).toEqual(wolf as NonNullable<typeof wolf>);
  });

  test("FR-CMP-07 a bad record → nothing written; every issue returned with sourceKey + path", () => {
    const t = fresh();
    // The adapter drops what doesn't fit, so corrupt its output: the pipeline must still refuse.
    const adapted = adaptOpen5e(editedMini());
    const at = (key: string) => adapted.records.find((r) => r.sourceKey === key);
    const goblin = at("monster/goblin");
    if (goblin?.kind !== "monster") throw new Error("goblin missing");
    (goblin.definition.statBlock as { ac: number }).ac = 99;
    const fireball = at("spell/fireball");
    if (fireball?.data.kind !== "spell") throw new Error("fireball missing");
    (fireball.data.facets as { level: number }).level = 12;
    t.s.commands.register(
      defineCommand({
        name: "test.importAdapted",
        input: z.unknown(),
        execute: (_, env) =>
          runImport(t.s.imports, env, { source: { ...SRD_51_SOURCE }, version: "bad", adapted }),
      }),
    );
    const before = t.changes();
    const err = errorOf(() => t.run("test.importAdapted", {}));
    expect(err.code).toBe("invalid");
    const paths = (err.issues ?? []).map((i) => i.path.join("."));
    expect(paths).toContain("monster/goblin.data.statBlock.ac");
    expect(paths).toContain("spell/fireball.data.facets.level");
    expect(t.changes()).toBe(before);
    expect(t.events).toEqual([]);
    expect(t.s.db.select().from(compendiumSource).get()?.version).toBe("mini");
    expect(block(t.def(t.entry("monster/goblin")?.definitionId as string)).size).toBe("small");
  });

  test("FR-CMP-07 encounter started → conflict 'End combat first', nothing written; cmp.importRecorded has no check", () => {
    const t = fresh();
    const enc = t.s.db.select().from(encounter).where(eq(encounter.campaignId, t.fixtureCid)).get();
    const sc = t.s.db
      .select()
      .from(scene)
      .where(and(eq(scene.campaignId, t.fixtureCid), eq(scene.name, "Goblin Ambush")))
      .get();
    t.run("cbt.start", { encounterId: enc?.id, sceneId: sc?.id });
    const before = t.changes();
    const log = readEventLog(t.s.db).length;
    const err = errorOf(() => t.run(IMPORT, { source: "srd-5.1" }));
    expect([err.code, err.message]).toEqual(["conflict", END_COMBAT_FIRST]);
    expect(t.changes()).toBe(before);
    expect(readEventLog(t.s.db)).toHaveLength(log);
    // The internal twin (fixtures, tests) doesn't check.
    expect(t.recorded(editedMini()).counts.monster.updated).toBe(1);
  });

  test("FR-CMP-07 unknown source key → invalid (a key, never data)", () => {
    const t = fresh();
    expect(errorOf(() => t.run(IMPORT, { source: "open5e-live" })).code).toBe("invalid");
    expect(errorOf(() => t.run(IMPORT, { source: "srd-5.1", responses: {} })).code).toBe("invalid");
  });
});

describe("FR-CMP-02 FR-CMP-24 homebrew (cmp.putEntry, server side)", () => {
  const item = (name: string) => ({
    kind: "item" as const,
    name,
    facets: { category: "gear" as const, attunement: false },
    body: { typeLine: "Adventuring gear", text: "A thing." },
  });

  test("FR-CMP-02 homebrew: campaign, no source; name unique ci per campaign and kind; not a monster", () => {
    const t = fresh();
    const { entryId } = t.run<{ entryId: string }>(PUT_ENTRY, { entry: item("Lucky Coin") });
    expect(t.entries().find((e) => e.id === entryId)).toMatchObject({
      campaignId: t.fixtureCid,
      source: null,
      sourceKey: null,
      shared: false,
      definitionId: null,
      line: "Adventuring gear",
    });
    const e = errorOf(() => t.run(PUT_ENTRY, { entry: item("lucky coin") }));
    expect([e.code, e.message]).toEqual(["conflict", NAME_TAKEN]);
    // Other kind, other campaign, or an imported name: fine.
    t.run(PUT_ENTRY, {
      entry: { kind: "condition", name: "Lucky Coin", facets: {}, body: { text: "t" } },
    });
    t.run(PUT_ENTRY, { entry: item("Lucky Coin") }, t.dm(t.secondCid));
    t.run(PUT_ENTRY, { entry: item("Potion of Healing") });
    const goblin = t.entry("monster/goblin");
    expect(
      errorOf(() =>
        t.run(PUT_ENTRY, {
          entry: { kind: "monster", name: "Gob", facets: goblin?.facets, body: goblin?.body },
        }),
      ).code,
    ).toBe("invalid");
    expect(
      errorOf(() =>
        t.run(PUT_ENTRY, {
          entry: { ...item("Long"), body: { typeLine: "x", text: "y".repeat(8_001) } },
        }),
      ).code,
    ).toBe("invalid");
  });

  test("FR-CMP-24 whole replace; imported → forbidden; other campaign → not_found; kind immutable", () => {
    const t = fresh();
    const { entryId } = t.run<{ entryId: string }>(PUT_ENTRY, { entry: item("Lucky Coin") });
    t.run(PUT_ENTRY, { id: entryId, entry: item("Lucky Coin II"), shared: true });
    expect(t.entries().find((e) => e.id === entryId)).toMatchObject({
      name: "Lucky Coin II",
      shared: true,
    });
    const fireball = t.entry("spell/fireball");
    const e = errorOf(() => t.run(PUT_ENTRY, { id: fireball?.id, entry: item("Mine") }));
    expect([e.code, e.message]).toEqual(["forbidden", READ_ONLY_ENTRY]);
    expect(
      errorOf(() => t.run(PUT_ENTRY, { id: entryId, entry: item("X") }, t.dm(t.secondCid))).code,
    ).toBe("not_found");
    expect(
      errorOf(() =>
        t.run(PUT_ENTRY, {
          id: entryId,
          entry: { kind: "condition", name: "C", facets: {}, body: { text: "t" } },
        }),
      ).code,
    ).toBe("invalid");
    const log = readEventLog(t.s.db, t.fixtureCid).filter((x) => x.type === "CompendiumEntrySaved");
    expect(log.at(-1)?.payload).toEqual({ entryId, kind: "item", shared: true });
  });
});

describe("FR-CMP-07 FR-CMP-31 full bundled import", () => {
  test("FR-CMP-07 crash cmp.import:before-commit → zero rows; :after-commit → complete; rerun no-op", () => {
    class Killed extends Error {}
    const kill = () => {
      throw new Killed("killed");
    };
    const s = createTestServices();
    const run = () => s.commands.run(IMPORT, { source: "srd-5.1" }, { actor: DM_NO_CAMPAIGN });
    const count = () => s.db.select().from(compendiumEntry).all().length;
    try {
      armCrashHook({ point: "before-commit", target: IMPORT }, kill);
      expect(run).toThrow();
      expect(count()).toBe(0);
      expect(s.db.select().from(entity).all()).toHaveLength(0);
      expect(s.db.select().from(compendiumSource).all()).toHaveLength(0);
      expect(readEventLog(s.db)).toHaveLength(0);
      armCrashHook({ point: "after-commit", target: IMPORT }, kill);
      expect(run).toThrow(Killed);
    } finally {
      armCrashHook(null);
    }
    expect(count()).toBe(1150);
    const log = readEventLog(s.db).length;
    const r = run() as ImportResult;
    expect(r.changed).toBe(false);
    expect(readEventLog(s.db)).toHaveLength(log);
  });

  test("FR-CMP-31 full import of srd-5.1: target ≤ 2 s (logged), fails only > 10 s; re-import target ≤ 0.5 s, no writes", () => {
    const s = createTestServices();
    bundledSource("srd-5.1"); // file read + adapt are per process; the timed part is the write.
    const t0 = performance.now();
    const r = s.commands.run(
      IMPORT,
      { source: "srd-5.1" },
      { actor: DM_NO_CAMPAIGN },
    ) as ImportResult;
    const ms = performance.now() - t0;
    const level = ms > 2_000 ? "WARN over the 2 s target" : "ok";
    console.log(`FR-CMP-31 full import: ${ms.toFixed(0)} ms (${level})`);
    expect(ms).toBeLessThan(10_000);
    expect(r.counts).toEqual({
      monster: { created: 322, updated: 0, existing: 0 },
      spell: { created: 319, updated: 0, existing: 0 },
      item: { created: 292, updated: 0, existing: 0 },
      condition: { created: 15, updated: 0, existing: 0 },
      feature: { created: 202, updated: 0, existing: 0 },
    });
    expect(s.db.select().from(entity).where(isNull(entity.campaignId)).all()).toHaveLength(322);
    const changes = () =>
      s.db.$client.query<{ n: number }, []>("SELECT total_changes() AS n").get()?.n;
    const before = changes();
    const t1 = performance.now();
    const again = s.commands.run(
      IMPORT,
      { source: "srd-5.1" },
      {
        actor: DM_NO_CAMPAIGN,
      },
    ) as ImportResult;
    const ms2 = performance.now() - t1;
    console.log(
      `FR-CMP-31 re-import (unchanged): ${ms2.toFixed(0)} ms (${ms2 > 500 ? "WARN over the 0.5 s target" : "ok"})`,
    );
    expect(ms2).toBeLessThan(10_000);
    expect(again.changed).toBe(false);
    expect(changes()).toBe(before);
  }, 30_000);
});

const DM_NO_CAMPAIGN: Actor = { role: "dm", playerId: null, campaignId: null };
