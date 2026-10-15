// SCN record types (SCN §9, FR-SCN-14, -19, -27, -29, -32, -35): DM full + active-scene window
// with `sync.loadScene`; players redacted / gated; the `hides` seam; live transitions; leak
// strings per SCN §13. Rows are written directly (commands come with the SCN slices).
import { afterEach, describe, expect, test } from "bun:test";
import { fogHidden } from "@shared/fog-of-war/visibility";
import {
  AOE_TEMPLATE_TYPE,
  type AoeTemplateRecord,
  MAP_SETTINGS_TYPE,
  PlayerScenePropRecord,
  PlayerSceneStructureRecord,
  SCENE_PROP_TYPE,
  SCENE_STRUCTURE_TYPE,
  type ScenePropRecord,
  type SceneStructureRecord,
} from "@shared/scene-tools/schemas";
import { MAP_INTENTS as I } from "@shared/scenes-map/schemas";
import { mapSettings } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import type { Viewer } from "../../ws/records";
import { type SceneObject, visibilityHooks } from "../scenes-map/visibility-hooks";
import { doorFogFlag, propFogged, templateFogged } from "./copies";
import { diagonalRuleOf } from "./rows";
import { scnSetup } from "./testing";

const SCN_TYPES = [SCENE_STRUCTURE_TYPE, SCENE_PROP_TYPE, AOE_TEMPLATE_TYPE];
const AT = "2026-01-01T00:00:00.000Z";

afterEach(() => visibilityHooks.unregister("test.fog"));

function setup() {
  const t = scnSetup();
  const a = t.prep(t.ambush.id);
  const c = t.prep(t.cellar.id, "c-");
  const src = { db: t.s.db, presence: { list: () => [] } };
  const dm = t.h.viewer("dm");
  const p1 = t.h.viewer("player", t.h.p1.id);
  const p2 = t.h.viewer("player", t.h.p2.id);
  const ids = (v: Viewer, type: string) =>
    ((t.h.snapshot(v)[type] ?? []) as { id: string }[]).map((r) => r.id);
  const scnFrame = (v: Viewer) => {
    const snap = t.h.snapshot(v);
    return JSON.stringify(SCN_TYPES.map((k) => snap[k]));
  };
  return { ...t, a, c, src, dm, p1, p2, ids, scnFrame };
}

describe("FR-SCN-32 DM window (ADR-0041)", () => {
  test("FR-SCN-32 the DM snapshot holds only the active scene's SCN rows, in full", () => {
    const t = setup();
    for (const type of SCN_TYPES) expect(t.ids(t.dm, type)).toEqual([]);
    t.run(I.activateScene, { sceneId: t.ambush.id });
    expect(t.ids(t.dm, SCENE_STRUCTURE_TYPE)).toEqual([t.ambush.id]);
    expect(t.ids(t.dm, SCENE_PROP_TYPE)).toEqual(["barrel", "table", "chest"]);
    expect(t.ids(t.dm, AOE_TEMPLATE_TYPE)).toEqual(["guardians", "glyph"]);
    const snap = t.h.snapshot(t.dm);
    expect(snap[SCENE_STRUCTURE_TYPE]).toEqual([t.a.structure]);
    expect(t.a.structure).toEqual({
      id: t.ambush.id,
      campaignId: t.h.campaignId,
      rev: 1,
      nextN: 6,
      walls: [
        [1, 8, 0, 8, 5],
        [2, 8, 6, 8, 11],
        [3, 8, 12, 8, 14],
      ],
      doors: [
        [4, 8, 5, 8, 6, 1, 0],
        [5, 8, 11, 8, 12, 2, 0],
      ],
    });
    expect((snap[SCENE_PROP_TYPE] as ScenePropRecord[])[2]).toEqual({
      id: "chest",
      campaignId: t.h.campaignId,
      sceneId: t.ambush.id,
      seq: 3,
      assetId: "prop-chest",
      col: 17,
      row: 12,
      w: 1,
      h: 1,
      rotation: 0,
      z: 0,
      hidden: true,
      locked: false,
    });
    expect((snap[AOE_TEMPLATE_TYPE] as AoeTemplateRecord[])[1]).toMatchObject({
      label: "Glyph",
      hidden: true,
      placedByPlayerId: null,
      width: null,
    });
  });

  test("FR-SCN-32 sync.loadScene returns another scene's SCN rows (and tokens), never fog or settings", () => {
    const t = setup();
    t.run(I.activateScene, { sceneId: t.ambush.id });
    const load = t.s.records.loadScene(t.src, t.dm, t.cellar.id);
    expect(Object.keys(load).sort()).toEqual([...SCN_TYPES, "token"].sort());
    expect(load[SCENE_STRUCTURE_TYPE]).toEqual([t.c.structure]);
    expect((load[SCENE_PROP_TYPE] as { id: string }[]).map((p) => p.id)).toEqual([
      "c-barrel",
      "c-table",
      "c-chest",
    ]);
    expect((load[AOE_TEMPLATE_TYPE] as { id: string }[]).map((p) => p.id)).toEqual([
      "c-guardians",
      "c-glyph",
    ]);
  });
});

