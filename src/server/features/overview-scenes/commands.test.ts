// OVW §13 integration level, in process: overview commands, one thing shown, resolver, item
// commands with their rules. Sockets and leak scans: `sync.test.ts`; a fight: `fight.sync.test.ts`.
import { describe, expect, test } from "bun:test";
import { ASSET_MANAGE_INTENTS, inUseMessage } from "@shared/assets-pipeline/manage";
import {
  type AddPartyResult,
  OVW_INTENTS as I,
  ITEMS_PER_CAMPAIGN_MAX,
  ITEMS_PER_OVERVIEW_MAX,
  LABEL_STYLE_DEFAULT,
  newMiniatureStyle,
  OVERVIEW_ITEM_TYPE,
  OVERVIEW_TYPE,
  OVERVIEWS_PER_CAMPAIGN_MAX,
  type OverviewItemRecord,
  type OverviewRecord,
} from "@shared/overview-scenes/schemas";
import { MAP_INTENTS } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { entity, overview, overviewItem, overviewItemSeqNext, scene } from "../../db/schema";
import { readEventLog } from "../../events/log";
import { silentLogger } from "../../log";
import { createServices } from "../../services";
import { createTestServices } from "../../testing/services";
import { createEntity, UPDATE } from "../entities/commands";
import { definitionHooksOf } from "../entities/definition-hooks";
import { miraBlock } from "../entities/testing";
import { sceneCampaignOf } from "../scenes-map/active-scene";
import { MAP_REST } from "../scenes-map/commands";
import { activeSceneOf } from "../scenes-map/rows";
import { lifecycleHooks } from "../scenes-map/scene-hooks";
import { scenesSetup } from "../scenes-map/testing";
import { insertMiniature, MINIATURE_STYLE } from "./testing";

function setup() {
  const t = scenesSetup();
  const { s, h, run } = t;
  const cid = h.campaignId;
  const create = (name = "Sword Coast", folderId?: string) =>
    run<{ overviewId: string }>(I.create, { name, ...(folderId ? { folderId } : {}) }).overviewId;
  const battle = (name = "Battle") =>
    run<{ id: string }>(MAP_REST.createScene, { name, mapAssetId: "map-battle" }).id;
  const label = (overviewId: string, over: object = {}) =>
    run<{ itemId: string }>(I.placeLabel, {
      overviewId,
      x: 10,
      y: 20,
      text: "Neverwinter",
      style: LABEL_STYLE_DEFAULT,
      ...over,
    }).itemId;
  const image = (overviewId: string, over: object = {}) =>
    run<{ itemId: string }>(I.placeImage, {
      overviewId,
      assetId: "map-town",
      x: 0,
      y: 0,
      w: 2100,
      h: 1400,
      ...over,
    }).itemId;
  const item = (id: string) =>
    s.db.select().from(overviewItem).where(eq(overviewItem.id, id)).get() as OverviewItemRecord;
  const row = (id: string) =>
    s.db.select().from(overview).where(eq(overview.id, id)).get() as OverviewRecord;
  const sceneRow = (id: string) => s.db.select().from(scene).where(eq(scene.id, id)).get();
  const shown = () => s.records.activeSceneOf(cid);
  const battleActive = () => s.db.transaction((tx) => activeSceneOf(tx, cid)?.id ?? null);
  const code = (fn: () => unknown) => t.err(fn).code;
  return {
    ...t,
    cid,
    create,
    battle,
    label,
    image,
    item,
    row,
    sceneRow,
    shown,
    battleActive,
    code,
  };
}

/** Bulk rows for the caps: the commands' count is what's under test, not 3,000 inserts through them. */
function fillItems(t: ReturnType<typeof setup>, overviewId: string, n: number, from = 0) {
  const now = "2026-01-01T00:00:00.000Z";
  for (let i = 0; i < n; i++) {
    t.s.db
      .insert(overviewItem)
      .values({
        id: `fill-${overviewId}-${from + i}`,
        campaignId: t.cid,
        overviewId,
        seq: overviewItemSeqNext,
        kind: "label",
        x: 0,
        y: 0,
        text: "x",
        style: LABEL_STYLE_DEFAULT,
        createdAt: now,
        updatedAt: now,
      })
      .run();
  }
}

describe("FR-OVW-01–04 overview records", () => {
  test("FR-OVW-01 create: name as a scene's, not unique, not shown; ≤ 50 per campaign", () => {
    const t = setup();
    const id = t.create("  Sword Coast  ");
    expect(t.row(id)).toMatchObject({ name: "Sword Coast", active: false, folderId: null });
    expect(t.create("Sword Coast")).not.toBe(id);
    for (const bad of ["", "   ", "x".repeat(61), "a\nb"]) {
      expect(t.code(() => t.run(I.create, { name: bad }))).toBe("invalid");
    }
    for (let i = 2; i < OVERVIEWS_PER_CAMPAIGN_MAX; i++) t.create(`O${i}`);
    expect(t.code(() => t.create("One too many"))).toBe("conflict");
    expect(t.code(() => t.run(I.duplicate, { overviewId: id }))).toBe("conflict");
    expect(t.logTypes()).toContain("OverviewCreated");
  });

  test("FR-OVW-01 a player can't; another campaign's folder looks unknown", () => {
    const t = setup();
    expect(t.code(() => t.run(I.create, { name: "No" }, t.player(t.h.p1)))).toBe("forbidden");
    const other = t.run<{ id: string }>(MAP_REST.createFolder, { name: "Theirs" }, t.h.dmSecond).id;
    expect(t.code(() => t.run(I.create, { name: "No", folderId: other }))).toBe("not_found");
  });

  test("FR-OVW-02 update: rename, folder, root; no change → no event; folder delete → root", () => {
    const t = setup();
    const id = t.create();
    const folder = t.run<{ id: string }>(MAP_REST.createFolder, { name: "Act 1" }).id;
    t.run(I.update, { overviewId: id, name: "Waterdeep", folderId: folder });
    expect(t.row(id)).toMatchObject({ name: "Waterdeep", folderId: folder });
    const events = t.events.length;
    t.run(I.update, { overviewId: id, name: "Waterdeep", folderId: folder });
    expect(t.events.length).toBe(events);
    t.run(I.update, { overviewId: id, folderId: null });
    expect(t.row(id).folderId).toBeNull();

    const scn = t.battle();
    t.run(MAP_REST.updateScene, { id: scn, folderId: folder });
    t.run(I.update, { overviewId: id, folderId: folder });
    t.run(MAP_REST.deleteFolder, { id: folder });
    expect(t.row(id).folderId).toBeNull();
    expect(t.sceneRow(scn)?.folderId).toBeNull();
    const last = t.events.at(-1);
    expect(last?.event.type).toBe("SceneFolderDeleted");
    expect(last?.event.changes.map((c) => c.type)).toEqual([
      "scene",
      OVERVIEW_TYPE,
      "scene-folder",
    ]);
  });

  test("FR-OVW-03 duplicate: (copy) cut to 60, same folder, not shown, items with new IDs", () => {
    const t = setup();
    const folder = t.run<{ id: string }>(MAP_REST.createFolder, { name: "Act 1" }).id;
    const id = t.create("x".repeat(60), folder);
    const map = t.image(id);
    const hidden = t.label(id, { hidden: true });
    t.run(I.updateItems, { overviewId: id, items: [{ itemId: map, locked: true }] });
    t.run(I.show, { overviewId: id });
    const copy = t.run<{ overviewId: string }>(I.duplicate, { overviewId: id }).overviewId;
    const r = t.row(copy);
    expect([...r.name].length).toBe(60);
    expect(r).toMatchObject({ folderId: folder, active: false });
    const items = t.s.db.select().from(overviewItem).where(eq(overviewItem.overviewId, copy)).all();
    expect(items.map((i) => i.kind).sort()).toEqual(["image", "label"]);
    expect(items.map((i) => i.id)).not.toContain(map);
    expect(items.map((i) => i.id)).not.toContain(hidden);
    expect(items.find((i) => i.kind === "image")?.locked).toBe(true);
    expect(items.find((i) => i.kind === "label")?.hidden).toBe(true);
  });

  test("FR-OVW-03 the campaign's item cap holds on a copy", () => {
    const t = setup();
    const id = t.create();
    t.label(id);
    fillItems(t, t.create("Bulk"), ITEMS_PER_CAMPAIGN_MAX - 1);
    expect(t.code(() => t.run(I.duplicate, { overviewId: id }))).toBe("conflict");
  });

  test("FR-OVW-04 delete: items go with it; a shown overview → conflict", () => {
    const t = setup();
    const id = t.create();
    const item = t.label(id);
    t.run(I.show, { overviewId: id });
    const refused = t.err(() => t.run(I.delete, { overviewId: id }));
    expect(refused).toMatchObject({ code: "conflict", message: "Show something else first" });
    t.run(MAP_INTENTS.activateScene, { sceneId: t.battle() });
    t.run(I.delete, { overviewId: id });
    expect(t.row(id)).toBeUndefined();
    expect(t.item(item)).toBeUndefined();
    const types = t.events.at(-1)?.event.changes.map((c) => c.type);
    expect(types).toEqual([OVERVIEW_ITEM_TYPE, OVERVIEW_TYPE]);
  });
});

