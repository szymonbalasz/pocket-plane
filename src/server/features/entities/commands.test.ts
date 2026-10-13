import { describe, expect, test } from "bun:test";
import type { EntityRecord } from "@shared/entities/schemas";
import { eq, sql } from "drizzle-orm";
import { createApi } from "../../app";
import { seededContext } from "../../commands/context";
import { CommandError } from "../../commands/errors";
import { asset, entity } from "../../db/schema";
import { readEventLog } from "../../events/log";
import type { Actor, DispatchedEvent } from "../../events/types";
import { DM_ACTOR } from "../../testing/services";
import { CREATE, READ_ONLY_MESSAGE, resolveDefinition, UPDATE } from "./commands";
import { definitionHooksOf } from "./definition-hooks";
import {
  captureLogger,
  entityServices,
  goblinBlock,
  miraBlock,
  seedEntities,
  thornBlock,
} from "./testing";

function setup() {
  const cap = captureLogger();
  const s = entityServices(cap.log);
  const h = seedEntities(s);
  const events: DispatchedEvent[] = [];
  s.bus.subscribe("test-capture", (e) => events.push(e));
  const run = (name: string, input: unknown, actor: Actor = h.dm, key?: string) =>
    s.commands.run(name, input, {
      actor,
      ...(key ? { ctx: seededContext({ disposable: true, key }) } : {}),
    }) as EntityRecord;
  const err = (fn: () => unknown): CommandError => {
    try {
      fn();
    } catch (e) {
      if (e instanceof CommandError) return e;
      throw e;
    }
    throw new Error("expected a CommandError");
  };
  const rowCount = () =>
    s.db.$client.query<{ n: number }, []>("SELECT count(*) AS n FROM entity").get()?.n ?? 0;
  const logCount = () => readEventLog(s.db).length;
  const elite = (name = "Elite Goblin Warrior") =>
    run(CREATE, {
      kind: "monster",
      name,
      derivedFromId: h.goblinId,
      statBlock: { ...goblinBlock, ac: 16, hpMax: 15, cr: "1/2" },
    });
  const mira = () =>
    run(CREATE, { kind: "character", name: "Mira", ownerPlayerId: h.p1.id, statBlock: miraBlock });
  const addAsset = (id: string, campaignId: string) =>
    s.db
      .insert(asset)
      .values({
        id,
        campaignId,
        seq: sql`(select coalesce(max(seq), 0) + 1 from asset)`,
        name: id,
        hash: id.padEnd(64, "0"),
        mime: "image/png",
        bytes: 1,
        width: 1,
        height: 1,
        displayWidth: 1,
        displayHeight: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
      })
      .run();
  const update = (e: EntityRecord, patch: Record<string, unknown> = {}, actor = h.dm) =>
    run(
      UPDATE,
      {
        id: e.id,
        name: e.name,
        portraitAssetId: e.portraitAssetId,
        statBlock: e.statBlock,
        ...(e.kind === "character" ? { ownerPlayerId: e.ownerPlayerId } : {}),
        ...patch,
      },
      actor,
    );
  return { s, h, cap, events, run, err, rowCount, logCount, elite, mira, addAsset, update };
}

