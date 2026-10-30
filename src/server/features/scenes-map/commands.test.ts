import { describe, expect, test } from "bun:test";
import type { EntityRecord } from "@shared/entities/schemas";
import { FOG_INTENTS } from "@shared/fog-of-war/schemas";
import type { SceneFolderRecord, SceneRecord, TokenRecord } from "@shared/scenes-map/schemas";
import { MAP_INTENTS as I } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { seededContext } from "../../commands/context";
import { conflict } from "../../commands/errors";
import { scene, token } from "../../db/schema";
import { readEventLog } from "../../events/log";
import type { RecordChange } from "../../events/types";
import { createEntity, UPDATE } from "../entities/commands";
import { goblinBlock } from "../entities/testing";
import { MAP_REST as R } from "./commands";
import { addAsset, scenesSetup } from "./testing";
import { tokenHooksOf } from "./token-hooks";

function setup() {
  const t = scenesSetup();
  // FR-FOG-25 ripple: new scenes start fogged; the helper reveals them unless `revealed` is false.
  const newScene = (name = "Goblin Ambush", mapAssetId = "map-battle", revealed = true) => {
    const s = t.run<SceneRecord>(R.createScene, { name, mapAssetId });
    if (revealed) t.run(FOG_INTENTS.setAll, { sceneId: s.id, fogged: false });
    return s;
  };
  const place = (sceneId: string, definitionId: string, col: number, row: number, extra = {}) => {
    const { tokenId } = t.run<{ tokenId: string }>(I.placeToken, {
      sceneId,
      definitionId,
      col,
      row,
      ...extra,
    });
    return tokenRow(tokenId);
  };
  const tokenRow = (id: string) =>
    t.s.db.select().from(token).where(eq(token.id, id)).get() as TokenRecord;
  const sceneRow = (id: string) =>
    t.s.db.select().from(scene).where(eq(scene.id, id)).get() as SceneRecord;
  const lastEvent = () => t.events.at(-1)?.event;
  return { ...t, newScene, place, tokenRow, sceneRow, lastEvent };
}