describe("FR-OVW-05–07 one thing shown", () => {
  test("FR-OVW-05 show takes the scene off", () => {
    const t = setup();
    const scn = t.battle();
    t.run(MAP_INTENTS.activateScene, { sceneId: scn });
    const id = t.create();
    t.run(I.show, { overviewId: id });
    expect(t.sceneRow(scn)?.active).toBe(false);
    expect(t.row(id).active).toBe(true);
    const e = t.events.at(-1)?.event;
    expect(e?.type).toBe("OverviewShown");
    expect(e?.payload).toEqual({ overviewId: id, previousSceneId: scn, previousOverviewId: null });
    expect(e?.changes.map((c) => c.type)).toEqual(["scene", OVERVIEW_TYPE]);
    expect(readEventLog(t.s.db).at(-1)?.type).toBe("OverviewShown");
  });

  test("FR-OVW-05 show takes the shown overview off; already shown → no event", () => {
    const t = setup();
    const a = t.create("A");
    const b = t.create("B");
    t.run(I.show, { overviewId: a });
    t.run(I.show, { overviewId: b });
    expect(t.row(a).active).toBe(false);
    expect(t.row(b).active).toBe(true);
    expect(t.events.at(-1)?.event.payload).toEqual({
      overviewId: b,
      previousSceneId: null,
      previousOverviewId: a,
    });
    const events = t.events.length;
    t.run(I.show, { overviewId: b });
    expect(t.events.length).toBe(events);
  });

  test("FR-OVW-05 unknown or another campaign's overview → not_found; a player → forbidden", () => {
    const t = setup();
    const id = t.create();
    const theirs = t.run<{ overviewId: string }>(I.create, { name: "Theirs" }, t.h.dmSecond);
    expect(t.code(() => t.run(I.show, { overviewId: "nope" }))).toBe("not_found");
    expect(t.code(() => t.run(I.show, theirs))).toBe("not_found");
    expect(t.code(() => t.run(I.show, { overviewId: id }, t.player(t.h.p1)))).toBe("forbidden");
  });

  test("FR-OVW-06 scene show takes the overview off, in SceneActivated's own transaction", () => {
    const t = setup();
    const scn = t.battle();
    const id = t.create();
    t.run(I.show, { overviewId: id });
    t.run(MAP_INTENTS.activateScene, { sceneId: scn });
    expect(t.row(id).active).toBe(false);
    expect(t.sceneRow(scn)?.active).toBe(true);
    const e = t.events.at(-1)?.event;
    expect(e?.type).toBe("SceneActivated");
    expect(e?.changes.find((c) => c.type === OVERVIEW_TYPE)).toMatchObject({
      id,
      before: { active: true },
      after: { active: false },
    });
  });

  test("FR-OVW-06 at most one of scene and overview, always", () => {
    const t = setup();
    const scenes = [t.battle("S1"), t.battle("S2")];
    const overviews = [t.create("O1"), t.create("O2")];
    const steps: [string, object][] = [
      [MAP_INTENTS.activateScene, { sceneId: scenes[0] }],
      [I.show, { overviewId: overviews[0] }],
      [I.show, { overviewId: overviews[1] }],
      [MAP_INTENTS.activateScene, { sceneId: scenes[1] }],
      [MAP_INTENTS.activateScene, { sceneId: scenes[0] }],
      [I.show, { overviewId: overviews[1] }],
      [I.show, { overviewId: overviews[1] }],
    ];
    for (const [name, input] of steps) {
      t.run(name, input);
      const on = t.s.db.$client
        .query<{ n: number }, []>(
          "SELECT (SELECT count(*) FROM scene WHERE active = 1) + (SELECT count(*) FROM overview WHERE active = 1) AS n",
        )
        .get();
      expect(on?.n).toBe(1);
    }
  });

  test("FR-OVW-07 the resolver answers the shown thing; activeSceneOf stays battle-only", () => {
    const t = setup();
    const scn = t.battle();
    const id = t.create();
    expect(t.shown()).toBeNull();
    t.run(MAP_INTENTS.activateScene, { sceneId: scn });
    expect(t.shown()).toBe(scn);
    expect(t.battleActive()).toBe(scn);
    t.run(I.show, { overviewId: id });
    expect(t.shown()).toBe(id);
    expect(t.battleActive()).toBeNull();
    t.run(MAP_INTENTS.activateScene, { sceneId: scn });
    expect(t.shown()).toBe(scn);
    expect(t.battleActive()).toBe(scn);
  });

  test("FR-OVW-07 the cache refreshes before listeners run", () => {
    const t = setup();
    const id = t.create();
    const seen: (string | null)[] = [];
    t.s.bus.subscribe("seen", ({ event }) => {
      if (event.type === "OverviewShown") seen.push(t.shown());
    });
    t.run(I.show, { overviewId: id });
    expect(seen).toEqual([id]);
  });

  test("FR-OVW-07 sync.loadScene's scope check answers overview IDs and other campaigns'", () => {
    const t = setup();
    const id = t.create();
    expect(t.s.records.sceneCampaignOf(id)).toBe(t.cid);
    expect(sceneCampaignOf(t.s.db, t.battle())).toBe(t.cid);
    expect(t.s.records.sceneCampaignOf("nope")).toBeNull();
    const theirs = t.run<{ overviewId: string }>(I.create, { name: "T" }, t.h.dmSecond).overviewId;
    expect(t.s.records.sceneCampaignOf(theirs)).toBe(t.h.secondCampaignId);
  });

  test("FR-OVW-48 after a restart the cache rebuilds from the DB", () => {
    const t = setup();
    const id = t.create();
    t.run(I.show, { overviewId: id });
    const again = createServices({
      config: createTestServices().config,
      db: t.s.db,
      log: silentLogger,
    });
    expect(again.records.activeSceneOf(t.cid)).toBe(id);
  });
});

