// Test support for scene-tools: scenes-map's seed plus Goblin Ambush (20 × 14 cells) and Cellar,
// with SCN rows written directly (fix/scn-core has no commands yet) in the shape of the SCN §13
// fixtures: `scn-walls`, `scn-props` (barrel, table, hidden chest), `scn-templates` (Spirit
// Guardians kept by player-1, hidden DM "Glyph").

import { FOG_INTENTS } from "@shared/fog-of-war/schemas";
import type {
  AoeTemplateRecord,
  Door,
  ScenePropRecord,
  SceneStructureRecord,
  Wall,
} from "@shared/scene-tools/schemas";
import type { SceneRecord } from "@shared/scenes-map/schemas";
import {
  aoeTemplate,
  aoeTemplateSeqNext,
  prop,
  propSeqNext,
  sceneStructure,
} from "../../db/schema";
import { MAP_REST } from "../scenes-map/commands";
import { addAsset, scenesSetup } from "../scenes-map/testing";
import { readProp, readStructure, readTemplate } from "./rows";

const AT = "2026-01-01T00:00:00.000Z";

/** `scn-walls`: x = 8 for y 0–5, 6–11, 12–14; d1 (8, 5)–(8, 6) closed; d2 (8, 11)–(8, 12) locked. */
export const AMBUSH_WALLS: Wall[] = [
  [1, 8, 0, 8, 5],
  [2, 8, 6, 8, 11],
  [3, 8, 12, 8, 14],
];
export const AMBUSH_DOORS: Door[] = [
  [4, 8, 5, 8, 6, 1, 0],
  [5, 8, 11, 8, 12, 2, 0],
];

export function scnSetup() {
  const t = scenesSetup();
  const cid = t.h.campaignId;
  for (const id of ["prop-barrel", "prop-table", "prop-chest"]) addAsset(t.s, id, cid);
  // FR-FOG-25 ripple: new scenes start fogged; revealed unless `revealed` is false.
  const newScene = (name: string, revealed = true) => {
    const s = t.run<SceneRecord>(MAP_REST.createScene, { name, mapAssetId: "map-battle" });
    if (revealed) t.run(FOG_INTENTS.setAll, { sceneId: s.id, fogged: false });
    return s;
  };
  const ambush = newScene("Goblin Ambush");
  const cellar = newScene("Cellar");

  const writeStructure = (
    sceneId: string,
    walls: Wall[] = AMBUSH_WALLS,
    doors: Door[] = AMBUSH_DOORS,
  ): SceneStructureRecord => {
    t.s.db
      .insert(sceneStructure)
      .values({
        sceneId,
        campaignId: cid,
        rev: 1,
        nextN: Math.max(0, ...walls.map((w) => w[0]), ...doors.map((d) => d[0])) + 1,
        walls,
        doors,
        updatedAt: AT,
      })
      .run();
    return readStructure(t.s.db, sceneId) as SceneStructureRecord;
  };
  const writeProp = (
    sceneId: string,
    id: string,
    assetId: string,
    f: Partial<typeof prop.$inferInsert> = {},
  ): ScenePropRecord => {
    t.s.db
      .insert(prop)
      .values({
        id,
        campaignId: cid,
        sceneId,
        seq: propSeqNext,
        assetId,
        col: 0,
        row: 0,
        w: 1,
        h: 1,
        createdAt: AT,
        updatedAt: AT,
        ...f,
      })
      .run();
    return readProp(t.s.db, id) as ScenePropRecord;
  };
  const writeTemplate = (
    sceneId: string,
    id: string,
    f: Partial<typeof aoeTemplate.$inferInsert> = {},
  ): AoeTemplateRecord => {
    t.s.db
      .insert(aoeTemplate)
      .values({
        id,
        campaignId: cid,
        sceneId,
        seq: aoeTemplateSeqNext,
        shape: "sphere",
        x: 0,
        y: 0,
        size: 15,
        angle: 0,
        createdAt: AT,
        updatedAt: AT,
        ...f,
      })
      .run();
    return readTemplate(t.s.db, id) as AoeTemplateRecord;
  };
  /** The four SCN fixture units on a scene. */
  const prep = (sceneId: string, tag = "") => ({
    structure: writeStructure(sceneId),
    barrel: writeProp(sceneId, `${tag}barrel`, "prop-barrel", { col: 5, row: 3 }),
    table: writeProp(sceneId, `${tag}table`, "prop-table", { col: 4, row: 11, w: 2, rotation: 90 }),
    chest: writeProp(sceneId, `${tag}chest`, "prop-chest", { col: 17, row: 12, hidden: true }),
    guardians: writeTemplate(sceneId, `${tag}guardians`, {
      x: 3,
      y: 8,
      label: "Spirit Guardians",
      placedByPlayerId: t.h.p1.id,
    }),
    glyph: writeTemplate(sceneId, `${tag}glyph`, {
      shape: "cube",
      x: 12,
      y: 12,
      size: 10,
      label: "Glyph",
      hidden: true,
    }),
  });
  return { ...t, ambush, cellar, newScene, writeStructure, writeProp, writeTemplate, prep };
}
