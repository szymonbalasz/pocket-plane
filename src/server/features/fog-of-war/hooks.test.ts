// fog-of-war's registry lines against the real fog (FR-FOG-02, -10, -23, -24): `derive` at every
// scenes-map write site, `duplicated` copies the row (not the stack), `deleting` lists the `fog`
// delete; the FK cascade removes row and stack; `created` fogs new scenes; `hides` = fog-hidden;
// `dragToDm` routes previews into fog to the DM (FR-FOG-11, -15).
import { describe, expect, test } from "bun:test";
import { FOG_INTENTS as F, type FogRecord, type FogShape } from "@shared/fog-of-war/schemas";
import { type DragData, MAP_INTENTS as I, type SceneRecord } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { type CommandDef, defineCommand } from "../../commands/commands";
import { sceneFog, sceneFogEdit, token } from "../../db/schema";
import type { SignalSender } from "../../ws/signals";
import { createEntity, UPDATE } from "../entities/commands";
import { goblinBlock } from "../entities/testing";
import { placeTokenIn, MAP_REST as R } from "../scenes-map/commands";
import { dragAudience } from "../scenes-map/drag";
import { scenesSetup } from "../scenes-map/testing";
import { tokenVisibility } from "../scenes-map/visibility";
import { sceneVisibilityHooks } from "../scenes-map/visibility-hooks";
import { fogUndoStack } from "./commands";
import { readFogRecord } from "./rows";
import { dropFogRow } from "./testing";

const placeOne = defineCommand({
  name: "test.placeOne",
  input: z.object({ sceneId: z.string(), definitionId: z.string(), col: z.int(), row: z.int() }),
  execute(input, env) {
    const { token: t, change } = placeTokenIn(env, { ...input, hidden: false });
    env.emit({
      type: "TokenPlaced",
      campaignId: t.campaignId,
      payload: { tokenId: t.id, sceneId: t.sceneId },
      changes: [change],
    });
    return t;
  },
});

function setup() {
  const t = scenesSetup();
  t.s.commands.register(placeOne as unknown as CommandDef);
  // Scenes as before this build (no fog row); `fresh` keeps FR-FOG-02's fully fogged row.
  const fresh = (name: string) =>
    t.run<SceneRecord>(R.createScene, { name, mapAssetId: "map-battle" });
  const newScene = (name = "Goblin Ambush") => {
    const s = fresh(name);
    dropFogRow(t.s.db, s.id);
    return s;
  };
  const ambush = newScene();
  const place = (col: number, row: number, definitionId = t.h.goblinId, sceneId = ambush.id) =>
    t.run<{ tokenId: string }>(I.placeToken, { sceneId, definitionId, col, row }).tokenId;
  const fogged = (id: string) =>
    t.s.db.select({ f: token.fogged }).from(token).where(eq(token.id, id)).get()?.f;
  const rect = (c0: number, r0: number, c1: number, r1: number): FogShape => ({
    kind: "rect",
    c0,
    r0,
    c1,
    r1,
  });
  const edit = (op: "reveal" | "hide", shape: FogShape, sceneId = ambush.id) =>
    t.run<{ editId: string | null }>(F.edit, { sceneId, op, shape }).editId;
  const setAll = (f: boolean, sceneId = ambush.id) =>
    t.run<{ editId: string | null }>(F.setAll, { sceneId, fogged: f }).editId;
  const lastEvent = () => t.events.at(-1)?.event;
  return { ...t, fresh, newScene, ambush, place, fogged, rect, edit, setAll, lastEvent };
}