describe("FR-OVW-44 sceneHooks.deactivated", () => {
  test("FR-OVW-44 runs for the scene that went off, in the Show; its rows join the event", () => {
    const t = setup();
    const scn = t.battle();
    t.run(MAP_INTENTS.activateScene, { sceneId: scn });
    const id = t.create();
    const seen: { id: string; active: boolean; overviewOn: boolean }[] = [];
    lifecycleHooks.register({
      name: "test.deactivated",
      deactivated({ tx }, s) {
        const on = tx.select().from(overview).where(eq(overview.id, id)).get()?.active ?? false;
        seen.push({ id: s.id, active: s.active, overviewOn: on });
        return [{ type: "test-row", id: "r", before: null, after: { x: 1 } }];
      },
    });
    try {
      t.run(I.show, { overviewId: id });
      expect(seen).toEqual([{ id: scn, active: false, overviewOn: true }]);
      expect(t.events.at(-1)?.event.changes.map((c) => c.type)).toContain("test-row");
      // No scene went off: not run. A plain scene switch: `activated` covers it, not run either.
      t.run(I.show, { overviewId: t.create("Other") });
      t.run(MAP_INTENTS.activateScene, { sceneId: scn });
      t.run(MAP_INTENTS.activateScene, { sceneId: t.battle("Second") });
      expect(seen.length).toBe(1);
    } finally {
      lifecycleHooks.unregister("test.deactivated");
    }
  });

  test("FR-OVW-44 a throw in the hook rolls the whole Show back", () => {
    const t = setup();
    const scn = t.battle();
    t.run(MAP_INTENTS.activateScene, { sceneId: scn });
    const id = t.create();
    lifecycleHooks.register({
      name: "test.throw",
      deactivated() {
        throw new Error("boom");
      },
    });
    try {
      expect(t.code(() => t.run(I.show, { overviewId: id }))).toBe("internal");
    } finally {
      lifecycleHooks.unregister("test.throw");
    }
    expect(t.row(id).active).toBe(false);
    expect(t.sceneRow(scn)?.active).toBe(true);
    expect(t.shown()).toBe(scn);
  });
});

describe("FR-OVW-45 asset use kind", () => {
  test("FR-OVW-45 an item's asset blocks the delete and is named once per overview", () => {
    const t = setup();
    const a = t.create("Alpha");
    const b = t.create("Beta");
    t.image(a);
    t.image(a, { x: 50 });
    const last = t.image(b);
    const uses = () =>
      t.run<{ uses: unknown[] }>(ASSET_MANAGE_INTENTS.uses, { assetId: "map-town" }).uses;
    const want = [
      { kind: "overview image", name: "Alpha" },
      { kind: "overview image", name: "Beta" },
    ];
    expect(uses()).toEqual(want);
    const refused = t.err(() => t.run(ASSET_MANAGE_INTENTS.delete, { assetId: "map-town" }));
    expect(refused).toMatchObject({
      code: "conflict",
      message: inUseMessage(want as Parameters<typeof inUseMessage>[0]),
    });
    expect(refused.message).toBe(
      "In use: Alpha (overview image), Beta (overview image). Change those first.",
    );
    t.run(I.delete, { overviewId: a });
    t.run(I.deleteItems, { overviewId: b, itemIds: [last] });
    expect(uses()).toEqual([]);
    t.run(ASSET_MANAGE_INTENTS.delete, { assetId: "map-town" });
  });

  test("FR-OVW-45 a miniature's picture counts too", () => {
    const t = setup();
    const id = t.create("Alpha");
    insertMiniature(t.s.db, {
      id: "mini",
      campaignId: t.cid,
      overviewId: id,
      assetId: "art-mira",
    });
    expect(t.code(() => t.run(ASSET_MANAGE_INTENTS.delete, { assetId: "art-mira" }))).toBe(
      "conflict",
    );
  });
});

