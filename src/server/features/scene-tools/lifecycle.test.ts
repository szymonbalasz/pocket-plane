// FR-SCN-31 scene hooks: duplicate copies structure + props (new IDs, same `n`), not templates;
// delete lists every SCN row before the cascade; both ride the scene event's `changes`.
import { describe, expect, test } from "bun:test";
import { SceneDeleted, SceneDuplicated } from "@shared/events/scenes-map";
import {
  AOE_TEMPLATE_TYPE,
  PROPS_PER_CAMPAIGN_MAX,
  SCENE_PROP_TYPE,
  SCENE_STRUCTURE_TYPE,
  type ScenePropRecord,
} from "@shared/scene-tools/schemas";
import type { SceneRecord } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { aoeTemplate, prop, scene, sceneStructure } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { MAP_REST as R } from "../scenes-map/commands";
import { sceneProps, sceneTemplates } from "./rows";
import { scnSetup } from "./testing";

const kinds = (changes: readonly RecordChange[]) =>
  changes.map((c) => `${c.type}:${c.after ? "+" : "-"}`);

describe("FR-SCN-31 scene hooks", () => {
  test("FR-SCN-31 duplicate copies structure (same n) and props (new IDs, same fields), not templates", () => {
    const t = scnSetup();
    const a = t.prep(t.ambush.id);
    const copy = t.run<SceneRecord>(R.duplicateScene, { id: t.ambush.id });
    const ev = t.events.at(-1);
    expect(ev?.event.type).toBe(SceneDuplicated.type);
    expect(kinds(ev?.event.changes ?? [])).toEqual([
      "scene:+",
      `${SCENE_STRUCTURE_TYPE}:+`,
      `${SCENE_PROP_TYPE}:+`,
      `${SCENE_PROP_TYPE}:+`,
      `${SCENE_PROP_TYPE}:+`,
    ]);
    const structure = ev?.event.changes[1]?.after;
    expect(structure).toEqual({ ...a.structure, id: copy.id });
    const props = sceneProps(t.s.db, copy.id);
    expect(props.map((p) => p.assetId)).toEqual(["prop-barrel", "prop-table", "prop-chest"]);
    const strip = ({ id: _i, sceneId: _s, seq: _q, ...rest }: ScenePropRecord) => rest;
    expect(props.map(strip)).toEqual([a.barrel, a.table, a.chest].map(strip));
    for (const p of props) {
      expect([a.barrel.id, a.table.id, a.chest.id]).not.toContain(p.id);
      expect(p.sceneId).toBe(copy.id);
    }
    expect(sceneTemplates(t.s.db, copy.id)).toEqual([]);
    // The source is untouched.
    expect(sceneProps(t.s.db, t.ambush.id)).toEqual([a.barrel, a.table, a.chest]);
  });

  test("FR-SCN-35 duplicate copies fogged / f with the fog row (same cells, same fog)", () => {
    const t = scnSetup();
    t.writeStructure(t.ambush.id, [], [[1, 16, 5, 16, 6, 1, 1]]);
    t.writeProp(t.ambush.id, "crate", "prop-barrel", { col: 18, row: 2, fogged: true });
    const copy = t.run<SceneRecord>(R.duplicateScene, { id: t.ambush.id });
    const [p] = sceneProps(t.s.db, copy.id);
    expect(p?.fogged).toBe(true);
    const row = t.s.db
      .select()
      .from(sceneStructure)
      .where(eq(sceneStructure.sceneId, copy.id))
      .get();
    expect(row?.doors).toEqual([[1, 16, 5, 16, 6, 1, 1]]);
  });

  test("FR-SCN-31 a scene without SCN rows adds no changes", () => {
    const t = scnSetup();
    t.run<SceneRecord>(R.duplicateScene, { id: t.cellar.id });
    expect(kinds(t.events.at(-1)?.event.changes ?? [])).toEqual(["scene:+"]);
  });

  test("FR-SCN-16 duplicate past the 2,000-prop campaign cap → conflict, nothing written", () => {
    const t = scnSetup();
    t.prep(t.ambush.id);
    const filler = t.s.db.$client.query(
      "INSERT INTO prop (id, campaign_id, scene_id, seq, asset_id, col, row, w, h, created_at, updated_at) VALUES (?, ?, ?, ?, 'prop-barrel', 0, 0, 1, 1, '', '')",
    );
    for (let i = 0; i < PROPS_PER_CAMPAIGN_MAX - 4; i++) {
      filler.run(`f${i}`, t.h.campaignId, t.cellar.id, 100 + i);
    }
    const scenes = t.count("scene");
    const events = t.events.length;
    expect(t.err(() => t.run(R.duplicateScene, { id: t.ambush.id })).code).toBe("conflict");
    expect(t.count("scene")).toBe(scenes);
    expect(t.count("prop")).toBe(PROPS_PER_CAMPAIGN_MAX - 1);
    expect(t.events.length).toBe(events);
  });

  test("FR-SCN-31 delete lists every SCN row as a delete; the cascade removes them; DM converges", () => {
    const t = scnSetup();
    const c = t.prep(t.cellar.id, "c-");
    t.run(R.deleteScene, { id: t.cellar.id });
    const ev = t.events.at(-1);
    expect(ev?.event.type).toBe(SceneDeleted.type);
    const changes = ev?.event.changes ?? [];
    expect(kinds(changes)).toEqual([
      `${SCENE_STRUCTURE_TYPE}:-`,
      `${SCENE_PROP_TYPE}:-`,
      `${SCENE_PROP_TYPE}:-`,
      `${SCENE_PROP_TYPE}:-`,
      `${AOE_TEMPLATE_TYPE}:-`,
      `${AOE_TEMPLATE_TYPE}:-`,
      "scene:-",
    ]);
    expect(changes[0]?.before).toEqual(c.structure);
    expect(changes[5]?.before).toEqual(c.glyph);
    const dm = t.h.viewer("dm");
    for (const ch of changes) expect(t.s.records.filterChange(ch, dm)?.op).toBe("delete");
    // Players never saw the (non-active) scene: nothing to send.
    const p1 = t.h.viewer("player", t.h.p1.id);
    for (const ch of changes.slice(0, -1)) expect(t.s.records.filterChange(ch, p1)).toBeNull();
    for (const table of [sceneStructure, prop, aoeTemplate]) {
      expect(t.s.db.select().from(table).all()).toEqual([]);
    }
    expect(t.s.db.select().from(scene).where(eq(scene.id, t.cellar.id)).get()).toBeUndefined();
  });
});