describe("FR-FOG-10 derive (fog's line)", () => {
  test("FR-FOG-10 map.placeToken / placeTokenIn: fogged iff every footprint cell is fogged", () => {
    const t = setup();
    const before = t.place(3, 3);
    expect(t.fogged(before)).toBe(false); // no row = clear
    t.setAll(true);
    t.edit("reveal", t.rect(0, 0, 4, 4));
    expect(t.fogged(t.place(10, 10))).toBe(true);
    expect(t.fogged(t.place(2, 2))).toBe(false);
    const placed = t.run<{ id: string }>("test.placeOne", {
      sceneId: t.ambush.id,
      definitionId: t.h.goblinId,
      col: 12,
      row: 12,
    });
    expect(t.fogged(placed.id)).toBe(true);
    // Off the box: cells take `fill` (fog).
    expect(t.fogged(t.place(19, 13))).toBe(true);
    // FR-FOG-11/12: fog-hidden for players unless owned (exempt; the registry gives the DM full).
    const row = t.s.db.select().from(token).where(eq(token.id, placed.id)).get();
    const p1 = t.h.viewer("player", t.h.p1.id);
    expect(tokenVisibility({ ...row, fogged: true } as never, p1)).toBe("hidden");
    // ADR-0042: an owned token's `seenBy` is every player (owner + party, FR-FOG-34).
    const owned = {
      ...row,
      fogged: true,
      ownerPlayerId: t.h.p1.id,
      seenBy: [t.h.p1.id, t.h.p2.id],
    };
    expect(tokenVisibility(owned as never, p1)).toBe("redacted");
    expect(tokenVisibility(owned as never, t.h.viewer("player", t.h.p2.id))).toBe("redacted");
  });

  test("FR-FOG-10 map.moveToken: walking into fog is fogged in its own TokenMoved; out of it clear", () => {
    const t = setup();
    t.setAll(true);
    t.edit("reveal", t.rect(0, 0, 4, 4));
    const g = t.place(2, 2);
    t.run(I.moveToken, { tokenId: g, col: 8, row: 8 });
    expect(t.lastEvent()).toMatchObject({
      type: "TokenMoved",
      changes: [{ type: "token", after: { id: g, col: 8, row: 8, fogged: true } }],
    });
    t.run(I.moveToken, { tokenId: g, col: 4, row: 4 });
    expect(t.fogged(g)).toBe(false);
    expect(t.lastEvent()?.changes[0]?.after).not.toHaveProperty("fogged");
  });

  test("FR-FOG-10 map.duplicateToken derives at the copy's cell; Large partly clear → not fogged", () => {
    const t = setup();
    t.setAll(true);
    t.edit("reveal", t.rect(0, 0, 3, 0));
    const g = t.place(2, 0);
    const { tokenId } = t.run<{ tokenId: string }>(I.duplicateToken, { tokenId: g });
    // FR-MAP-17: copy at col + 1 (3, 0): clear.
    expect(t.fogged(tokenId)).toBe(false);
    const { tokenId: next } = t.run<{ tokenId: string }>(I.duplicateToken, { tokenId });
    expect(t.fogged(next)).toBe(true); // (4, 0): fogged
    const ogre = t.run<{ id: string }>(createEntity.name, {
      kind: "monster",
      name: "Cave Ogre",
      statBlock: { ...goblinBlock, size: "large" },
    });
    expect(t.fogged(t.place(3, 0, ogre.id))).toBe(false); // (3, 0) clear, (4, 0) / row 1 fogged
    expect(t.fogged(t.place(10, 10, ogre.id))).toBe(true);
  });

  test("FR-FOG-10 FR-MAP-20 size refresh re-derives fogged for the new footprint", () => {
    const t = setup();
    const ogre = t.run<{ id: string }>(createEntity.name, {
      kind: "monster",
      name: "Cave Ogre",
      statBlock: { ...goblinBlock, size: "large" },
    });
    t.setAll(true);
    t.edit("reveal", t.rect(6, 6, 6, 6));
    const o = t.place(5, 5, ogre.id);
    expect(t.fogged(o)).toBe(false); // (6, 6) clear
    t.run(UPDATE, { id: ogre.id, name: "Cave Ogre", statBlock: { ...goblinBlock, size: "small" } });
    expect(t.fogged(o)).toBe(true); // only (5, 5), fogged
    expect(t.lastEvent()?.changes.find((c) => c.id === o)?.after).toMatchObject({ fogged: true });
  });

  test("FR-FOG-04 a corrupt row derives fogged (fail closed)", () => {
    const t = setup();
    t.setAll(false);
    t.s.db
      .insert(sceneFog)
      .values({
        sceneId: t.ambush.id,
        campaignId: t.h.campaignId,
        fill: "clear",
        col0: 0,
        row0: 0,
        cols: 20,
        rows: 14,
        runs: "zz,zz",
        updatedAt: "2026-01-01T00:00:00.000Z",
      })
      .run();
    expect(t.fogged(t.place(1, 1))).toBe(true);
  });
});