describe("FR-OVW-15–27 items", () => {
  test("FR-OVW-22 image: assets.require; another campaign's or a sound → refused", () => {
    const t = setup();
    const id = t.create();
    const item = t.item(t.image(id, { hidden: true }));
    expect(item).toMatchObject({
      kind: "image",
      assetId: "map-town",
      w: 2100,
      h: 1400,
      hidden: true,
      locked: false,
      text: null,
      style: null,
    });
    expect(t.code(() => t.image(id, { assetId: "art-other" }))).toBe("not_found");
    expect(t.code(() => t.image(id, { assetId: "nope" }))).toBe("not_found");
    expect(t.code(() => t.image("nope"))).toBe("not_found");
  });

  test("FR-OVW-25 label: no size, no asset, text and style stored", () => {
    const t = setup();
    const id = t.create();
    const it = t.item(t.label(id, { text: "  Thundertree " }));
    expect(it).toMatchObject({
      kind: "label",
      text: "Thundertree",
      w: null,
      h: null,
      assetId: null,
      style: LABEL_STYLE_DEFAULT,
    });
    expect(t.logTypes().at(-1)).toBe("OverviewItemsPlaced");
  });

  test("FR-OVW-15 caps: ≤ 300 per overview, ≤ 3,000 per campaign", () => {
    const t = setup();
    const full = t.create("Full");
    fillItems(t, full, ITEMS_PER_OVERVIEW_MAX);
    expect(t.code(() => t.label(full))).toBe("conflict");
    expect(t.code(() => t.image(full))).toBe("conflict");
    const near = t.create("Near");
    fillItems(t, near, ITEMS_PER_OVERVIEW_MAX - 1);
    const a = t.label(near);
    expect(t.code(() => t.run(I.duplicateItems, { overviewId: near, itemIds: [a] }))).toBe(
      "conflict",
    );
    const other = t.create("Other");
    // 300 + 300 so far; bring the campaign to its cap with overviews of 300.
    for (let i = 0; i < 8; i++) fillItems(t, t.create(`Bulk ${i}`), ITEMS_PER_OVERVIEW_MAX);
    expect(t.code(() => t.label(other))).toBe("conflict");
  });

  test("FR-OVW-15 anywhere within ±16384: the far corners take an item", () => {
    const t = setup();
    const id = t.create();
    expect(t.item(t.label(id, { x: -16384, y: 16384 }))).toMatchObject({ x: -16384, y: 16384 });
    expect(t.code(() => t.label(id, { x: 16384.01 }))).toBe("invalid");
    expect(t.code(() => t.label(id, { y: 1.234 }))).toBe("invalid");
  });

  test("FR-OVW-17 move: all or nothing, not logged", () => {
    const t = setup();
    const id = t.create();
    const a = t.label(id);
    const b = t.label(id);
    const logged = t.logTypes().length;
    t.run(I.moveItems, {
      overviewId: id,
      moves: [
        { itemId: a, x: 1.5, y: 2.5 },
        { itemId: b, x: -3, y: -4 },
      ],
    });
    expect(t.item(a)).toMatchObject({ x: 1.5, y: 2.5 });
    expect(t.item(b)).toMatchObject({ x: -3, y: -4 });
    const e = t.events.at(-1)?.event;
    expect(e).toMatchObject({ type: "OverviewItemsMoved", payload: { overviewId: id } });
    expect((e?.payload as { itemIds: string[] } | undefined)?.itemIds.sort()).toEqual(
      [a, b].sort(),
    );
    expect(t.logTypes().length).toBe(logged);

    // One bad item: nothing moves.
    for (const bad of ["nope"]) {
      expect(
        t.code(() =>
          t.run(I.moveItems, {
            overviewId: id,
            moves: [
              { itemId: a, x: 99, y: 99 },
              { itemId: bad, x: 0, y: 0 },
            ],
          }),
        ),
      ).toBe("not_found");
    }
    expect(t.item(a)).toMatchObject({ x: 1.5, y: 2.5 });
    // Out of bounds on one: the schema refuses the whole intent.
    expect(
      t.code(() =>
        t.run(I.moveItems, {
          overviewId: id,
          moves: [
            { itemId: a, x: 99, y: 99 },
            { itemId: b, x: 17000, y: 0 },
          ],
        }),
      ),
    ).toBe("invalid");
    expect(t.item(a)).toMatchObject({ x: 1.5, y: 2.5 });
  });

  test("FR-OVW-17 a locked item → conflict, nothing moves; unchanged → no event", () => {
    const t = setup();
    const id = t.create();
    const a = t.label(id);
    const locked = t.image(id);
    t.run(I.updateItems, { overviewId: id, items: [{ itemId: locked, locked: true }] });
    const moves = [
      { itemId: a, x: 7, y: 7 },
      { itemId: locked, x: 8, y: 8 },
    ];
    expect(t.code(() => t.run(I.moveItems, { overviewId: id, moves }))).toBe("conflict");
    expect(t.item(a)).toMatchObject({ x: 10, y: 20 });
    const events = t.events.length;
    t.run(I.moveItems, { overviewId: id, moves: [{ itemId: a, x: 10, y: 20 }] });
    expect(t.events.length).toBe(events);
  });

  test("FR-OVW-17 an item of another overview or campaign looks unknown, on every group intent", () => {
    const t = setup();
    const a = t.create("A");
    const b = t.create("B");
    const onB = t.label(b);
    const theirs = t.run<{ overviewId: string }>(I.create, { name: "T" }, t.h.dmSecond).overviewId;
    const theirItem = t.run<{ itemId: string }>(
      I.placeLabel,
      { overviewId: theirs, x: 0, y: 0, text: "T", style: LABEL_STYLE_DEFAULT },
      t.h.dmSecond,
    ).itemId;
    for (const itemId of [onB, theirItem]) {
      for (const [name, input] of [
        [I.moveItems, { overviewId: a, moves: [{ itemId, x: 0, y: 0 }] }],
        [I.updateItems, { overviewId: a, items: [{ itemId, hidden: true }] }],
        [I.duplicateItems, { overviewId: a, itemIds: [itemId] }],
        [I.deleteItems, { overviewId: a, itemIds: [itemId] }],
      ] as const) {
        expect(t.code(() => t.run(name, input))).toBe("not_found");
      }
    }
    expect(t.code(() => t.run(I.deleteItems, { overviewId: theirs, itemIds: [theirItem] }))).toBe(
      "not_found",
    );
  });

  test("FR-OVW-19 stack: new items on top of their band; front and back act within it", () => {
    const t = setup();
    const id = t.create();
    const m1 = t.image(id);
    const l1 = t.label(id);
    const l2 = t.label(id);
    const m2 = t.image(id);
    const z = (i: string) => t.item(i).z;
    expect([z(m1), z(m2), z(l1), z(l2)]).toEqual([0, 1, 0, 1]);
    t.run(I.updateItems, { overviewId: id, items: [{ itemId: l1, stack: "front" }] });
    expect(z(l1)).toBe(2);
    expect(z(m2)).toBe(1);
    t.run(I.updateItems, { overviewId: id, items: [{ itemId: m2, stack: "back" }] });
    expect(z(m2)).toBe(-1);
    expect(z(m1)).toBe(0);
    expect(z(l2)).toBe(1);
  });

  test("FR-OVW-19 a group keeps its own order", () => {
    const t = setup();
    const id = t.create();
    const a = t.label(id);
    const b = t.label(id);
    const c = t.label(id);
    const d = t.image(id);
    t.run(I.updateItems, {
      overviewId: id,
      items: [
        { itemId: c, stack: "back" },
        { itemId: b, stack: "back" },
        { itemId: d, stack: "front" },
      ],
    });
    const z = (i: string) => t.item(i).z;
    expect(z(b)).toBeLessThan(z(c));
    expect(z(c)).toBeLessThan(z(a));
    expect(z(d)).toBe(1);
  });

  test("FR-OVW-21 hide and reveal, lock and unlock; unchanged → no event", () => {
    const t = setup();
    const id = t.create();
    const a = t.image(id);
    t.run(I.updateItems, { overviewId: id, items: [{ itemId: a, hidden: true, locked: true }] });
    expect(t.item(a)).toMatchObject({ hidden: true, locked: true });
    expect(t.events.at(-1)?.event.type).toBe("OverviewItemsUpdated");
    const events = t.events.length;
    t.run(I.updateItems, { overviewId: id, items: [{ itemId: a, hidden: true, locked: true }] });
    expect(t.events.length).toBe(events);
  });

  test("FR-OVW-23 resize keeps within bounds; a locked item keeps its place and size", () => {
    const t = setup();
    const id = t.create();
    const a = t.image(id);
    t.run(I.updateItems, {
      overviewId: id,
      items: [{ itemId: a, x: -10, y: -20, w: 1050, h: 700 }],
    });
    expect(t.item(a)).toMatchObject({ x: -10, y: -20, w: 1050, h: 700 });
    for (const w of [7, 16385]) {
      expect(
        t.code(() => t.run(I.updateItems, { overviewId: id, items: [{ itemId: a, w }] })),
      ).toBe("invalid");
    }
    t.run(I.updateItems, { overviewId: id, items: [{ itemId: a, locked: true }] });
    for (const patch of [{ w: 500 }, { h: 500 }, { x: 1 }, { y: 1 }]) {
      expect(
        t.code(() => t.run(I.updateItems, { overviewId: id, items: [{ itemId: a, ...patch }] })),
      ).toBe("conflict");
    }
    // The menu still works on a locked item (hide, unlock).
    t.run(I.updateItems, { overviewId: id, items: [{ itemId: a, hidden: true }] });
    t.run(I.updateItems, { overviewId: id, items: [{ itemId: a, locked: false }] });
    t.run(I.updateItems, { overviewId: id, items: [{ itemId: a, w: 500 }] });
    expect(t.item(a).w).toBe(500);
  });

  test("FR-OVW-23 Image… swaps the picture and takes the new shape", () => {
    const t = setup();
    const id = t.create();
    const a = t.image(id);
    t.run(I.updateItems, {
      overviewId: id,
      items: [{ itemId: a, assetId: "map-battle", h: 1470 }],
    });
    expect(t.item(a)).toMatchObject({ assetId: "map-battle", w: 2100, h: 1470 });
    expect(
      t.code(() =>
        t.run(I.updateItems, { overviewId: id, items: [{ itemId: a, assetId: "art-other" }] }),
      ),
    ).toBe("not_found");
  });

  test("FR-OVW-24 the server checks bounds only; no caption on an image", () => {
    const t = setup();
    const id = t.create();
    const a = t.image(id);
    t.run(I.updateItems, { overviewId: id, items: [{ itemId: a, w: 8, h: 16384 }] });
    expect(t.item(a)).toMatchObject({ w: 8, h: 16384 });
    for (const patch of [{ text: "Caption" }, { style: LABEL_STYLE_DEFAULT }]) {
      expect(
        t.code(() => t.run(I.updateItems, { overviewId: id, items: [{ itemId: a, ...patch }] })),
      ).toBe("invalid");
    }
  });

  test("FR-OVW-26 edit text: clean and one line; a label takes no size or picture", () => {
    const t = setup();
    const id = t.create();
    const a = t.label(id);
    t.run(I.updateItems, { overviewId: id, items: [{ itemId: a, text: "  Waterdeep " }] });
    expect(t.item(a).text).toBe("Waterdeep");
    for (const patch of [
      { text: "" },
      { text: "   " },
      { text: "x".repeat(81) },
      { text: "a\nb" },
      { w: 100 },
      { h: 100 },
      { assetId: "map-town" },
    ]) {
      expect(
        t.code(() => t.run(I.updateItems, { overviewId: id, items: [{ itemId: a, ...patch }] })),
      ).toBe("invalid");
    }
    expect(t.item(a).text).toBe("Waterdeep");
  });

  test("FR-OVW-27 style: restyle many at once; a label needs its dot; bounds refuse", () => {
    const t = setup();
    const id = t.create();
    const a = t.label(id);
    const b = t.label(id);
    const style = { ...LABEL_STYLE_DEFAULT, font: "fell" as const, color: "#ABCDEF" };
    t.run(I.updateItems, {
      overviewId: id,
      items: [
        { itemId: a, style },
        { itemId: b, style },
      ],
    });
    for (const i of [a, b]) expect(t.item(i).style).toEqual({ ...style, color: "#abcdef" });
    const events = t.events.length;
    t.run(I.updateItems, { overviewId: id, items: [{ itemId: a, style }] });
    expect(t.events.length).toBe(events);
    for (const bad of [
      MINIATURE_STYLE,
      { ...LABEL_STYLE_DEFAULT, size: 513 },
      { ...LABEL_STYLE_DEFAULT, font: "comic" },
      { ...LABEL_STYLE_DEFAULT, extra: 1 },
    ]) {
      expect(
        t.code(() => t.run(I.updateItems, { overviewId: id, items: [{ itemId: a, style: bad }] })),
      ).toBe("invalid");
      expect(t.code(() => t.label(id, { style: bad }))).toBe("invalid");
    }
  });

  test("FR-OVW-21 update is all or nothing: one bad patch writes nothing", () => {
    const t = setup();
    const id = t.create();
    const a = t.label(id);
    const b = t.image(id);
    expect(
      t.code(() =>
        t.run(I.updateItems, {
          overviewId: id,
          items: [
            { itemId: a, text: "Changed" },
            { itemId: b, text: "A caption" },
          ],
        }),
      ),
    ).toBe("invalid");
    expect(t.item(a).text).toBe("Neverwinter");
  });

  test("FR-OVW-21 duplicate: a copy on top of its band, a little off; flags kept", () => {
    const t = setup();
    const id = t.create();
    const a = t.image(id, { hidden: true });
    const b = t.label(id, { x: 16380, y: -16384 });
    t.run(I.updateItems, { overviewId: id, items: [{ itemId: a, locked: true }] });
    const { itemIds } = t.run<{ itemIds: string[] }>(I.duplicateItems, {
      overviewId: id,
      itemIds: [a, b],
    });
    const [ca, cb] = itemIds.map(t.item);
    expect(ca).toMatchObject({
      x: 24,
      y: 24,
      z: 1,
      hidden: true,
      locked: true,
      assetId: "map-town",
    });
    expect(cb).toMatchObject({ x: 16384, y: -16360, z: 1, text: "Neverwinter" });
    expect(t.events.at(-1)?.event.type).toBe("OverviewItemsPlaced");
  });

  test("FR-OVW-31 a linked miniature's copy loses the link: one per character per overview", () => {
    const t = setup();
    const id = t.create();
    insertMiniature(t.s.db, {
      id: "mini",
      campaignId: t.cid,
      overviewId: id,
      characterId: t.miraId,
      ownerPlayerId: t.h.p1.id,
    });
    const { itemIds } = t.run<{ itemIds: string[] }>(I.duplicateItems, {
      overviewId: id,
      itemIds: ["mini"],
    });
    expect(t.item(itemIds[0] as string)).toMatchObject({
      characterId: null,
      ownerPlayerId: t.h.p1.id,
      kind: "miniature",
    });
  });

  test("FR-OVW-34 a miniature stays square, 8–4096; FR-OVW-33 a linked one's name follows", () => {
    const t = setup();
    const id = t.create();
    insertMiniature(t.s.db, { id: "free", campaignId: t.cid, overviewId: id });
    insertMiniature(t.s.db, {
      id: "tied",
      campaignId: t.cid,
      overviewId: id,
      characterId: t.miraId,
    });
    const update = (itemId: string, patch: object) =>
      t.run(I.updateItems, { overviewId: id, items: [{ itemId, ...patch }] });
    update("free", { w: 128, h: 128 });
    expect(t.item("free")).toMatchObject({ w: 128, h: 128 });
    for (const bad of [
      { w: 128, h: 64 },
      { w: 64 },
      { h: 64 },
      { w: 4097, h: 4097 },
      { w: 7, h: 7 },
    ]) {
      expect(t.code(() => update("free", bad))).toBe("invalid");
    }
    update("free", { text: "The Party", style: MINIATURE_STYLE });
    expect(t.item("free").text).toBe("The Party");
    update("free", { text: "" });
    expect(t.item("free").text).toBe("");
    expect(t.code(() => update("free", { text: "x".repeat(41) }))).toBe("invalid");
    expect(t.code(() => update("free", { style: LABEL_STYLE_DEFAULT }))).toBe("invalid");
    expect(t.code(() => update("tied", { text: "Renamed" }))).toBe("conflict");
    expect(t.code(() => update("tied", { assetId: "art-mira" }))).toBe("conflict");
    update("tied", { hidden: true });
    expect(t.item("tied").hidden).toBe(true);
  });

  test("FR-OVW-21 delete: all or nothing, the rest stay", () => {
    const t = setup();
    const id = t.create();
    const a = t.label(id);
    const b = t.label(id);
    expect(t.code(() => t.run(I.deleteItems, { overviewId: id, itemIds: [a, "nope"] }))).toBe(
      "not_found",
    );
    expect(t.item(a)).toBeDefined();
    t.run(I.deleteItems, { overviewId: id, itemIds: [a] });
    expect(t.item(a)).toBeUndefined();
    expect(t.item(b)).toBeDefined();
    expect(t.events.at(-1)?.event).toMatchObject({
      type: "OverviewItemsDeleted",
      payload: { overviewId: id, itemIds: [a] },
    });
  });
});