describe("entities commands", () => {
  test("FR-ENT-17 create: row + log entry + event, IDs and time from ctx", () => {
    const t = setup();
    const before = t.logCount();
    const e = t.run(
      CREATE,
      { kind: "monster", name: "Boss", statBlock: goblinBlock },
      t.h.dm,
      "fixture-x",
    );
    const expected = seededContext({ disposable: true, key: "fixture-x" });
    expect(e.id).toBe(expected.ids.next());
    expect(e.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(e).toMatchObject({ campaignId: t.h.campaignId, derivedFromId: null, kind: "monster" });
    const log = readEventLog(t.s.db).slice(before);
    expect(log.map((l) => [l.type, l.campaignId, l.payload])).toEqual([
      ["EntityCreated", t.h.campaignId, { entityId: e.id, kind: "monster" }],
    ]);
    const ev = t.events.at(-1)?.event;
    expect(ev?.changes).toEqual([{ type: "entity", id: e.id, before: null, after: e }]);
  });

  test("FR-ENT-17 a failing create rolls back: no row, no log, no event", () => {
    const t = setup();
    const [rows, logs, evs] = [t.rowCount(), t.logCount(), t.events.length];
    const e = t.err(() =>
      t.run(CREATE, {
        kind: "monster",
        name: "Boss",
        portraitAssetId: "missing-asset",
        statBlock: goblinBlock,
      }),
    );
    expect(e.code).toBe("not_found");
    expect([t.rowCount(), t.logCount(), t.events.length]).toEqual([rows, logs, evs]);
  });

  test("FR-ENT-04 no active campaign → conflict; customs carry the actor's campaign", () => {
    const t = setup();
    const e = t.err(() =>
      t.run(CREATE, { kind: "monster", name: "Boss", statBlock: goblinBlock }, DM_ACTOR),
    );
    expect([e.code, e.message]).toEqual(["conflict", "No active campaign"]);
    const second = t.run(
      CREATE,
      { kind: "monster", name: "Boss", statBlock: goblinBlock },
      t.h.dmSecond,
    );
    expect(second.campaignId).toBe(t.h.secondCampaignId);
  });

  test("FR-ENT-07 update of an imported definition → forbidden, no change, event or log", () => {
    const t = setup();
    const [logs, evs] = [t.logCount(), t.events.length];
    const e = t.err(() =>
      t.run(UPDATE, { id: t.h.goblinId, name: "Goblin", statBlock: { ...goblinBlock, ac: 1 } }),
    );
    expect([e.code, e.message]).toEqual(["forbidden", READ_ONLY_MESSAGE]);
    expect([t.logCount(), t.events.length]).toEqual([logs, evs]);
    const row = t.s.db.select().from(entity).where(eq(entity.id, t.h.goblinId)).get();
    expect((row?.statBlock as { ac: number } | undefined)?.ac).toBe(15);
  });

  test("FR-ENT-08 names: conflict per campaign + kind (ci), imported names allowed", () => {
    const t = setup();
    expect(t.run(CREATE, { kind: "monster", name: "Goblin", statBlock: goblinBlock }).name).toBe(
      "Goblin",
    );
    expect(
      t.err(() => t.run(CREATE, { kind: "monster", name: " goblin ", statBlock: goblinBlock }))
        .code,
    ).toBe("conflict");
    // Same name in another campaign or as another kind is fine.
    t.run(CREATE, { kind: "monster", name: "Goblin", statBlock: goblinBlock }, t.h.dmSecond);
    const mira = t.mira();
    expect(t.err(() => t.mira()).code).toBe("conflict");
    t.run(CREATE, { kind: "monster", name: "Mira", statBlock: goblinBlock });
    // Rename onto a taken name → conflict; keeping its own name is fine.
    const boss = t.run(CREATE, { kind: "monster", name: "Boss", statBlock: goblinBlock });
    expect(t.err(() => t.update(boss, { name: "GOBLIN" })).code).toBe("conflict");
    expect(t.update(boss, { name: "boss" }).name).toBe("boss");
    const thorn = t.run(CREATE, {
      kind: "character",
      name: "Thorn",
      ownerPlayerId: t.h.p2.id,
      statBlock: thornBlock,
    });
    expect(t.err(() => t.update(thorn, { name: "mira" })).code).toBe("conflict");
    expect(mira.name).toBe("Mira");
  });

  test("FR-ENT-08 portrait: same-campaign asset only, else not_found", () => {
    const t = setup();
    t.addAsset("asset-here-0000000000", t.h.campaignId);
    t.addAsset("asset-there-000000000", t.h.secondCampaignId);
    const ok = t.run(CREATE, {
      kind: "monster",
      name: "Boss",
      portraitAssetId: "asset-here-0000000000",
      statBlock: goblinBlock,
    });
    expect(ok.portraitAssetId).toBe("asset-here-0000000000");
    const bad = t.err(() => t.update(ok, { portraitAssetId: "asset-there-000000000" }));
    expect(bad.code).toBe("not_found");
    expect(t.update(ok, { portraitAssetId: null }).portraitAssetId).toBeNull();
  });

  test("FR-ENT-09 derive: global or same-campaign monster, else not_found; copies nothing", () => {
    const t = setup();
    const elite = t.elite();
    expect(elite.derivedFromId).toBe(t.h.goblinId);
    expect(elite.statBlock.ac).toBe(16);
    const ev = t.events.at(-1)?.event;
    expect(ev?.payload).toEqual({
      entityId: elite.id,
      kind: "monster",
      derivedFromId: t.h.goblinId,
    });
    // From a derived custom of the same campaign: fine.
    const boss = t.run(CREATE, {
      kind: "monster",
      name: "Goblin Boss",
      derivedFromId: elite.id,
      statBlock: goblinBlock,
    });
    // Another campaign's custom, a character, an unknown id → not_found.
    const troll = t.run(
      CREATE,
      { kind: "monster", name: "Marsh Troll", statBlock: goblinBlock },
      t.h.dmSecond,
    );
    const mira = t.mira();
    for (const id of [troll.id, mira.id, "nope"]) {
      const e = t.err(() =>
        t.run(CREATE, {
          kind: "monster",
          name: `X ${id}`,
          derivedFromId: id,
          statBlock: goblinBlock,
        }),
      );
      expect(e.code).toBe("not_found");
    }
    // Later base edits never change the result.
    t.update(elite, { statBlock: { ...elite.statBlock, ac: 20 } });
    const row = t.s.db.select().from(entity).where(eq(entity.id, boss.id)).get();
    expect((row?.statBlock as { ac: number } | undefined)?.ac).toBe(15);
  });

  test("FR-ENT-10 character: owner must be a player of the campaign; hpCurrent = hpMax", () => {
    const t = setup();
    const mira = t.mira();
    expect([mira.ownerPlayerId, mira.hpCurrent]).toEqual([t.h.p1.id, 12]);
    const e = t.err(() =>
      t.run(CREATE, {
        kind: "character",
        name: "Pip",
        ownerPlayerId: t.h.p3.id,
        statBlock: miraBlock,
      }),
    );
    expect(e.code).toBe("invalid");
    expect(e.issues?.[0]?.path).toEqual(["ownerPlayerId"]);
  });

  test("FR-ENT-11 update: whole replace; kind/campaign/provenance immutable; hpCurrent clamped", () => {
    const t = setup();
    const mira = t.mira();
    t.s.db.update(entity).set({ hpCurrent: 9 }).where(eq(entity.id, mira.id)).run();
    const lowered = t.update({ ...mira, hpCurrent: 9 } as EntityRecord, {
      statBlock: { ...miraBlock, hpMax: 5 },
    });
    expect([lowered.hpCurrent, lowered.statBlock.hpMax]).toEqual([5, 5]);
    const raised = t.update(lowered, { statBlock: { ...miraBlock, hpMax: 20 } });
    expect(raised.hpCurrent).toBe(5);
    // A monster stat block on a character: invalid with a statBlock path.
    const e = t.err(() => t.update(raised, { statBlock: goblinBlock }));
    expect(e.code).toBe("invalid");
    expect(e.issues?.map((i) => i.path.join("."))).toContain("statBlock");
    // Characters need an owner; monsters must not have one.
    expect(t.err(() => t.update(raised, { ownerPlayerId: undefined })).code).toBe("invalid");
    const elite = t.elite();
    expect(t.err(() => t.update(elite, { ownerPlayerId: t.h.p1.id })).code).toBe("invalid");
    // Omitted portrait = cleared (whole replace); derivedFromId kept.
    const after = t.update(elite, { portraitAssetId: undefined, name: "Elite" });
    expect([after.name, after.derivedFromId, after.campaignId]).toEqual([
      "Elite",
      t.h.goblinId,
      t.h.campaignId,
    ]);
    // Another campaign's custom → not_found.
    expect(t.err(() => t.update(elite, {}, t.h.dmSecond)).code).toBe("not_found");
  });

  test("FR-ENT-11 owner change: old owner gets a redacted upsert, new owner full", () => {
    const t = setup();
    const mira = t.mira();
    t.update(mira, { ownerPlayerId: t.h.p2.id });
    const ev = t.events.at(-1)?.event;
    const change = ev?.changes[0];
    if (!change) throw new Error("no change");
    const p1 = t.s.records.filterChange(change, t.h.viewer("player", t.h.p1.id));
    const p2 = t.s.records.filterChange(change, t.h.viewer("player", t.h.p2.id));
    expect(p1).toEqual({
      type: "entity",
      id: mira.id,
      op: "upsert",
      data: {
        id: mira.id,
        kind: "character",
        name: "Mira",
        portraitAssetId: null,
        ownerPlayerId: t.h.p2.id,
        down: false,
      },
    });
    expect(p2?.data).toMatchObject({ statBlock: miraBlock, hpCurrent: 12 });
  });

  test("FR-ENT-22 tokenShape: set by create / update; omitted → null; imported null", () => {
    const t = setup();
    const imported = t.s.db.transaction((tx) =>
      resolveDefinition({ tx, actor: t.h.dm }, t.h.goblinId),
    );
    expect(imported.tokenShape).toBeNull();
    expect(t.elite().tokenShape).toBeNull();
    const sq = t.run(CREATE, {
      kind: "monster",
      name: "Square Goblin",
      tokenShape: "square",
      statBlock: goblinBlock,
    });
    expect(sq.tokenShape).toBe("square");
    const row = () => t.s.db.select().from(entity).where(eq(entity.id, sq.id)).get();
    expect(row()?.tokenShape).toBe("square");
    expect(t.update(sq, { tokenShape: "none" }).tokenShape).toBe("none");
    // FR-ENT-11 whole replace: a PUT without tokenShape sets null.
    expect(t.update(sq).tokenShape).toBeNull();
    expect(row()?.tokenShape).toBeNull();
    const bad = t.err(() => t.update(sq, { tokenShape: "hex" }));
    expect([bad.code, bad.issues?.[0]?.path]).toEqual(["invalid", ["tokenShape"]]);
    const pc = t.run(CREATE, {
      kind: "character",
      name: "Mira",
      ownerPlayerId: t.h.p1.id,
      tokenShape: "none",
      statBlock: miraBlock,
    });
    expect(pc.tokenShape).toBe("none");
  });

  test("FR-ENT-21/23 speed, abilities, saves: stored via create / update; bad values invalid with path", () => {
    const t = setup();
    const mira = t.mira();
    expect(mira.statBlock).toMatchObject({
      speed: 30,
      abilities: { str: 14, con: 14 },
      saveProficiencies: ["str", "con"],
    });
    const { speed: _s, abilities: _a, saveProficiencies: _p, ...bare } = miraBlock;
    // Absent fields stay valid (no backfill) and an update may drop them (whole replace).
    const dropped = t.update(mira, { statBlock: bare });
    expect(dropped.statBlock as unknown).toEqual(bare);
    const paths = (patch: object) =>
      t
        .err(() => t.update(dropped, { statBlock: { ...bare, ...patch } }))
        .issues?.map((i) => i.path.join("."));
    expect(paths({ speed: 33 })).toEqual(["statBlock.speed"]);
    expect(paths({ saveProficiencies: ["str"] })).toEqual(["statBlock.saveProficiencies"]);
    expect(paths({ abilities: { ...miraBlock.abilities, wis: 31 } })).toEqual([
      "statBlock.abilities.wis",
    ]);
    const elite = t.update(t.elite(), {
      statBlock: { ...goblinBlock, speed: 40, saveProficiencies: ["dex", "wis"] },
    });
    expect(elite.statBlock).toMatchObject({ speed: 40, saveProficiencies: ["dex", "wis"] });
    const created = t.err(() =>
      t.run(CREATE, {
        kind: "monster",
        name: "Slow",
        statBlock: { ...goblinBlock, speed: 33 },
      }),
    );
    expect(created.issues?.map((i) => i.path.join("."))).toEqual(["statBlock.speed"]);
  });

  test("FR-ENT-12 resolveDefinition: global or same campaign, else not_found", () => {
    const t = setup();
    const troll = t.run(
      CREATE,
      { kind: "monster", name: "Marsh Troll", statBlock: goblinBlock },
      t.h.dmSecond,
    );
    const elite = t.elite();
    const resolve = (id: string, actor: Actor) =>
      t.s.db.transaction((tx) => resolveDefinition({ tx, actor }, id));
    expect(resolve(t.h.goblinId, t.h.dm).id).toBe(t.h.goblinId);
    expect(resolve(elite.id, t.h.dm).id).toBe(elite.id);
    expect(resolve(t.h.goblinId, DM_ACTOR).id).toBe(t.h.goblinId);
    for (const [id, actor] of [
      [troll.id, t.h.dm],
      [elite.id, t.h.dmSecond],
      [elite.id, DM_ACTOR],
      ["nope", t.h.dm],
    ] as const) {
      expect(() => resolve(id, actor)).toThrow(CommandError);
    }
  });

  test("FR-ENT-14 no command or route deletes a definition", () => {
    const t = setup();
    expect(t.s.commands.names().filter((n) => n.startsWith("entities."))).toEqual([
      "entities.create",
      "entities.update",
    ]);
    const routes = createApi(t.s).routes.filter((r) => r.path.includes("entities"));
    // Middleware shows up as extra entries per route: compare the distinct method + path set.
    expect([...new Set(routes.map((r) => `${r.method} ${r.path}`))]).toEqual([
      "POST /api/entities",
      "PUT /api/entities/:id",
    ]);
  });

  test("FR-ENT-19 hook rows commit with the update and are listed in EntityUpdated.changes", () => {
    const t = setup();
    t.s.db.$client.run("CREATE TABLE test_instance (id TEXT PRIMARY KEY, size TEXT)");
    t.s.db.$client.run("INSERT INTO test_instance VALUES ('inst-1', 'small')");
    const elite = t.elite();
    definitionHooksOf(t.s).register("test.instances", ({ tx }, before, after) => {
      if (before.statBlock.size === after.statBlock.size) return [];
      tx.run(sql`UPDATE test_instance SET size = ${after.statBlock.size}`);
      return [
        {
          type: "test-instance",
          id: "inst-1",
          before: { id: "inst-1", size: before.statBlock.size },
          after: { id: "inst-1", size: after.statBlock.size },
        },
      ];
    });
    t.update(elite, { statBlock: { ...elite.statBlock, size: "large" } });
    const ev = t.events.at(-1)?.event;
    expect(ev?.type).toBe("EntityUpdated");
    expect(ev?.payload).toEqual({ entityId: elite.id });
    expect(ev?.changes.map((c) => [c.type, c.id])).toEqual([
      ["entity", elite.id],
      ["test-instance", "inst-1"],
    ]);
    const size = t.s.db.$client
      .query<{ size: string }, []>("SELECT size FROM test_instance")
      .get()?.size;
    expect(size).toBe("large");
  });

  test("FR-ENT-19 a throwing hook rolls back the whole update", () => {
    const t = setup();
    const elite = t.elite();
    definitionHooksOf(t.s).register("test.boom", () => {
      throw new Error("boom");
    });
    const [logs, evs] = [t.logCount(), t.events.length];
    const e = t.err(() => t.update(elite, { name: "Renamed" }));
    expect(e.code).toBe("internal");
    expect([t.logCount(), t.events.length]).toEqual([logs, evs]);
    const row = t.s.db.select().from(entity).where(eq(entity.id, elite.id)).get();
    expect(row?.name).toBe("Elite Goblin Warrior");
  });

  test("FR-ENT-01 a command touching an invalid stored row → internal, logged", () => {
    const t = setup();
    const elite = t.elite();
    t.s.db.$client.run(`UPDATE entity SET stat_block = '{"bad":1}' WHERE id = '${elite.id}'`);
    const e = t.err(() => t.update(elite, { name: "X" }));
    expect(e.code).toBe("internal");
    expect(t.cap.errors.some((m) => m.includes("entities.update"))).toBe(true);
    const d = t.err(() =>
      t.run(CREATE, {
        kind: "monster",
        name: "Y",
        derivedFromId: elite.id,
        statBlock: goblinBlock,
      }),
    );
    expect(d.code).toBe("internal");
  });
});