describe("FR-SCN-14 / -19 / -27 player visibility", () => {
  test("FR-SCN-14 structure: doors only, locked sent as closed, f = 1 dropped; no walls key", () => {
    const t = setup();
    t.run(I.activateScene, { sceneId: t.ambush.id });
    for (const v of [t.p1, t.p2]) {
      const [s] = t.h.snapshot(v)[SCENE_STRUCTURE_TYPE] as PlayerSceneStructureRecord[];
      expect(s).toEqual({
        id: t.ambush.id,
        doors: [
          [4, 8, 5, 8, 6, 0],
          [5, 8, 11, 8, 12, 0],
        ],
      });
      expect(PlayerSceneStructureRecord.parse(s)).toEqual(s as PlayerSceneStructureRecord);
    }
    const open: SceneStructureRecord = {
      ...t.a.structure,
      doors: [
        [4, 8, 5, 8, 6, 0, 0],
        [5, 8, 11, 8, 12, 2, 1],
        [6, 2, 2, 2, 3, 1, 1],
      ],
    };
    const ch = t.s.records.filterChange(
      { type: SCENE_STRUCTURE_TYPE, id: t.ambush.id, before: t.a.structure, after: open },
      t.p1,
    );
    expect(ch).toEqual({
      type: SCENE_STRUCTURE_TYPE,
      id: t.ambush.id,
      op: "upsert",
      data: { id: t.ambush.id, doors: [[4, 8, 5, 8, 6, 1]] },
    });
  });

  test("FR-SCN-19 props: hidden → none; else no locked, no campaign; the chest's asset only once revealed", () => {
    const t = setup();
    t.run(I.activateScene, { sceneId: t.ambush.id });
    for (const v of [t.p1, t.p2]) {
      const props = t.h.snapshot(v)[SCENE_PROP_TYPE] as PlayerScenePropRecord[];
      expect(props.map((p) => p.id)).toEqual(["barrel", "table"]);
      for (const p of props) {
        expect(Object.keys(p)).not.toContain("locked");
        expect(Object.keys(p)).not.toContain("campaignId");
        expect(PlayerScenePropRecord.parse(p)).toEqual(p);
      }
      expect(props[1]).toMatchObject({ w: 2, h: 1, rotation: 90 });
    }
    const revealed = { ...t.a.chest, hidden: false, locked: true };
    expect(
      t.s.records.filterChange(
        { type: SCENE_PROP_TYPE, id: "chest", before: t.a.chest, after: revealed },
        t.p2,
      ),
    ).toEqual({
      type: SCENE_PROP_TYPE,
      id: "chest",
      op: "upsert",
      data: {
        id: "chest",
        sceneId: t.ambush.id,
        seq: 3,
        assetId: "prop-chest",
        col: 17,
        row: 12,
        w: 1,
        h: 1,
        rotation: 0,
        z: 0,
        hidden: false,
      },
    });
    // Hide again → a delete; the DM keeps an upsert.
    const hide: RecordChange = {
      type: SCENE_PROP_TYPE,
      id: "chest",
      before: revealed,
      after: t.a.chest,
    };
    expect(t.s.records.filterChange(hide, t.p2)?.op).toBe("delete");
    expect(t.s.records.filterChange(hide, t.dm)).toMatchObject({ op: "upsert", data: t.a.chest });
  });

  test("FR-SCN-27 templates: every field but campaignId for placer and others (incl. placedByPlayerId); hidden → none; DM keeps campaignId", () => {
    const t = setup();
    t.run(I.activateScene, { sceneId: t.ambush.id });
    const { campaignId: _cid, ...guardians } = t.a.guardians;
    for (const v of [t.p1, t.p2]) {
      expect(t.h.snapshot(v)[AOE_TEMPLATE_TYPE]).toEqual([guardians]);
    }
    // The DM wire keeps campaignId: the registry's scope gate reads it from the record (§8).
    expect(t.h.snapshot(t.dm)[AOE_TEMPLATE_TYPE]).toContainEqual(t.a.guardians);
    expect(t.a.guardians.placedByPlayerId).toBe(t.h.p1.id);
    const shown = { ...t.a.glyph, hidden: false };
    const ch = (before: AoeTemplateRecord, after: AoeTemplateRecord): RecordChange => ({
      type: AOE_TEMPLATE_TYPE,
      id: after.id,
      before,
      after,
    });
    const { campaignId: _c, ...shownWire } = shown;
    expect(t.s.records.filterChange(ch(t.a.glyph, shown), t.p1)).toEqual({
      type: AOE_TEMPLATE_TYPE,
      id: shown.id,
      op: "upsert",
      data: shownWire,
    });
    expect(t.s.records.filterChange(ch(shown, t.a.glyph), t.p1)?.op).toBe("delete");
  });

  test("SCN §13 leak strings: player frames hold no Glyph, chest asset, walls, door state 2 or other scene", () => {
    const t = setup();
    t.run(I.activateScene, { sceneId: t.ambush.id });
    for (const v of [t.p1, t.p2]) {
      const frame = t.scnFrame(v);
      for (const leak of ["Glyph", "prop-chest", '"walls"', '"locked"', t.cellar.id, "c-barrel"]) {
        expect(frame).not.toContain(leak);
      }
      const [s] = t.h.snapshot(v)[SCENE_STRUCTURE_TYPE] as PlayerSceneStructureRecord[];
      expect(s?.doors.every((d) => d[5] === 0 || d[5] === 1)).toBe(true);
    }
    // Every SCN change on a non-active scene reaches no player; the DM gets it (live, ADR-0041).
    const changes: RecordChange[] = [
      { type: SCENE_STRUCTURE_TYPE, id: t.cellar.id, before: null, after: t.c.structure },
      { type: SCENE_PROP_TYPE, id: "c-barrel", before: null, after: t.c.barrel },
      { type: AOE_TEMPLATE_TYPE, id: "c-guardians", before: null, after: t.c.guardians },
    ];
    for (const c of changes) {
      expect(t.s.records.filterChange(c, t.p1)).toBeNull();
      expect(t.s.records.filterChange(c, t.dm)?.op).toBe("upsert");
    }
  });

  test("FR-SCN-32 campaign scope: another campaign's SCN rows reach no viewer of this one", () => {
    const t = setup();
    t.run(I.activateScene, { sceneId: t.ambush.id });
    const other = { ...t.a.barrel, id: "x", campaignId: t.h.secondCampaignId };
    expect(
      t.s.records.filterChange(
        { type: SCENE_PROP_TYPE, id: "x", before: null, after: other },
        t.dm,
      ),
    ).toBeNull();
    const second = t.h.viewer("dm", null, t.h.secondCampaignId);
    for (const type of SCN_TYPES) expect(t.ids(second, type)).toEqual([]);
  });
});