describe("FR-OVW-31–34 miniatures", () => {
  function party() {
    const t = setup();
    const id = t.create();
    const add = (overviewId = id, over: object = {}) =>
      t.run<AddPartyResult>(I.addParty, { overviewId, x: 1000, y: 500, size: 100, ...over });
    /** `entities.update` replaces the whole body. */
    const update = (patch: object) =>
      t.run(UPDATE, {
        id: t.miraId,
        name: "Mira",
        ownerPlayerId: t.h.p1.id,
        portraitAssetId: "art-mira",
        statBlock: miraBlock,
        ...patch,
      });
    const count = (overviewId: string) =>
      t.s.db.select().from(overviewItem).where(eq(overviewItem.overviewId, overviewId)).all()
        .length;
    return { ...t, id, add, update, count };
  }

  test("FR-OVW-31 add party", () => {
    const t = party();
    t.update({ tokenShape: "square" });

    const first = t.add();
    expect(first.itemIds.length).toBe(2);
    const [a, b] = first.itemIds.map(t.item) as [OverviewItemRecord, OverviewItemRecord];
    // In `partyOf`'s order; name, image and owner from the character; the name's default style.
    expect(a).toMatchObject({
      kind: "miniature",
      text: "Mira",
      characterId: t.miraId,
      ownerPlayerId: t.h.p1.id,
      assetId: "art-mira",
      shape: "square",
      w: 100,
      h: 100,
      hidden: false,
      style: newMiniatureStyle(100),
    });
    expect(b).toMatchObject({
      text: "Thorn",
      characterId: t.thornId,
      ownerPlayerId: t.h.p2.id,
      assetId: null,
      shape: "round",
    });
    // A row around x, y.
    expect(a.y).toBe(450);
    expect(b.y).toBe(450);
    expect((a.x + b.x + 100) / 2).toBe(1000);
    expect(b.x - a.x).toBe(125);
    expect(b.z).toBeGreaterThan(a.z);

    // Twice: no duplicates, no event, the ack says so.
    const dispatched = t.events.length;
    expect(t.add().itemIds).toEqual([]);
    expect(t.events.length).toBe(dispatched);
    expect(t.count(t.id)).toBe(2);

    // A new character: only they are missing. A deleted miniature comes back.
    t.run(createEntity.name, {
      kind: "character",
      name: "Ana",
      ownerPlayerId: t.h.p2.id,
      statBlock: miraBlock,
    });
    expect(t.add().itemIds.map((i) => t.item(i).text)).toEqual(["Ana"]);
    t.run(I.deleteItems, { overviewId: t.id, itemIds: [a.id] });
    expect(t.add().itemIds.map((i) => t.item(i).text)).toEqual(["Mira"]);
    expect(t.count(t.id)).toBe(3);
  });

  test("FR-OVW-31 hidden with Add hidden; caps all or nothing; DM only; a character with no owner", () => {
    const t = party();
    expect(t.add(t.id, { hidden: true }).itemIds.map((i) => t.item(i).hidden)).toEqual([
      true,
      true,
    ]);

    const full = t.create("Full");
    for (let i = 0; i < ITEMS_PER_OVERVIEW_MAX - 1; i++) {
      insertMiniature(t.s.db, { id: `m${i}`, campaignId: t.cid, overviewId: full });
    }
    expect(t.code(() => t.add(full))).toBe("conflict");
    expect(t.count(full)).toBe(ITEMS_PER_OVERVIEW_MAX - 1);

    expect(t.code(() => t.add("nope"))).toBe("not_found");
    const input = { overviewId: t.id, x: 0, y: 0, size: 64 };
    expect(t.code(() => t.run(I.addParty, input, t.player(t.h.p1)))).toBe("forbidden");

    // §11: its miniature has no owner.
    t.s.db.update(entity).set({ ownerPlayerId: null }).where(eq(entity.id, t.thornId)).run();
    const next = t.create("Next");
    const thorn = t.add(next).itemIds.map(t.item)[1];
    expect(thorn).toMatchObject({ text: "Thorn", ownerPlayerId: null });
  });

  test("FR-OVW-32 add miniature: name and owner optional, no link", () => {
    const t = party();
    const place = (over: object = {}) =>
      t.run<{ itemId: string }>(I.placeMiniature, {
        overviewId: t.id,
        assetId: "map-town",
        x: 10,
        y: 20,
        size: 64,
        ...over,
      }).itemId;
    expect(t.item(place())).toMatchObject({
      kind: "miniature",
      assetId: "map-town",
      x: 10,
      y: 20,
      w: 64,
      h: 64,
      text: null,
      ownerPlayerId: null,
      characterId: null,
      hidden: false,
      shape: "round",
      style: MINIATURE_STYLE,
    });
    expect(
      t.item(place({ text: "  The Party ", ownerPlayerId: t.h.p1.id, hidden: true })),
    ).toMatchObject({ text: "The Party", ownerPlayerId: t.h.p1.id, hidden: true });
    expect(t.item(place({ text: "" })).text).toBeNull();

    expect(t.code(() => place({ text: "x".repeat(41) }))).toBe("invalid");
    expect(t.code(() => place({ ownerPlayerId: "nobody" }))).toBe("invalid");
    expect(t.code(() => place({ assetId: "nope" }))).toBe("not_found");
    expect(t.code(() => place({ overviewId: "nope" }))).toBe("not_found");
    const input = { overviewId: t.id, assetId: "map-town", x: 0, y: 0, size: 64 };
    expect(t.code(() => t.run(I.placeMiniature, input, t.player(t.h.p1)))).toBe("forbidden");
  });

  test("FR-OVW-33 name, art and owner follow, in the update's event", () => {
    const t = party();
    const here = t.add().itemIds[0] as string;
    const next = t.create("Phandalin");
    const there = t.add(next).itemIds[0] as string;
    t.run(I.moveItems, { overviewId: t.id, moves: [{ itemId: here, x: 7, y: 8 }] });

    t.update({ name: "Mira the Bold", ownerPlayerId: t.h.p2.id, portraitAssetId: "map-battle" });
    for (const id of [here, there]) {
      expect(t.item(id)).toMatchObject({
        text: "Mira the Bold",
        ownerPlayerId: t.h.p2.id,
        assetId: "map-battle",
      });
    }
    const last = t.events.at(-1)?.event;
    expect(last?.type).toBe("EntityUpdated");
    expect(last?.changes.map((c) => c.id)).toEqual(expect.arrayContaining([here, there]));
    // Where it stands and how big it is stay.
    expect(t.item(here)).toMatchObject({ x: 7, y: 8, w: 100 });

    // No art → token art; a name past 40 is cut (entities allow 60).
    t.update({ portraitAssetId: null, name: "x".repeat(60) });
    expect(t.item(here)).toMatchObject({ assetId: null, text: "x".repeat(40) });

    // An unlinked copy doesn't follow.
    const copy = t.run<{ itemIds: string[] }>(I.duplicateItems, {
      overviewId: t.id,
      itemIds: [here],
    }).itemIds[0] as string;
    t.update({ name: "Mira" });
    expect(t.item(here).text).toBe("Mira");
    expect(t.item(copy).text).toBe("x".repeat(40));
  });

  test("FR-OVW-33 an edit that fails later in the update leaves the miniature as it was", () => {
    const t = party();
    const id = t.add().itemIds[0] as string;
    definitionHooksOf(t.s).register("test.throw", () => {
      throw new Error("boom");
    });
    expect(() => t.update({ name: "Renamed" })).toThrow();
    expect(t.item(id).text).toBe("Mira");
  });

  test("FR-OVW-33 Name, Image and Owner refused when linked; Shape and handles aren't", () => {
    const t = party();
    const id = t.add().itemIds[0] as string;
    const patch = (over: object) =>
      t.run(I.updateItems, { overviewId: t.id, items: [{ itemId: id, ...over }] });
    expect(t.code(() => patch({ text: "Other" }))).toBe("conflict");
    expect(t.code(() => patch({ assetId: "map-town" }))).toBe("conflict");
    expect(t.code(() => patch({ ownerPlayerId: t.h.p2.id }))).toBe("conflict");
    expect(t.code(() => patch({ ownerPlayerId: null }))).toBe("conflict");
    patch({ shape: "none", w: 200, h: 200 });
    expect(t.item(id)).toMatchObject({ shape: "none", w: 200, h: 200, text: "Mira" });
  });

  test("FR-OVW-32 FR-OVW-34 an unlinked miniature takes a name, image, shape and owner", () => {
    const t = party();
    const id = t.run<{ itemId: string }>(I.placeMiniature, {
      overviewId: t.id,
      assetId: "map-town",
      x: 0,
      y: 0,
      size: 64,
    }).itemId;
    const patch = (over: object) =>
      t.run(I.updateItems, { overviewId: t.id, items: [{ itemId: id, ...over }] });
    patch({ text: "Ship", assetId: "map-battle", shape: "square", ownerPlayerId: t.h.p2.id });
    expect(t.item(id)).toMatchObject({
      text: "Ship",
      assetId: "map-battle",
      shape: "square",
      ownerPlayerId: t.h.p2.id,
    });
    patch({ ownerPlayerId: null, text: "" });
    expect(t.item(id)).toMatchObject({ ownerPlayerId: null, text: "" });
    expect(t.code(() => patch({ ownerPlayerId: "nobody" }))).toBe("invalid");
    expect(t.code(() => patch({ shape: "hexagon" }))).toBe("invalid");

    // Shape and owner only on a miniature.
    const label = t.label(t.id);
    for (const over of [{ shape: "round" }, { ownerPlayerId: null }]) {
      expect(
        t.code(() =>
          t.run(I.updateItems, { overviewId: t.id, items: [{ itemId: label, ...over }] }),
        ),
      ).toBe("invalid");
    }
  });

  test("FR-OVW-34 size bounds: 8–4096 and square", () => {
    const t = party();
    const place = (size: number) =>
      t.run<{ itemId: string }>(I.placeMiniature, {
        overviewId: t.id,
        assetId: "map-town",
        x: 0,
        y: 0,
        size,
      }).itemId;
    const id = place(8);
    expect(t.item(place(4096)).w).toBe(4096);
    for (const size of [7.99, 4096.01, 64.123]) expect(t.code(() => place(size))).toBe("invalid");
    expect(t.code(() => t.add(t.id, { size: 7 }))).toBe("invalid");
    expect(t.code(() => t.add(t.id, { size: 5000 }))).toBe("invalid");

    const size = (w: number, h: number) =>
      t.run(I.updateItems, { overviewId: t.id, items: [{ itemId: id, w, h }] });
    size(4096, 4096);
    expect(t.item(id)).toMatchObject({ w: 4096, h: 4096 });
    expect(t.code(() => size(4097, 4097))).toBe("invalid");
    expect(t.code(() => size(7, 7))).toBe("invalid");
    expect(t.code(() => size(100, 200))).toBe("invalid");
  });

  test("FR-OVW-36 a new miniature's name starts at 14 ÷ the placer's zoom, inside 8–512", () => {
    const t = party();
    const nameSize = (id: string) => (t.item(id).style as { size: number }).size;
    const place = (size: number) =>
      t.run<{ itemId: string }>(I.placeMiniature, {
        overviewId: t.id,
        assetId: "map-town",
        x: 0,
        y: 0,
        size,
      }).itemId;
    // size = 64 ÷ zoom: 100 % → 14, 30 % → 46.67, 400 % → 3.5, so the floor; a huge one, the ceiling.
    expect(nameSize(place(64))).toBe(14);
    expect(nameSize(place(213.33))).toBe(46.67);
    expect(nameSize(place(16))).toBe(8);
    expect(nameSize(place(4096))).toBe(512);
    // The rest of the default style stays; Add party takes the same rule.
    const [mira] = t.add(t.id, { size: 213.33 }).itemIds;
    expect(t.item(mira as string).style).toEqual({ ...MINIATURE_STYLE, size: 46.67 });
    // Resizing later leaves the name alone.
    t.run(I.updateItems, {
      overviewId: t.id,
      items: [{ itemId: mira as string, w: 64, h: 64 }],
    });
    expect(nameSize(mira as string)).toBe(46.67);
  });

  test("FR-OVW-38 miniatures stay where they are; Add party on the next overview adds who's missing", () => {
    const t = party();
    const here = t.add().itemIds[0] as string;
    t.run(I.show, { overviewId: t.id });
    const at = t.item(here);
    const next = t.create("Phandalin");
    t.run(I.show, { overviewId: next });
    expect(t.item(here)).toMatchObject({ overviewId: t.id, x: at.x, y: at.y });
    const there = t.add(next).itemIds[0] as string;
    expect(there).not.toBe(here);
    expect(t.item(there).overviewId).toBe(next);
    expect(t.count(t.id)).toBe(2);
    t.run(I.show, { overviewId: t.id });
    expect(t.add().itemIds).toEqual([]);
  });
});

