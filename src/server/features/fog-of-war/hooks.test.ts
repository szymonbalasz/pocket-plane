// fog-of-war's registry lines against the real fog (FR-FOG-02, -10, -23, -24): `derive` at every
// scenes-map write site, `duplicated` copies the row (not the stack), `deleting` lists the `fog`
// delete; the FK cascade removes row and stack. Nothing is hidden from players yet (no `hides`).
import { describe, expect, test } from "bun:test";
import { FOG_INTENTS as F, type FogRecord, type FogShape } from "@shared/fog-of-war/schemas";
import { MAP_INTENTS as I, type SceneRecord } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { type CommandDef, defineCommand } from "../../commands/commands";
import { sceneFog, sceneFogEdit, token } from "../../db/schema";
import { createEntity, UPDATE } from "../entities/commands";
import { goblinBlock } from "../entities/testing";
import { placeTokenIn, MAP_REST as R } from "../scenes-map/commands";
import { scenesSetup } from "../scenes-map/testing";
import { tokenVisibility } from "../scenes-map/visibility";
import { fogUndoStack } from "./commands";
import { readFogRecord } from "./rows";

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
  const newScene = (name = "Goblin Ambush") =>
    t.run<SceneRecord>(R.createScene, { name, mapAssetId: "map-battle" });
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
  return { ...t, newScene, ambush, place, fogged, rect, edit, setAll, lastEvent };
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
    // Players: nothing hidden yet (no `hides` line; build/fog-visibility switches it on).
    const row = t.s.db.select().from(token).where(eq(token.id, placed.id)).get();
    expect(
      tokenVisibility({ ...row, fogged: true } as never, t.h.viewer("player", t.h.p1.id)),
    ).toBe("redacted");
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

  test("FR-FOG-02 no `created` line yet: a new scene has no fog row (build/fog-visibility adds it)", () => {
    const t = setup();
    const s = t.newScene("Fresh");
    expect(readFogRecord(t.s.db, s.id)).toBeNull();
    expect(t.lastEvent()?.changes.map((c) => c.type)).toEqual(["scene"]);
  });
});