describe("FR-SCN-35 fog seam", () => {
  /** Test fog: fogged = every cell has col ≥ 15; `hides` = FOG's pure rule. */
  const derived: SceneObject[] = [];
  function registerFog() {
    derived.length = 0;
    visibilityHooks.register({
      name: "test.fog",
      derive(_read, obj) {
        derived.push(obj);
        const cells = Array.isArray(obj.cells)
          ? obj.cells
          : [[(obj.cells as { col: number }).col, 0] as const];
        return { fogged: cells.length > 0 && cells.every(([c]) => c >= 15) };
      },
      hides: (type, r) => fogHidden(type, r),
    });
  }

  test("FR-SCN-35 visibility fns consult hides: fogged props and DM templates hidden, player templates exempt", () => {
    const t = setup();
    registerFog();
    t.run(I.activateScene, { sceneId: t.ambush.id });
    const crate = t.writeProp(t.ambush.id, "crate", "prop-barrel", {
      col: 18,
      row: 2,
      fogged: true,
    });
    const trap = t.writeTemplate(t.ambush.id, "trap", { x: 18, y: 3, label: "Trap", fogged: true });
    const mine = t.writeTemplate(t.ambush.id, "mine", {
      x: 18,
      y: 6,
      placedByPlayerId: t.h.p2.id,
      fogged: true,
    });
    expect(crate.fogged).toBe(true);
    expect(t.ids(t.p1, SCENE_PROP_TYPE)).toEqual(["barrel", "table"]);
    expect(t.ids(t.p1, AOE_TEMPLATE_TYPE)).toEqual(["guardians", "mine"]);
    expect(t.ids(t.dm, SCENE_PROP_TYPE)).toContain("crate");
    expect(t.ids(t.dm, AOE_TEMPLATE_TYPE)).toEqual(["guardians", "glyph", "trap", "mine"]);
    expect(trap.fogged).toBe(true);
    expect(mine).toMatchObject({ fogged: true, placedByPlayerId: t.h.p2.id });
    // A prop walking out of fog arrives as an upsert.
    const out = { ...crate, col: 3 } as ScenePropRecord;
    delete out.fogged;
    expect(
      t.s.records.filterChange(
        { type: SCENE_PROP_TYPE, id: "crate", before: crate, after: out },
        t.p1,
      )?.op,
    ).toBe("upsert");
  });

  test("FR-SCN-35 / -36 derive call sites: prop w × h, template uncut cells, door edge cells", () => {
    const t = setup();
    expect(propFogged(t.s.db, t.ambush.id, { col: 15, row: 0, w: 2, h: 2 })).toBe(false);
    registerFog();
    expect(propFogged(t.s.db, t.ambush.id, { col: 15, row: 0, w: 2, h: 2 })).toBe(true);
    expect(derived.at(-1)).toEqual({
      type: SCENE_PROP_TYPE,
      sceneId: t.ambush.id,
      cells: { col: 15, row: 0, w: 2, h: 2 },
    });
    // A sphere at (20, 0) runs off the map: uncut cells (col 17–22) are all ≥ 15.
    expect(
      templateFogged(t.s.db, t.ambush, { shape: "sphere", x: 20, y: 0, size: 15, angle: 0 }),
    ).toBe(true);
    expect(derived.at(-1)?.cells).toHaveLength(32);
    expect(
      templateFogged(t.s.db, t.ambush, { shape: "sphere", x: 3, y: 8, size: 15, angle: 0 }),
    ).toBe(false);
    expect(doorFogFlag(t.s.db, t.ambush.id, [16, 5, 16, 6])).toBe(1);
    expect(derived.at(-1)).toEqual({
      type: SCENE_STRUCTURE_TYPE,
      sceneId: t.ambush.id,
      cells: [
        [15, 5],
        [16, 5],
      ],
    });
    expect(doorFogFlag(t.s.db, t.ambush.id, [15, 5, 15, 6])).toBe(0);
  });
});

describe("FR-SCN-29 map-settings", () => {
  test("FR-SCN-29 no row = 5-10-5 and nothing sent; a row reaches every viewer of its campaign", () => {
    const t = setup();
    expect(diagonalRuleOf(t.s.db, t.h.campaignId)).toBe("5-10-5");
    for (const v of [t.dm, t.p1]) expect(t.h.snapshot(v)[MAP_SETTINGS_TYPE]).toEqual([]);
    t.s.db
      .insert(mapSettings)
      .values({ campaignId: t.h.campaignId, diagonalRule: "5", updatedAt: AT })
      .run();
    expect(diagonalRuleOf(t.s.db, t.h.campaignId)).toBe("5");
    for (const v of [t.dm, t.p1, t.p2]) {
      expect(t.h.snapshot(v)[MAP_SETTINGS_TYPE]).toEqual([
        { id: t.h.campaignId, diagonalRule: "5" },
      ]);
    }
    expect(t.h.snapshot(t.h.viewer("dm", null, t.h.secondCampaignId))[MAP_SETTINGS_TYPE]).toEqual(
      [],
    );
  });
});