describe("FR-OVW-35 who moves", () => {
  function miniatures() {
    const t = setup();
    const id = t.create();
    const off = t.create("Not shown");
    const add = (itemId: string, over: object = {}, overviewId = id) =>
      insertMiniature(t.s.db, {
        id: itemId,
        campaignId: t.cid,
        overviewId,
        ownerPlayerId: t.h.p1.id,
        ...over,
      });
    add("own");
    add("theirs", { ownerPlayerId: t.h.p2.id });
    add("nobody", { ownerPlayerId: null });
    add("hidden", { hidden: true });
    add("locked", { locked: true });
    add("off", {}, off);
    const map = t.image(id);
    t.run(I.show, { overviewId: id });
    const move = (itemId: string, overviewId = id, actor = t.player(t.h.p1)) => {
      t.run(I.moveItems, { overviewId, moves: [{ itemId, x: 500, y: 600 }] }, actor);
    };
    return { ...t, id, off, map, move };
  }

  test("FR-OVW-35 player moves own only", () => {
    const t = miniatures();
    t.move("own");
    expect(t.item("own")).toMatchObject({ x: 500, y: 600 });
    expect(t.code(() => t.move("theirs"))).toBe("forbidden");
    expect(t.code(() => t.move("nobody"))).toBe("forbidden");
    expect(t.code(() => t.move(t.map))).toBe("forbidden");
    expect(t.item("theirs")).toMatchObject({ x: 100, y: 100 });
  });

  test("FR-OVW-35 hidden, not shown or unknown → not_found", () => {
    const t = miniatures();
    expect(t.code(() => t.move("hidden"))).toBe("not_found");
    expect(t.code(() => t.move("off", t.off))).toBe("not_found");
    expect(t.code(() => t.move("off"))).toBe("not_found");
    expect(t.code(() => t.move("nope"))).toBe("not_found");
    expect(t.code(() => t.move("own", t.off))).toBe("not_found");
    expect(t.code(() => t.move("own", "nope"))).toBe("not_found");
  });

  test("FR-OVW-35 hidden is checked before ownership: another's hidden item looks unknown", () => {
    const t = miniatures();
    insertMiniature(t.s.db, {
      id: "their-hidden",
      campaignId: t.cid,
      overviewId: t.id,
      ownerPlayerId: t.h.p2.id,
      hidden: true,
    });
    expect(t.code(() => t.move("their-hidden"))).toBe("not_found");
  });

  test("FR-OVW-35 a moved-off overview: the shown thing changed → not_found", () => {
    const t = miniatures();
    t.run(MAP_INTENTS.activateScene, { sceneId: t.battle() });
    expect(t.code(() => t.move("own"))).toBe("not_found");
    t.run(I.show, { overviewId: t.off });
    expect(t.code(() => t.move("own"))).toBe("not_found");
    t.move("off", t.off);
    expect(t.item("off")).toMatchObject({ x: 500 });
  });

  test("FR-OVW-35 one item at a time; moves only; the DM moves any", () => {
    const t = miniatures();
    const two = {
      overviewId: t.id,
      moves: [
        { itemId: "own", x: 1, y: 1 },
        { itemId: "locked", x: 1, y: 1 },
      ],
    };
    expect(t.code(() => t.run(I.moveItems, two, t.player(t.h.p1)))).toBe("invalid");
    for (const [name, input] of [
      [I.updateItems, { overviewId: t.id, items: [{ itemId: "own", w: 100, h: 100 }] }],
      [I.deleteItems, { overviewId: t.id, itemIds: ["own"] }],
      [I.duplicateItems, { overviewId: t.id, itemIds: ["own"] }],
      [I.placeLabel, { overviewId: t.id, x: 0, y: 0, text: "x", style: LABEL_STYLE_DEFAULT }],
    ] as const) {
      expect(t.code(() => t.run(name, input, t.player(t.h.p1)))).toBe("forbidden");
    }
    // A locked own miniature: as for the DM.
    expect(t.code(() => t.move("locked"))).toBe("conflict");
    // The DM moves anyone's, hidden, or on an overview not shown.
    for (const [itemId, overviewId] of [
      ["theirs", t.id],
      ["hidden", t.id],
      ["off", t.off],
    ] as const) {
      t.run(I.moveItems, { overviewId, moves: [{ itemId, x: 9, y: 9 }] });
      expect(t.item(itemId)).toMatchObject({ x: 9, y: 9 });
    }
  });

  test("FR-OVW-35 another campaign's player can't reach it", () => {
    const t = miniatures();
    const outsider = {
      role: "player" as const,
      playerId: t.h.p3.id,
      campaignId: t.h.secondCampaignId,
    };
    expect(t.code(() => t.move("own", t.id, outsider))).toBe("not_found");
  });
});