describe("FR-FOG-02 / -23 lifecycle (fog's lines)", () => {
  test("FR-FOG-02 duplicate copies the row, not the undo stack; copied tokens derived against it", () => {
    const t = setup();
    const inFog = t.place(10, 10);
    const inClear = t.place(1, 1);
    t.setAll(true);
    t.edit("reveal", t.rect(0, 0, 3, 3));
    const src = readFogRecord(t.s.db, t.ambush.id) as FogRecord;
    const copy = t.run<SceneRecord>(R.duplicateScene, { id: t.ambush.id });
    const rec = readFogRecord(t.s.db, copy.id) as FogRecord;
    expect(rec).toEqual({ ...src, id: copy.id, undo: null });
    expect(fogUndoStack(t.s.db, copy.id)).toEqual([]);
    expect(fogUndoStack(t.s.db, t.ambush.id)).toHaveLength(2);
    const ev = t.lastEvent();
    expect(ev?.type).toBe("SceneDuplicated");
    expect(ev?.changes.map((c) => c.type)).toEqual(["scene", "fog", "token", "token"]);
    expect(ev?.changes[1]).toEqual({ type: "fog", id: copy.id, before: null, after: rec });
    const copies = t.s.db.select().from(token).where(eq(token.sceneId, copy.id)).all();
    expect(copies.map((c) => [c.col, c.fogged])).toEqual([
      [10, true],
      [1, false],
    ]);
    expect([t.fogged(inFog), t.fogged(inClear)]).toEqual([true, false]);
    // The copy's own edits start a fresh stack.
    t.edit("reveal", t.rect(10, 10, 10, 10), copy.id);
    expect(readFogRecord(t.s.db, copy.id)?.undo?.n).toBe(1);
  });

  test("FR-FOG-02 a source without a row → the copy has none, no fog change", () => {
    const t = setup();
    t.place(2, 2);
    const copy = t.run<SceneRecord>(R.duplicateScene, { id: t.ambush.id });
    expect(readFogRecord(t.s.db, copy.id)).toBeNull();
    expect(t.lastEvent()?.changes.map((c) => c.type)).toEqual(["scene", "token"]);
  });

  test("FR-FOG-23 delete: SceneDeleted lists the fog delete before the scene's; cascade removes row + stack; DM store converges", () => {
    const t = setup();
    const doomed = t.newScene("Doomed");
    t.place(2, 2, t.h.goblinId, doomed.id);
    t.setAll(true, doomed.id);
    t.edit("reveal", t.rect(0, 0, 1, 1), doomed.id);
    const before = readFogRecord(t.s.db, doomed.id) as FogRecord;
    t.run(R.deleteScene, { id: doomed.id });
    const ev = t.lastEvent();
    expect(ev?.type).toBe("SceneDeleted");
    expect(ev?.changes.map((c) => c.type)).toEqual(["token", "fog", "scene"]);
    expect(ev?.changes[1]).toEqual({ type: "fog", id: doomed.id, before, after: null });
    expect(t.s.db.select().from(sceneFog).where(eq(sceneFog.sceneId, doomed.id)).all()).toEqual([]);
    expect(
      t.s.db.select().from(sceneFogEdit).where(eq(sceneFogEdit.sceneId, doomed.id)).all(),
    ).toEqual([]);
    // DM: a `fog` delete frame (its store drops the row); players: nothing (not the active scene).
    const fogCh = ev?.changes[1] as Parameters<typeof t.s.records.filterChange>[0];
    expect(t.s.records.filterChange(fogCh, t.h.viewer("dm"))).toEqual({
      type: "fog",
      id: doomed.id,
      op: "delete",
    });
    expect(t.s.records.filterChange(fogCh, t.h.viewer("player", t.h.p1.id))).toBeNull();
    const dmFog = t.h.snapshot(t.h.viewer("dm")).fog as FogRecord[];
    expect(dmFog.map((f) => f.id)).not.toContain(doomed.id);
  });

  test("FR-FOG-23 a scene without a row deletes with no fog change", () => {
    const t = setup();
    const doomed = t.newScene("Doomed");
    t.run(R.deleteScene, { id: doomed.id });
    expect(t.lastEvent()?.changes.map((c) => c.type)).toEqual(["scene"]);
  });

  test("FR-FOG-02 created: a new scene starts fully fogged (row in SceneCreated, no undo entry); tokens placed on it are fogged", () => {
    const t = setup();
    const s = t.fresh("Fresh");
    const rec = readFogRecord(t.s.db, s.id) as FogRecord;
    expect(rec).toEqual({
      id: s.id,
      campaignId: t.h.campaignId,
      fill: "fog",
      box: [0, 0, 20, 14],
      runs: "",
      shapes: [],
      darkness: [],
      explored: false,
      undo: null,
    });
    const ev = t.lastEvent();
    expect(ev?.type).toBe("SceneCreated");
    expect(ev?.changes.map((c) => c.type)).toEqual(["scene", "fog"]);
    expect(ev?.changes[1]).toEqual({ type: "fog", id: s.id, before: null, after: rec });
    expect(fogUndoStack(t.s.db, s.id)).toEqual([]);
    expect(t.fogged(t.place(3, 3, t.h.goblinId, s.id))).toBe(true);
    // The DM can Reveal all at once: one entry, every cell clear.
    t.setAll(false, s.id);
    expect(readFogRecord(t.s.db, s.id)).toMatchObject({ fill: "clear", undo: { n: 1 } });
  });

  test("FR-FOG-02 a duplicate of a new scene keeps it fogged; a create that rolls back leaves no row", () => {
    const t = setup();
    const s = t.fresh("Fresh");
    const copy = t.run<SceneRecord>(R.duplicateScene, { id: s.id });
    expect(readFogRecord(t.s.db, copy.id)).toMatchObject({ fill: "fog", runs: "", undo: null });
    const rows = t.s.db.select().from(sceneFog).all().length;
    expect(() => t.run(R.createScene, { name: "Bad", mapAssetId: "nope" })).toThrow();
    expect(t.s.db.select().from(sceneFog).all()).toHaveLength(rows);
  });
});

