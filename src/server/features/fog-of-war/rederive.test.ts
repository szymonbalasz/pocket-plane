// FR-FOG-08 / -10, FR-SCN-36: fog commands re-derive SCN subjects too: props, kept templates
// (uncut cells) and the per-door fog flag in `scene-structure`, in the command's one transaction
// and event; undo restores them.
import { describe, expect, test } from "bun:test";
import { FOG_INTENTS as F, type FogShape } from "@shared/fog-of-war/schemas";
import {
  AOE_TEMPLATE_TYPE,
  SCENE_PROP_TYPE,
  SCENE_STRUCTURE_TYPE,
  type SceneStructureRecord,
} from "@shared/scene-tools/schemas";
import { readProp, readStructure, readTemplate } from "../scene-tools/rows";
import { scnSetup } from "../scene-tools/testing";
import { dropFogRow } from "./testing";

function setup() {
  const t = scnSetup();
  // Scenes as before this build (no fog row): every subject starts clear.
  dropFogRow(t.s.db, t.ambush.id);
  dropFogRow(t.s.db, t.cellar.id);
  const rows = t.prep(t.ambush.id);
  const setAll = (fogged: boolean) =>
    t.run<{ editId: string | null }>(F.setAll, { sceneId: t.ambush.id, fogged }).editId;
  const edit = (op: "reveal" | "hide", shape: FogShape) =>
    t.run<{ editId: string | null }>(F.edit, { sceneId: t.ambush.id, op, shape }).editId;
  const rect = (c0: number, r0: number, c1: number, r1: number): FogShape => ({
    kind: "rect",
    c0,
    r0,
    c1,
    r1,
  });
  const changes = () => t.events.at(-1)?.event.changes ?? [];
  const ids = (type: string) =>
    changes()
      .filter((c) => c.type === type)
      .map((c) => c.id);
  const flags = () => (readStructure(t.s.db, t.ambush.id) as SceneStructureRecord).doors;
  return { ...t, rows, setAll, edit, rect, changes, ids, flags };
}

describe("FR-FOG-08 SCN subjects re-derived", () => {
  test("FR-FOG-08 Fog all: every prop, kept template and door flag flips in the one FogEdited", () => {
    const t = setup();
    const rev = t.rows.structure.rev;
    t.setAll(true);
    expect(t.events.at(-1)?.event.type).toBe("FogEdited");
    expect(t.ids(SCENE_PROP_TYPE).sort()).toEqual(["barrel", "chest", "table"]);
    expect(t.ids(AOE_TEMPLATE_TYPE).sort()).toEqual(["glyph", "guardians"]);
    expect(t.ids(SCENE_STRUCTURE_TYPE)).toEqual([t.ambush.id]);
    expect(readProp(t.s.db, "barrel")?.fogged).toBe(true);
    expect(readTemplate(t.s.db, "guardians")?.fogged).toBe(true);
    const st = readStructure(t.s.db, t.ambush.id) as SceneStructureRecord;
    expect(st.doors.map((d) => d[6])).toEqual([1, 1]);
    expect(st.rev).toBe(rev + 1);
    expect(st.walls).toEqual(t.rows.structure.walls);
    // Subject rows come before any token-hook rows; the fog row leads.
    expect(t.changes()[0]?.type).toBe("fog");
  });

  test("FR-FOG-10 a reveal flips only the subjects whose footprint gains a clear cell", () => {
    const t = setup();
    t.setAll(true);
    t.edit("reveal", t.rect(5, 3, 5, 3)); // the barrel's cell
    expect(t.ids(SCENE_PROP_TYPE)).toEqual(["barrel"]);
    expect(t.ids(AOE_TEMPLATE_TYPE)).toEqual([]);
    expect(t.ids(SCENE_STRUCTURE_TYPE)).toEqual([]);
    expect(readProp(t.s.db, "barrel")?.fogged).toBeUndefined();
    // d1 (8, 5)–(8, 6): cells (7, 5) and (8, 5); one clear cell is enough to show it.
    t.edit("reveal", t.rect(8, 5, 8, 5));
    expect(t.ids(SCENE_STRUCTURE_TYPE)).toEqual([t.ambush.id]);
    expect(t.flags().map((d) => d[6])).toEqual([0, 1]);
    // Hide it again: both cells fogged → f = 1.
    t.edit("hide", t.rect(8, 5, 8, 5));
    expect(t.flags().map((d) => d[6])).toEqual([1, 1]);
  });

  test("FR-FOG-07 undo restores props, templates and door flags in one FogUndone", () => {
    const t = setup();
    const id = t.setAll(true) as string;
    t.run(F.undo, { sceneId: t.ambush.id, expectedEditId: id });
    expect(t.events.at(-1)?.event.type).toBe("FogUndone");
    expect(t.ids(SCENE_PROP_TYPE).sort()).toEqual(["barrel", "chest", "table"]);
    expect(t.ids(SCENE_STRUCTURE_TYPE)).toEqual([t.ambush.id]);
    expect(readProp(t.s.db, "table")?.fogged).toBeUndefined();
    expect(readTemplate(t.s.db, "glyph")?.fogged).toBeUndefined();
    expect(t.flags().map((d) => d[6])).toEqual([0, 0]);
  });

  test("FR-FOG-10 template uncut cells: off-map cells take the mask's fill", () => {
    const t = setup();
    // Sphere 15 ft at vertex (0, 0): most uncut cells lie off the map.
    t.writeTemplate(t.ambush.id, "edge", { x: 0, y: 0, size: 15 });
    t.setAll(true);
    expect(readTemplate(t.s.db, "edge")?.fogged).toBe(true);
    // Reveal its on-map cells only: the off-map ones still take `fill = fog`, so not every cell
    // is fogged → visible.
    t.edit("reveal", t.rect(0, 0, 2, 2));
    expect(readTemplate(t.s.db, "edge")?.fogged).toBeUndefined();
    // Reveal all, then hide its on-map cells: off-map cells take `fill = clear` → still visible.
    t.setAll(false);
    t.edit("hide", t.rect(0, 0, 2, 2));
    expect(t.ids(AOE_TEMPLATE_TYPE)).not.toContain("edge");
    expect(readTemplate(t.s.db, "edge")?.fogged).toBeUndefined();
  });

  test("FR-FOG-08 a scene without structure or SCN rows: tokens only, no structure change", () => {
    const t = setup();
    t.run(F.setAll, { sceneId: t.cellar.id, fogged: true });
    expect(t.changes().map((c) => c.type)).toEqual(["fog"]);
    expect(readStructure(t.s.db, t.cellar.id)).toBeNull();
  });
});