describe("scenes-map commands", () => {
  test("FR-MAP-01 / -27 create: defaults, display size, inactive; row + log + event, IDs from ctx", () => {
    const t = setup();
    const before = readEventLog(t.s.db).length;
    const s = t.run<SceneRecord>(
      R.createScene,
      { name: "  Town ", mapAssetId: "map-town" },
      t.h.dm,
      "fixture-x",
    );
    const ctx = seededContext({ disposable: true, key: "fixture-x" });
    expect(s).toMatchObject({
      id: ctx.ids.next(),
      name: "Town",
      folderId: null,
      mapAssetId: "map-town",
      mapWidth: 2100,
      mapHeight: 1400,
      gridCellSize: 70,
      gridOffsetX: 0,
      gridOffsetY: 0,
      gridVisible: true,
      gridColor: "#000000",
      gridOpacity: 0.5,
      mapLocked: false,
      active: false,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(
      readEventLog(t.s.db)
        .slice(before)
        .map((l) => [l.type, l.payload]),
    ).toEqual([["SceneCreated", { sceneId: s.id }]]);
    // FR-FOG-02: the new scene's fully fogged `fog` row joins SceneCreated.
    expect(t.lastEvent()?.changes).toEqual([
      { type: "scene", id: s.id, before: null, after: s },
      expect.objectContaining({ type: "fog", id: s.id, before: null }),
    ]);
    // Another campaign's asset → not_found; nothing written.
    const n = t.count("scene");
    expect(t.err(() => t.run(R.createScene, { name: "X", mapAssetId: "art-other" })).code).toBe(
      "not_found",
    );
    expect(t.count("scene")).toBe(n);
  });

  test("FR-MAP-02 / -03 folders: create, rename, move scene, delete → scenes to root", () => {
    const t = setup();
    const f = t.run<SceneFolderRecord>(R.createFolder, { name: "Act 1" });
    const s = t.newScene();
    t.run(R.updateScene, { id: s.id, folderId: f.id, name: "Ambush" });
    expect(t.sceneRow(s.id)).toMatchObject({ folderId: f.id, name: "Ambush" });
    expect(t.run<SceneFolderRecord>(R.renameFolder, { id: f.id, name: "Act One" }).name).toBe(
      "Act One",
    );
    expect(t.err(() => t.run(R.createFolder, { name: "x".repeat(41) })).code).toBe("invalid");
    expect(t.err(() => t.run(R.updateScene, { id: s.id, folderId: "nope" })).code).toBe(
      "not_found",
    );
    t.run(R.deleteFolder, { id: f.id });
    expect(t.sceneRow(s.id).folderId).toBeNull();
    const ev = t.lastEvent();
    expect(ev?.type).toBe("SceneFolderDeleted");
    expect(ev?.changes.map((c) => [c.type, c.after === null ? "delete" : "upsert"])).toEqual([
      ["scene", "upsert"],
      ["scene-folder", "delete"],
    ]);
  });

  test("FR-MAP-06 / -07 activate: one active per campaign, both flags in one event; idempotent", () => {
    const t = setup();
    const town = t.newScene("Town", "map-town");
    const battle = t.newScene();
    expect(t.s.records.activeSceneOf(t.h.campaignId)).toBeNull();
    t.run(I.activateScene, { sceneId: town.id });
    expect(t.s.records.activeSceneOf(t.h.campaignId)).toBe(town.id);
    t.run(I.activateScene, { sceneId: battle.id });
    const ev = t.lastEvent();
    expect(ev?.payload).toEqual({ sceneId: battle.id, previousSceneId: town.id });
    expect(ev?.changes.map((c) => [c.id, (c.after as SceneRecord).active])).toEqual([
      [town.id, false],
      [battle.id, true],
    ]);
    expect(t.s.records.activeSceneOf(t.h.campaignId)).toBe(battle.id);
    const n = t.events.length;
    t.run(I.activateScene, { sceneId: battle.id });
    expect(t.events.length).toBe(n);
    // Second active impossible (partial unique index, OQ-MAP-18).
    expect(() =>
      t.s.db.update(scene).set({ active: true }).where(eq(scene.id, town.id)).run(),
    ).toThrow();
  });

  test("FR-MAP-09 / -10 / -11 map, grid, lock; locked → conflict", () => {
    const t = setup();
    const s = t.newScene();
    t.run(I.setSceneMap, { sceneId: s.id, mapAssetId: "map-town" });
    expect(t.sceneRow(s.id)).toMatchObject({ mapAssetId: "map-town", mapWidth: 2100 });
    const grid = {
      sceneId: s.id,
      cellSize: 52,
      offsetX: 25,
      offsetY: 10,
      visible: false,
      color: "#FFFFFF",
      opacity: 0.3,
    };
    t.run(I.setGrid, grid);
    expect(t.sceneRow(s.id)).toMatchObject({
      gridCellSize: 52,
      gridOffsetX: 25,
      gridVisible: false,
      gridColor: "#ffffff",
      gridOpacity: 0.3,
    });
    expect(t.lastEvent()?.type).toBe("SceneUpdated");
    expect(t.err(() => t.run(I.setGrid, { ...grid, offsetX: 52 })).code).toBe("invalid");
    t.run(I.setLocked, { sceneId: s.id, locked: true });
    expect(t.err(() => t.run(I.setGrid, grid)).code).toBe("conflict");
    expect(
      t.err(() => t.run(I.setSceneMap, { sceneId: s.id, mapAssetId: "map-battle" })).code,
    ).toBe("conflict");
    t.run(I.setLocked, { sceneId: s.id, locked: false });
    t.run(I.setGrid, { ...grid, cellSize: 70 });
  });

  test("FR-MAP-13 / -16 place: definition name numbered, portrait, size, character owner", () => {
    const t = setup();
    const s = t.newScene();
    const g1 = t.place(s.id, t.h.goblinId, 12, 6);
    expect(g1).toMatchObject({
      name: "Goblin",
      size: "small",
      imageAssetId: null,
      ownerPlayerId: null,
      hidden: false,
      definitionId: t.h.goblinId,
      // FR-ENT-27: the test goblin has no `type` (a pre-S4 definition).
      creatureType: null,
    });
    expect(t.place(s.id, t.h.goblinId, 13, 6).name).toBe("Goblin 2");
    expect(t.place(s.id, t.h.goblinId, 14, 6).name).toBe("Goblin 3");
    const mira = t.place(s.id, t.miraId, 2, 7);
    expect(mira).toMatchObject({
      name: "Mira",
      imageAssetId: "art-mira",
      ownerPlayerId: t.h.p1.id,
      size: "medium",
      creatureType: null,
    });
    // Fixture overrides; never size.
    const wolf = t.place(s.id, t.h.wolfId, 14, 4, { hidden: true, imageAssetId: "art-elite" });
    expect(wolf).toMatchObject({ hidden: true, imageAssetId: "art-elite" });
    expect(t.err(() => t.place(s.id, t.h.wolfId, 1, 1, { size: "huge" })).code).toBe("invalid");
    expect(t.err(() => t.place(s.id, "unknown-def", 1, 1)).code).toBe("not_found");
    expect(t.err(() => t.place(s.id, t.h.wolfId, 1, 1, { ownerPlayerId: t.h.p3.id })).code).toBe(
      "invalid",
    );
    expect(t.lastEvent()?.type).toBe("TokenPlaced");
  });

  test("FR-MAP-14 off-map → invalid; caps → conflict", () => {
    const t = setup();
    const s = t.newScene();
    expect(t.err(() => t.place(s.id, t.h.goblinId, 20, 0)).code).toBe("invalid");
    expect(t.err(() => t.place(s.id, t.h.goblinId, -1, 0)).code).toBe("invalid");
    const n = t.count("token");
    for (let i = 0; i < 200; i++) {
      t.s.db.$client.run(
        `INSERT INTO token (id, campaign_id, scene_id, definition_id, seq, name, size, col, row, hidden, created_at, updated_at) VALUES ('cap-${i}', '${t.h.campaignId}', '${s.id}', '${t.h.goblinId}', ${1000 + i}, 'x', 'small', 0, 0, 0, 't', 't')`,
      );
    }
    expect(t.err(() => t.place(s.id, t.h.goblinId, 1, 1)).code).toBe("conflict");
    expect(t.count("token")).toBe(n + 200);
  });

  test("FR-MAP-15 / -21 / -27 move: player owns ✓, other → forbidden, hidden → not_found; not logged", () => {
    const t = setup();
    const s = t.newScene();
    t.run(I.activateScene, { sceneId: s.id });
    const mira = t.place(s.id, t.miraId, 5, 5);
    const goblin = t.place(s.id, t.h.goblinId, 12, 6);
    const wolf = t.place(s.id, t.h.wolfId, 14, 4, { hidden: true });
    const p1 = t.player(t.h.p1);
    const logBefore = readEventLog(t.s.db).length;
    t.run(I.moveToken, { tokenId: mira.id, col: 8, row: 5 }, p1);
    expect(t.tokenRow(mira.id)).toMatchObject({ col: 8, row: 5 });
    expect(t.lastEvent()).toMatchObject({
      type: "TokenMoved",
      payload: { tokenId: mira.id, sceneId: s.id, col: 8, row: 5 },
    });
    expect(readEventLog(t.s.db).length).toBe(logBefore);
    expect(t.err(() => t.run(I.moveToken, { tokenId: goblin.id, col: 1, row: 1 }, p1)).code).toBe(
      "forbidden",
    );
    expect(t.err(() => t.run(I.moveToken, { tokenId: wolf.id, col: 1, row: 1 }, p1)).code).toBe(
      "not_found",
    );
    expect(t.err(() => t.run(I.moveToken, { tokenId: "nope", col: 1, row: 1 }, p1)).code).toBe(
      "not_found",
    );
    // Off the active scene → not visible → not_found; DM moves anything anywhere.
    const other = t.newScene("Cellar");
    const miraElsewhere = t.place(other.id, t.miraId, 1, 1);
    expect(
      t.err(() => t.run(I.moveToken, { tokenId: miraElsewhere.id, col: 2, row: 2 }, p1)).code,
    ).toBe("not_found");
    t.run(I.moveToken, { tokenId: wolf.id, col: 3, row: 3 });
    t.run(I.moveToken, { tokenId: miraElsewhere.id, col: 2, row: 2 });
    // Off the map → invalid; other player's other actions are DM only.
    expect(t.err(() => t.run(I.moveToken, { tokenId: mira.id, col: 99, row: 5 }, p1)).code).toBe(
      "invalid",
    );
    expect(t.err(() => t.run(I.setTokenHidden, { tokenId: mira.id, hidden: true }, p1)).code).toBe(
      "forbidden",
    );
  });

  test("FR-MAP-18 update: rename, image, owner reassignment; never size", () => {
    const t = setup();
    const s = t.newScene();
    const thorn = t.place(s.id, t.thornId, 4, 5);
    expect(thorn.ownerPlayerId).toBe(t.h.p2.id);
    t.run(I.updateToken, {
      tokenId: thorn.id,
      name: "Thorn the Bold",
      imageAssetId: "art-elite",
      ownerPlayerId: t.h.p1.id,
    });
    expect(t.tokenRow(thorn.id)).toMatchObject({
      name: "Thorn the Bold",
      imageAssetId: "art-elite",
      ownerPlayerId: t.h.p1.id,
    });
    expect(t.lastEvent()?.type).toBe("TokenUpdated");
    t.run(I.updateToken, { tokenId: thorn.id, ownerPlayerId: null, imageAssetId: null });
    expect(t.tokenRow(thorn.id)).toMatchObject({ ownerPlayerId: null, imageAssetId: null });
    expect(
      t.err(() => t.run(I.updateToken, { tokenId: thorn.id, imageAssetId: "art-other" })).code,
    ).toBe("not_found");
    expect(t.err(() => t.run(I.updateToken, { tokenId: thorn.id, size: "huge" })).code).toBe(
      "invalid",
    );
    // Another campaign's DM can't reach it.
    expect(
      t.err(() => t.run(I.updateToken, { tokenId: thorn.id, name: "x" }, t.h.dmSecond)).code,
    ).toBe("not_found");
  });

  test("FR-MAP-19 hide / reveal events; unchanged → no event", () => {
    const t = setup();
    const s = t.newScene();
    const wolf = t.place(s.id, t.h.wolfId, 14, 4);
    t.run(I.setTokenHidden, { tokenId: wolf.id, hidden: true });
    expect(t.lastEvent()?.type).toBe("TokenHidden");
    const n = t.events.length;
    t.run(I.setTokenHidden, { tokenId: wolf.id, hidden: true });
    expect(t.events.length).toBe(n);
    t.run(I.setTokenHidden, { tokenId: wolf.id, hidden: false });
    expect(t.lastEvent()?.type).toBe("TokenRevealed");
    expect(t.logTypes().slice(-2)).toEqual(["TokenHidden", "TokenRevealed"]);
  });

  test("FR-MAP-17 duplicate token: numbered, right else left, copies hidden/owner/image", () => {
    const t = setup();
    const s = t.newScene();
    const goblin = t.place(s.id, t.h.goblinId, 12, 6, { hidden: true, imageAssetId: "art-elite" });
    const { tokenId } = t.run<{ tokenId: string }>(I.duplicateToken, { tokenId: goblin.id });
    expect(t.tokenRow(tokenId)).toMatchObject({
      name: "Goblin 2",
      col: 13,
      row: 6,
      hidden: true,
      imageAssetId: "art-elite",
      definitionId: t.h.goblinId,
      size: "small",
    });
    const edge = t.place(s.id, t.miraId, 19, 3);
    const copy = t.run<{ tokenId: string }>(I.duplicateToken, { tokenId: edge.id });
    expect(t.tokenRow(copy.tokenId)).toMatchObject({ col: 18, row: 3, name: "Mira 2" });
    expect(t.lastEvent()?.type).toBe("TokenDuplicated");
  });

  test("BL-163 duplicate lands on a free cell: right, left, ring; hidden tokens and the source count", () => {
    const t = setup();
    const s = t.newScene();
    const dup = (tokenId: string) => t.run<{ tokenId: string }>(I.duplicateToken, { tokenId });
    const goblin = t.place(s.id, t.h.goblinId, 5, 5);
    const right = dup(goblin.id);
    expect(t.tokenRow(right.tokenId)).toMatchObject({ col: 6, row: 5, name: "Goblin 2" });
    t.run(I.deleteToken, { tokenId: right.tokenId });
    // A hidden token blocks the right cell.
    t.place(s.id, t.h.wolfId, 6, 5, { hidden: true });
    const left = dup(goblin.id);
    expect(t.tokenRow(left.tokenId)).toMatchObject({ col: 4, row: 5, name: "Goblin 2" });
    // Both occupied → ring 1. The command returns the copy (the client selects it, FR-MAP-17).
    const ring = dup(goblin.id);
    expect(ring.tokenId).not.toBe(goblin.id);
    expect(t.tokenRow(ring.tokenId)).toMatchObject({ col: 4, row: 4, name: "Goblin 3" });
    expect(t.lastEvent()).toMatchObject({
      type: "TokenDuplicated",
      payload: { tokenId: ring.tokenId, sourceTokenId: goblin.id },
    });
  });

  test("BL-163 duplicate on a full map stays on the source cell", () => {
    const t = setup();
    addAsset(t.s, "map-closet", t.h.campaignId, { w: 140, h: 70 }); // 2 × 1 cells
    const s = t.newScene("Closet", "map-closet");
    const goblin = t.place(s.id, t.h.goblinId, 0, 0);
    t.place(s.id, t.h.wolfId, 1, 0);
    const { tokenId } = t.run<{ tokenId: string }>(I.duplicateToken, { tokenId: goblin.id });
    expect(t.tokenRow(tokenId)).toMatchObject({ col: 0, row: 0, name: "Goblin 2" });
  });

  test("FR-MAP-04 duplicate scene: inactive copy with every token, hidden flags, new IDs + seq", () => {
    const t = setup();
    const f = t.run<SceneFolderRecord>(R.createFolder, { name: "Act 1" });
    const s = t.newScene();
    t.run(R.updateScene, { id: s.id, folderId: f.id });
    t.run(I.setLocked, { sceneId: s.id, locked: true });
    t.run(I.activateScene, { sceneId: s.id });
    const a = t.place(s.id, t.h.goblinId, 12, 6);
    const b = t.place(s.id, t.h.wolfId, 14, 4, { hidden: true });
    const copy = t.run<SceneRecord>(R.duplicateScene, { id: s.id });
    expect(copy).toMatchObject({
      name: "Goblin Ambush (copy)",
      folderId: f.id,
      mapLocked: true,
      active: false,
    });
    expect(copy.seq).toBeGreaterThan(s.seq);
    const copies = t.s.db.select().from(token).where(eq(token.sceneId, copy.id)).all();
    expect(copies.map((c) => [c.name, c.col, c.row, c.hidden])).toEqual([
      ["Goblin", 12, 6, false],
      ["Wolf", 14, 4, true],
    ]);
    expect(copies.every((c) => c.id !== a.id && c.id !== b.id && c.seq > b.seq)).toBe(true);
    const ev = t.lastEvent();
    expect(ev?.type).toBe("SceneDuplicated");
    expect(ev?.changes.map((c) => c.type)).toEqual(["scene", "fog", "token", "token"]);
  });

  test("FR-MAP-05 delete: active → conflict; tokens go with it", () => {
    const t = setup();
    const s = t.newScene();
    const other = t.newScene("Town", "map-town");
    t.run(I.activateScene, { sceneId: s.id });
    t.place(other.id, t.h.goblinId, 1, 1);
    expect(t.err(() => t.run(R.deleteScene, { id: s.id })).code).toBe("conflict");
    t.run(R.deleteScene, { id: other.id });
    expect(t.s.db.select().from(token).where(eq(token.sceneId, other.id)).all()).toEqual([]);
    expect(t.lastEvent()?.changes.map((c) => [c.type, c.after])).toEqual([
      ["token", null],
      ["fog", null],
      ["scene", null],
    ]);
  });

  test("FR-MAP-27 a failing command rolls back: no row, no log, no event", () => {
    const t = setup();
    const s = t.newScene();
    const [rows, logs, evs] = [t.count("token"), readEventLog(t.s.db).length, t.events.length];
    expect(t.err(() => t.place(s.id, t.h.goblinId, 1, 1, { imageAssetId: "missing" })).code).toBe(
      "not_found",
    );
    expect([t.count("token"), readEventLog(t.s.db).length, t.events.length]).toEqual([
      rows,
      logs,
      evs,
    ]);
  });

  test("FR-MAP-20 definition edit: size follows in the same commit; portrait only where unchanged; creatureType fills null only", () => {
    const t = setup();
    const s = t.newScene();
    const ogre = t.run<EntityRecord>(createEntity.name, {
      kind: "monster",
      name: "Cave Ogre",
      portraitAssetId: "art-mira",
      statBlock: { ...goblinBlock, size: "large" },
    });
    const a = t.place(s.id, ogre.id, 9, 10);
    const b = t.place(s.id, ogre.id, 5, 10);
    const c = t.place(s.id, ogre.id, 1, 10);
    t.run(I.updateToken, { tokenId: b.id, imageAssetId: "art-elite", name: "Hugo" });
    t.run(I.updateToken, { tokenId: c.id, creatureType: "initials" });
    addAsset(t.s, "art-ogre-2", t.h.campaignId);
    const logBefore = readEventLog(t.s.db).length;
    t.run(UPDATE, {
      id: ogre.id,
      name: "Cave Ogre",
      portraitAssetId: "art-ogre-2",
      statBlock: { ...goblinBlock, size: "huge", type: "giant" },
    });
    expect(t.tokenRow(a.id)).toMatchObject({
      size: "huge",
      imageAssetId: "art-ogre-2",
      name: "Cave Ogre",
      col: 9,
      row: 10,
      creatureType: "giant",
    });
    expect(t.tokenRow(b.id)).toMatchObject({
      size: "huge",
      imageAssetId: "art-elite",
      name: "Hugo",
      creatureType: "giant",
    });
    expect(t.tokenRow(c.id)).toMatchObject({ size: "huge", creatureType: "initials" });
    const ev = t.lastEvent();
    expect(ev?.type).toBe("EntityUpdated");
    // Copies hook first, then the FR-ENT-27 fill (a later registry line): its rows come last
    // and carry both changes; the Initials token gets no fill row.
    expect(ev?.changes.map((x) => [x.type, x.id])).toEqual([
      ["entity", ogre.id],
      ["token", a.id],
      ["token", b.id],
      ["token", c.id],
      ["token", a.id],
      ["token", b.id],
    ]);
    expect(ev?.changes.at(-1)?.after).toMatchObject({ size: "huge", creatureType: "giant" });
    expect(
      readEventLog(t.s.db)
        .slice(logBefore)
        .map((l) => l.type),
    ).toEqual(["EntityUpdated"]);
  });

  test("FR-MAP-30 token-changed hooks: run in update / hide / delete / scene delete; rows in changes", () => {
    const t = setup();
    const s = t.newScene();
    const other = t.newScene("Cellar");
    const g = t.place(s.id, t.h.goblinId, 1, 1);
    const calls: string[] = [];
    const extra = (id: string): RecordChange => ({
      type: "probe-row",
      id,
      before: null,
      after: { id },
    });
    tokenHooksOf(t.s).register("test.hook", (_env, before, after) => {
      calls.push(`${before.name}:${after === null ? "delete" : after.hidden ? "hidden" : "set"}`);
      return [extra(`for-${before.id}`)];
    });
    try {
      t.run(I.updateToken, { tokenId: g.id, name: "Gob" });
      expect(t.lastEvent()?.changes.map((c) => c.type)).toEqual(["token", "probe-row"]);
      t.run(I.setTokenHidden, { tokenId: g.id, hidden: true });
      expect(t.lastEvent()?.changes.at(-1)?.id).toBe(`for-${g.id}`);
      // Place and duplicate run none; moves do (FR-MAP-38, feedback.test.ts).
      const before = calls.length;
      const p = t.place(other.id, t.h.wolfId, 1, 1);
      const p2 = t.place(other.id, t.h.goblinId, 3, 3);
      t.run(I.duplicateToken, { tokenId: p.id });
      expect(calls.length).toBe(before);
      t.run(I.deleteToken, { tokenId: g.id });
      expect(t.lastEvent()?.changes.map((c) => c.type)).toEqual(["token", "probe-row"]);
      t.run(R.deleteScene, { id: other.id });
      expect(calls.slice(-3)).toEqual(["Wolf:delete", "Goblin:delete", "Wolf 2:delete"]);
      const ev = t.lastEvent();
      expect(ev?.changes.filter((c) => c.type === "probe-row").map((c) => c.id)).toContain(
        `for-${p2.id}`,
      );
      expect(calls.slice(0, 2)).toEqual(["Goblin:set", "Gob:hidden"]);
    } finally {
      tokenHooksOf(t.s).unregister("test.hook");
    }
  });

  test("FR-MAP-30 a hook's reject rolls the command back (combat: running encounter → conflict)", () => {
    const t = setup();
    const s = t.newScene();
    const g = t.place(s.id, t.h.goblinId, 1, 1);
    tokenHooksOf(t.s).register("test.refuse", (_env, _before, after) => {
      if (after === null) throw conflict("Token is in a running encounter");
      return [];
    });
    try {
      const n = readEventLog(t.s.db).length;
      expect(t.err(() => t.run(I.deleteToken, { tokenId: g.id })).message).toBe(
        "Token is in a running encounter",
      );
      expect(t.err(() => t.run(R.deleteScene, { id: s.id })).code).toBe("conflict");
      expect(t.tokenRow(g.id)).toBeDefined();
      expect(t.sceneRow(s.id)).toBeDefined();
      expect(readEventLog(t.s.db).length).toBe(n);
    } finally {
      tokenHooksOf(t.s).unregister("test.refuse");
    }
    // No hook registered → no behaviour change.
    t.run(I.deleteToken, { tokenId: g.id });
    expect(t.tokenRow(g.id)).toBeUndefined();
  });
});