describe("FR-FOG-11 / -15 hides and dragToDm (fog's line)", () => {
  const routeOf = (t: ReturnType<typeof setup>) => {
    const read = { db: t.s.db, activeSceneOf: (c: string) => t.s.records.activeSceneOf(c) };
    const dm: SignalSender = { role: "dm", campaignId: t.h.campaignId };
    return (data: DragData) => dragAudience(data, dm, read);
  };

  test("FR-FOG-15 visible token: clear preview → all; wholly fogged preview → dm from the first such frame; end → its seers (every player)", () => {
    const t = setup();
    t.run(I.activateScene, { sceneId: t.ambush.id });
    t.setAll(true);
    t.edit("reveal", t.rect(0, 0, 3, 3));
    const g = t.place(1, 1);
    const route = routeOf(t);
    const all = { players: [t.h.p1.id, t.h.p2.id] };
    const at = (col: number, row: number): DragData => ({
      sceneId: t.ambush.id,
      tokenId: g,
      x: col * 70 + 20, // FR-MAP-15 rounding: + 20 px stays in the cell
      y: row * 70,
    });
    expect(route(at(2, 1))).toEqual(all);
    expect(route(at(3, 3))).toEqual(all);
    expect(route(at(4, 3))).toBe("dm");
    expect(route(at(9, 9))).toBe("dm");
    expect(route({ sceneId: t.ambush.id, tokenId: g, end: true })).toEqual(all);
  });

  test("FR-FOG-15 Large previews use the whole footprint; fog-hidden tokens and their end frames → dm; owned → every player", () => {
    const t = setup();
    t.run(I.activateScene, { sceneId: t.ambush.id });
    t.setAll(true);
    t.edit("reveal", t.rect(0, 0, 3, 3));
    const ogre = t.run<{ id: string }>(createEntity.name, {
      kind: "monster",
      name: "Cave Ogre",
      statBlock: { ...goblinBlock, size: "large" },
    });
    const o = t.place(1, 1, ogre.id);
    const hiddenInFog = t.place(10, 10);
    const owned = t.run<{ tokenId: string }>(I.placeToken, {
      sceneId: t.ambush.id,
      definitionId: t.h.goblinId,
      col: 2,
      row: 2,
      ownerPlayerId: t.h.p1.id,
    }).tokenId;
    const route = routeOf(t);
    const all = { players: [t.h.p1.id, t.h.p2.id] };
    const px = (tokenId: string, col: number, row: number): DragData => ({
      sceneId: t.ambush.id,
      tokenId,
      x: col * 70,
      y: row * 70,
    });
    expect(route(px(o, 3, 3))).toEqual(all); // (3, 3) of its 2 × 2 is clear
    expect(route(px(o, 4, 4))).toBe("dm");
    expect(route(px(hiddenInFog, 1, 1))).toBe("dm"); // hidden for players: every frame
    expect(route({ sceneId: t.ambush.id, tokenId: hiddenInFog, end: true })).toBe("dm");
    expect(route(px(owned, 12, 12))).toEqual(all); // exempt (OQ-FOG-03)
    expect(route({ sceneId: t.ambush.id, tokenId: owned, end: true })).toEqual(all);
  });

  test("FR-FOG-11 hides = fog-hidden for the viewer: not in seenBy and not their own; player templates exempt", () => {
    const [line] = sceneVisibilityHooks;
    const p1 = { connId: "c", campaignId: "c1", role: "player" as const, playerId: "p1" };
    const hides = (type: string, r: object) => line?.hides?.(type, r, p1) ?? false;
    expect(hides("token", { seenBy: [], ownerPlayerId: null })).toBe(true);
    expect(hides("token", { seenBy: ["p1"], ownerPlayerId: null })).toBe(false);
    expect(hides("token", { seenBy: [], ownerPlayerId: "p1" })).toBe(false);
    expect(hides("token", { seenBy: [], ownerPlayerId: "p2" })).toBe(true);
    expect(hides("token", { seenBy: null, ownerPlayerId: null })).toBe(true);
    expect(hides("scene-prop", { seenBy: ["p2"] })).toBe(true);
    expect(hides("aoe-template", { seenBy: [], placedByPlayerId: null })).toBe(true);
    expect(hides("aoe-template", { seenBy: [], placedByPlayerId: "p2" })).toBe(false);
  });
});
