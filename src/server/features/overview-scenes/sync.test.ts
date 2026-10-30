// OVW §13 integration over real sockets on `overview-scenes`: what each role receives, the leak
// scan over snapshots, frames, acks and loads, reconnect, and the CON-44 sizes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { loadBundle } from "@fixtures/index";
import {
  OVW_INTENTS as I,
  LABEL_STYLE_DEFAULT,
  OVERVIEW_ITEM_TYPE,
  OVERVIEW_TYPE,
  type OverviewItemRecord,
  type OverviewRecord,
  type PlayerOverviewItemRecord,
} from "@shared/overview-scenes/schemas";
import { MAP_INTENTS, SCENE_TYPE, TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { closeDb, type Db, openFileDb } from "../../db/client";
import { asset, overview, overviewItem, player, scene } from "../../db/schema";
import { readEventLog } from "../../events/log";
import { startTestServer, type TestClient, type TestServer } from "../../testing/harness";
import { TEST_SECRET } from "../../testing/services";
import { convergence, leakScan } from "../../ws/testing/convergence";
import { insertMiniature } from "./testing";

const DM = { role: "dm" as const, secret: TEST_SECRET };

/** CON-44 as the spec states it (OVW §12). */
const CEILING = { dm: 768 * 1024, player: 512 * 1024 };

const barrier = async (c: TestClient) => {
  c.send({ type: "ping" });
  await c.next("pong");
};
async function intent(c: TestClient, name: string, payload: unknown) {
  const id = c.intent(name, payload);
  for (;;) {
    const f = await c.next(undefined, 3000);
    if ((f.type === "ack" || f.type === "reject") && f.intentId === id) return f;
  }
}
async function ok<R = unknown>(c: TestClient, name: string, payload: unknown): Promise<R> {
  const f = await intent(c, name, payload);
  if (f.type !== "ack") throw new Error(`${name} rejected: ${JSON.stringify(f)}`);
  return f.result as R;
}
/** A Show or a scene switch: every player gets a fresh snapshot. */
const resynced = async (c: TestClient) => {
  await c.next("snapshot", 3000);
  await barrier(c);
};
const items = <R = PlayerOverviewItemRecord>(c: TestClient) =>
  Object.values(c.store.records[OVERVIEW_ITEM_TYPE] ?? {}) as R[];
const overviews = <R = OverviewRecord>(c: TestClient) =>
  Object.values(c.store.records[OVERVIEW_TYPE] ?? {}) as R[];

describe("overview scenes over WS (overview-scenes)", () => {
  let h: TestServer;
  let db: Db;
  let dir: string;
  let links: Record<string, string>;
  let playerIds: Record<string, string>;
  let campaignId: string;
  const ov: Record<string, string> = {};
  const it: Record<string, string> = {};
  let scrollAsset: string;
  let townScene: string;
  const pc = (name: string) => ({ role: "player" as const, token: links[name] as string });

  /** Strings no player may hold while the item is hidden or the overview isn't shown. */
  const secrets = () => [
    "Cragmaw Castle",
    "Sword Coast",
    "Crowded Coast",
    scrollAsset,
    it.cragmaw as string,
    it.scroll as string,
    it.hiddenMini as string,
    ov["Phandalin"] as string,
    ov["Crowded Coast"] as string,
    it.phandalinMap as string,
    '"locked"',
    "Place 1",
  ];
  const leaks = (c: TestClient) => secrets().filter((s) => c.raw().includes(s));

  beforeAll(async () => {
    const loaded = await loadBundle("overview-scenes", { dmSecret: TEST_SECRET, testMode: true });
    dir = loaded.dir;
    db = openFileDb(loaded.config.dbPath);
    const players = db.select().from(player).all();
    links = Object.fromEntries(players.map((p) => [p.name, p.linkToken]));
    playerIds = Object.fromEntries(players.map((p) => [p.name, p.id]));
    for (const o of db.select().from(overview).all()) {
      ov[o.name] = o.id;
      campaignId = o.campaignId;
    }
    for (const i of db.select().from(overviewItem).all()) {
      if (i.overviewId === ov["Phandalin"]) it.phandalinMap = i.id;
      if (i.overviewId !== ov["Sword Coast"]) continue;
      if (i.text === "Cragmaw Castle") it.cragmaw = i.id;
      if (i.text === "Neverwinter") it.neverwinter = i.id;
      if (i.kind === "image" && i.locked) it.map = i.id;
      if (i.kind === "image" && i.hidden) {
        it.scroll = i.id;
        scrollAsset = i.assetId as string;
      }
    }
    townScene = db
      .select()
      .from(scene)
      .all()
      .find((s) => s.name === "Town")?.id as string;
    // Test-only path until the miniatures slice (`ovw.placeMiniature`, `ovw.addParty`).
    const coast = ov["Sword Coast"] as string;
    const mini = (id: string, over: object = {}) =>
      insertMiniature(db, { id, campaignId, overviewId: coast, ...over });
    it.ownMini = "ovw-test-own-mini";
    it.otherMini = "ovw-test-other-mini";
    it.hiddenMini = "ovw-test-hidden-mini";
    mini(it.ownMini, { ownerPlayerId: playerIds["Player 1"] });
    mini(it.otherMini, { ownerPlayerId: playerIds["Player 2"] });
    mini(it.hiddenMini, { ownerPlayerId: playerIds["Player 1"], hidden: true });
    h = await startTestServer({ db, fake: false, testMode: true });
  }, 60_000);

  afterAll(async () => {
    await h.stop();
    closeDb(db);
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows may hold the WAL briefly; a leftover temp dir is harmless.
    }
  });

  test("FR-OVW-08 DM snapshot: every overview, the shown one's items; others load", async () => {
    const dm = await h.live(DM);
    expect(
      overviews(dm)
        .map((o) => o.name)
        .sort(),
    ).toEqual(["Crowded Coast", "Phandalin", "Sword Coast"]);
    expect([...new Set(items<OverviewItemRecord>(dm).map((i) => i.overviewId))]).toEqual([
      ov["Sword Coast"] as string,
    ]);
    // Three miniatures (test path) + map, three labels, scroll.
    expect(items(dm).length).toBe(8);
    expect(items<OverviewItemRecord>(dm).find((i) => i.id === it.map)).toMatchObject({
      locked: true,
    });
    dm.loadScene(ov["Phandalin"] as string);
    await dm.next("ack", 3000);
    expect(items(dm).map((i) => i.id)).toContain(it.phandalinMap as string);
    dm.close();
  });

  test("FR-OVW-39 visibility: player gets the shown overview and its visible items, minus locked", async () => {
    const p1 = await h.live(pc("Player 1"));
    expect(overviews(p1)).toEqual([{ id: ov["Sword Coast"], campaignId, active: true } as never]);
    const held = items(p1);
    expect(held.map((i) => i.id).sort()).toEqual(
      [it.map, it.neverwinter, it.ownMini, it.otherMini]
        .concat(
          db
            .select()
            .from(overviewItem)
            .all()
            .filter((i) => i.text === "Phandalin")
            .map((i) => i.id),
        )
        .sort() as string[],
    );
    for (const i of held) {
      expect(Object.keys(i).sort()).toEqual(
        [
          "assetId",
          "campaignId",
          "characterId",
          "h",
          "hidden",
          "id",
          "kind",
          "overviewId",
          "ownerPlayerId",
          "seq",
          "shape",
          "style",
          "text",
          "w",
          "x",
          "y",
          "z",
        ].sort(),
      );
      expect(i.hidden).toBe(false);
    }
    // Not the battle scene's rows, and no DM-only list of folders.
    expect(Object.keys(p1.store.records[SCENE_TYPE] ?? {})).toEqual([]);
    expect(Object.keys(p1.store.records[TOKEN_TYPE] ?? {})).toEqual([]);
    expect(p1.store.records["scene-folder"]).toBeUndefined();
    expect(leakScan(h.s, p1)).toEqual([]);
    p1.close();
  });

  test("FR-OVW-39 reveal = upsert, hide = delete; a lock change reaches no player", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(pc("Player 1"));
    const coast = ov["Sword Coast"] as string;
    const update = (itemId: string, patch: object) =>
      ok(dm, I.updateItems, { overviewId: coast, items: [{ itemId, ...patch }] });

    const sent = () => p1.frames.flatMap((f) => (f.type === "event" ? f.changes : []));

    await update(it.neverwinter as string, { locked: true });
    await update(it.neverwinter as string, { locked: false });
    await barrier(p1);
    expect(sent()).toEqual([]);

    await update(it.cragmaw as string, { hidden: false });
    await barrier(p1);
    expect(sent()).toEqual([
      expect.objectContaining({ type: OVERVIEW_ITEM_TYPE, id: it.cragmaw, op: "upsert" }),
    ]);
    await update(it.cragmaw as string, { hidden: true });
    await barrier(p1);
    expect(sent().at(-1)).toEqual({
      type: OVERVIEW_ITEM_TYPE,
      id: it.cragmaw as string,
      op: "delete",
    });
    dm.close();
    p1.close();
  });

  test("FR-OVW-35 a player's move reaches everyone, not logged; another's → forbidden", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(pc("Player 1"));
    const p2 = await h.live(pc("Player 2"));
    const coast = ov["Sword Coast"] as string;
    const logged = readEventLog(db).length;
    await ok(p1, I.moveItems, {
      overviewId: coast,
      moves: [{ itemId: it.ownMini, x: 300, y: 400 }],
    });
    for (const c of [dm, p2]) {
      await barrier(c);
      expect(c.store.records[OVERVIEW_ITEM_TYPE]?.[it.ownMini as string]).toMatchObject({
        x: 300,
        y: 400,
      });
    }
    expect(readEventLog(db).length).toBe(logged);
    const move = (itemId: string) =>
      intent(p1, I.moveItems, { overviewId: coast, moves: [{ itemId, x: 1, y: 1 }] });
    expect(await move(it.otherMini as string)).toMatchObject({ code: "forbidden" });
    expect(await move(it.hiddenMini as string)).toMatchObject({ code: "not_found" });
    expect(await move("nope")).toMatchObject({ code: "not_found" });
    expect(await move(it.map as string)).toMatchObject({ code: "forbidden" });
    for (const c of [dm, p1, p2]) c.close();
  });

  test("FR-OVW-40 leak scan over snapshot, frames, loads, before and after a reveal, a Show and a reconnect", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(pc("Player 1"));
    const p2 = await h.live(pc("Player 2"));
    const coast = ov["Sword Coast"] as string;
    const phandalin = ov["Phandalin"] as string;
    const check = async (c: TestClient) => {
      await barrier(c);
      expect(leaks(c)).toEqual([]);
      expect(leakScan(h.s, c)).toEqual([]);
    };
    for (const c of [p1, p2]) await check(c);

    // Live edits of hidden items, and of an overview not shown: nothing at all.
    const placed = await ok<{ itemId: string }>(dm, I.placeLabel, {
      overviewId: coast,
      x: 1,
      y: 1,
      text: "Secret Grove",
      style: LABEL_STYLE_DEFAULT,
      hidden: true,
    });
    await ok(dm, I.moveItems, {
      overviewId: coast,
      moves: [{ itemId: placed.itemId, x: 2, y: 2 }],
    });
    await ok(dm, I.updateItems, {
      overviewId: coast,
      items: [{ itemId: placed.itemId, text: "Secret Grove Two" }],
    });
    await ok(dm, I.duplicateItems, { overviewId: coast, itemIds: [placed.itemId] });
    await ok(dm, I.placeLabel, {
      overviewId: phandalin,
      x: 1,
      y: 1,
      text: "Barthen's Provisions",
      style: LABEL_STYLE_DEFAULT,
    });
    await ok(dm, I.update, { overviewId: phandalin, name: "Renamed Secretly" });
    await ok(dm, I.create, { name: "Prep For Later" });
    for (const c of [p1, p2]) {
      await check(c);
      for (const s of [
        "Secret Grove",
        placed.itemId,
        "Barthen",
        "Renamed Secretly",
        "Prep For Later",
      ]) {
        expect(c.raw()).not.toContain(s);
      }
    }

    // A player's refused intents and loads say nothing.
    expect(await intent(p1, "sync.loadScene", { sceneId: phandalin })).toMatchObject({
      code: "forbidden",
    });
    expect(await intent(p1, I.show, { overviewId: phandalin })).toMatchObject({
      code: "forbidden",
    });
    await check(p1);

    // Delete a hidden item: nothing to tell.
    await ok(dm, I.deleteItems, { overviewId: coast, itemIds: [placed.itemId] });
    for (const c of [p1, p2]) await check(c);

    // Show something else and back: the resync brings only what's visible.
    dm.intent(I.show, { overviewId: phandalin });
    for (const c of [p1, p2]) await resynced(c);
    expect(items(p1).map((i) => i.overviewId)).not.toContain(coast);
    expect(leakScan(h.s, p1)).toEqual([]);
    dm.intent(I.show, { overviewId: coast });
    for (const c of [p1, p2]) await resynced(c);
    await barrier(dm);
    expect(items(p1).map((i) => i.overviewId)).not.toContain(phandalin);
    expect(leakScan(h.s, p1)).toEqual([]);

    // A battle scene and back: its rows come and go; hidden items still don't.
    dm.intent(MAP_INTENTS.activateScene, { sceneId: townScene });
    for (const c of [p1, p2]) await resynced(c);
    expect(overviews(p1)).toEqual([]);
    expect(items(p1)).toEqual([]);
    dm.intent(I.show, { overviewId: coast });
    for (const c of [p1, p2]) await resynced(c);
    await barrier(dm);

    // Reconnect.
    p2.close();
    const again = await h.live(pc("Player 2"));
    await check(again);
    for (const s of ["Cragmaw Castle", it.cragmaw as string, scrollAsset]) {
      expect(again.raw()).not.toContain(s);
    }

    // After the reveal the scroll's asset may reach them, and only then.
    await ok(dm, I.updateItems, {
      overviewId: coast,
      items: [{ itemId: it.scroll, hidden: false }],
    });
    await barrier(again);
    expect(again.raw()).toContain(scrollAsset);
    expect(leakScan(h.s, again)).toEqual([]);
    await ok(dm, I.updateItems, {
      overviewId: coast,
      items: [{ itemId: it.scroll, hidden: true }],
    });
    await barrier(again);
    expect(again.store.records[OVERVIEW_ITEM_TYPE]?.[it.scroll as string]).toBeUndefined();
    expect(leakScan(h.s, again)).toEqual([]);

    await ok(dm, I.update, { overviewId: phandalin, name: "Phandalin" });
    for (const c of [dm, p1, again]) c.close();
  }, 30_000);

  test("FR-OVW-41 Show removes the battle scene's rows from players and the reverse, by resync", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(pc("Player 1"));
    dm.intent(MAP_INTENTS.activateScene, { sceneId: townScene });
    await resynced(p1);
    expect(Object.keys(p1.store.records[TOKEN_TYPE] ?? {}).length).toBeGreaterThan(0);
    expect(overviews(p1)).toEqual([]);
    dm.intent(I.show, { overviewId: ov["Sword Coast"] });
    await resynced(p1);
    expect(Object.keys(p1.store.records[TOKEN_TYPE] ?? {})).toEqual([]);
    expect(Object.keys(p1.store.records[SCENE_TYPE] ?? {})).toEqual([]);
    expect(overviews(p1).length).toBe(1);
    dm.close();
    p1.close();
  });

  test("FR-OVW-47 reconnect: the snapshot carries the shown overview and its items; both stores converge", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(pc("Player 1"));
    const coast = ov["Sword Coast"] as string;
    // A change while connected, then a change while away.
    await ok(dm, I.moveItems, {
      overviewId: coast,
      moves: [{ itemId: it.neverwinter, x: 11, y: 12 }],
    });
    await barrier(p1);
    p1.close();
    await ok(dm, I.moveItems, {
      overviewId: coast,
      moves: [{ itemId: it.neverwinter, x: 13, y: 14 }],
    });
    const back = await h.live(pc("Player 1"));
    expect(overviews(back).length).toBe(1);
    expect(back.store.records[OVERVIEW_ITEM_TYPE]?.[it.neverwinter as string]).toMatchObject({
      x: 13,
      y: 14,
    });
    // Convergence: a live client equals a fresh snapshot, player and DM.
    const p2 = await h.live(pc("Player 2"));
    await ok(dm, I.moveItems, {
      overviewId: coast,
      moves: [{ itemId: it.neverwinter, x: 15, y: 16 }],
    });
    await ok(dm, I.updateItems, {
      overviewId: coast,
      items: [{ itemId: it.neverwinter, text: "Neverwinter", hidden: true }],
    });
    await ok(dm, I.updateItems, {
      overviewId: coast,
      items: [{ itemId: it.neverwinter, hidden: false }],
    });
    await barrier(p2);
    const fresh = await h.live(pc("Player 2"));
    const c = convergence(h.s, p2, fresh);
    expect(c.live).toEqual(c.fresh);
    const phandalin = ov["Phandalin"] as string;
    dm.loadScene(phandalin);
    const dmFresh = await h.live(DM);
    dmFresh.loadScene(phandalin);
    await barrier(dm);
    await barrier(dmFresh);
    const d = convergence(h.s, dm, dmFresh, [phandalin]);
    expect(d.live).toEqual(d.fresh);
    for (const x of [dm, dmFresh, back, p2, fresh]) x.close();
  });

  test("FR-OVW-08 CON-44: 300 items and 50 overviews stay under the ceilings", async () => {
    const dm = await h.live(DM);
    const p1 = await h.live(pc("Player 1"));
    const crowd = ov["Crowded Coast"] as string;
    const existing = db.select().from(overview).all().length;
    for (let i = existing; i < 50; i++) {
      await ok(dm, I.create, {
        name: `${"Overview name of sixty characters long, near the cap "}${i}`,
      });
    }
    dm.intent(I.show, { overviewId: crowd });
    await resynced(p1);
    await barrier(dm);
    const dmFresh = await h.live(DM);
    const p1Fresh = await h.live(pc("Player 1"));

    const bytes = (o: unknown) => Buffer.byteLength(JSON.stringify(o), "utf8");
    const snap = (c: TestClient) => {
      const f = c.frames.find((x) => x.type === "snapshot");
      return {
        total: bytes(f),
        own: bytes(c.store.records[OVERVIEW_ITEM_TYPE]) + bytes(c.store.records[OVERVIEW_TYPE]),
      };
    };
    const dmItems = items<OverviewItemRecord>(dmFresh);
    const labels = dmItems.filter((i) => i.kind === "label");
    const images = dmItems.filter((i) => i.kind === "image");
    const widest = {
      ...(labels[0] as OverviewItemRecord),
      text: "x".repeat(80),
      assetId: "x".repeat(22),
    };
    const measured = {
      dmSnapshot: snap(dmFresh).total,
      playerSnapshot: snap(p1Fresh).total,
      dmOverviewPart: snap(dmFresh).own,
      playerOverviewPart: snap(p1Fresh).own,
      itemLabel: Math.round(bytes(labels) / labels.length),
      itemImage: Math.round(bytes(images) / images.length),
      itemWorst: bytes(widest),
      overviewRow: Math.round(bytes(overviews(dmFresh)) / overviews(dmFresh).length),
      items: dmItems.length,
      overviews: overviews(dmFresh).length,
    };
    // Measured at build (protocol §190): label 594 B, image 436 B, widest row 684 B, overview 277 B.
    expect(measured.itemWorst).toBeLessThan(800);
    expect(measured.overviewRow).toBeLessThan(400);
    expect(measured.items).toBe(300);
    expect(measured.overviews).toBe(50);
    expect(measured.dmSnapshot).toBeLessThan(CEILING.dm);
    expect(measured.playerSnapshot).toBeLessThan(CEILING.player);
    for (const c of [dm, dmFresh, p1, p1Fresh]) c.close();
  }, 30_000);

  test("FR-OVW-22 a placed image's asset is the campaign's: an unknown one is refused over WS", async () => {
    const dm = await h.live(DM);
    const assetId = db.select().from(asset).all()[0]?.id as string;
    expect(
      await intent(dm, I.placeImage, {
        overviewId: ov["Sword Coast"],
        assetId: "nope",
        x: 0,
        y: 0,
        w: 100,
        h: 100,
      }),
    ).toMatchObject({ code: "not_found" });
    expect(
      await intent(dm, I.placeImage, {
        overviewId: ov["Sword Coast"],
        assetId,
        x: 0,
        y: 0,
        w: 1,
        h: 100,
      }),
    ).toMatchObject({ code: "invalid" });
    dm.close();
  });
});
