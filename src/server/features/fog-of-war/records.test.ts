// Record type `fog` (FOG §9): DM full, windowed to the active scene (OQ-FOG-30 B, `dmWindow`;
// other scenes load with `sync.loadScene`), players redacted on the active scene only; v2 shape
// (shapes, darkness without `seenBy`, Explored setting); undo depth + latest entry on the DM
// wire; campaign-scoped. Rows are written directly here.
import { describe, expect, test } from "bun:test";
import { FogRecord, PlayerFogRecord } from "@shared/fog-of-war/schemas";
import type { SceneRecord } from "@shared/scenes-map/schemas";
import { MAP_INTENTS as I } from "@shared/scenes-map/schemas";
import { sceneFog, sceneFogEdit, sceneFogEditSeqNext } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { MAP_REST as R } from "../scenes-map/commands";
import { scenesSetup } from "../scenes-map/testing";
import { readFogRecord } from "./rows";
import { dropFogRow } from "./testing";

const AT = "2026-01-01T00:00:00.000Z";

function setup() {
  const t = scenesSetup();
  // Rows are written directly: start from scenes without one (as before this build).
  const newScene = (name: string, actor = t.h.dm, mapAssetId = "map-battle") => {
    const s = t.run<SceneRecord>(R.createScene, { name, mapAssetId }, actor);
    dropFogRow(t.s.db, s.id);
    return s;
  };
  const town = newScene("Town");
  const ambush = newScene("Goblin Ambush");
  const writeFog = (sceneId: string, campaignId = t.h.campaignId, runs = "0,5,3") =>
    t.s.db
      .insert(sceneFog)
      .values({
        sceneId,
        campaignId,
        fill: "fog",
        col0: 0,
        row0: 0,
        cols: 20,
        rows: 14,
        runs: `${runs},${(280 - 8).toString(36)}`,
        updatedAt: AT,
      })
      .run();
  const edit = (sceneId: string, id: string, kind: "reveal-rect" | "fog-all") =>
    t.s.db
      .insert(sceneFogEdit)
      .values({
        id,
        campaignId: t.h.campaignId,
        sceneId,
        seq: sceneFogEditSeqNext,
        kind,
        prevFill: "clear",
        prevCol0: 0,
        prevRow0: 0,
        prevCols: 20,
        prevRows: 14,
        prevRuns: "",
        createdAt: AT,
      })
      .run();
  return { ...t, newScene, town, ambush, writeFog, edit };
}

describe("FOG §9 record type fog", () => {
  test("FOG §9 / OQ-FOG-30 B DM wire: the active scene's row only (dmWindow), others by sync.loadScene; box tuple, v2 fields, undo", () => {
    const t = setup();
    t.run(I.activateScene, { sceneId: t.ambush.id });
    t.writeFog(t.town.id);
    t.writeFog(t.ambush.id);
    t.edit(t.ambush.id, "e1", "fog-all");
    t.edit(t.ambush.id, "e2", "reveal-rect");
    const fog = t.h.snapshot(t.h.viewer("dm")).fog as FogRecord[];
    expect(fog.map((f) => f.id)).toEqual([t.ambush.id]);
    const ambush = fog[0] as FogRecord;
    expect(ambush).toEqual({
      id: t.ambush.id,
      campaignId: t.h.campaignId,
      fill: "fog",
      box: [0, 0, 20, 14],
      runs: `0,5,3,${(272).toString(36)}`,
      shapes: [],
      darkness: [],
      explored: false,
      undo: { n: 2, editId: "e2", kind: "reveal-rect" },
    });
    expect(FogRecord.parse(ambush)).toEqual(ambush);
    expect(readFogRecord(t.s.db, t.ambush.id)).toEqual(ambush);
    expect(readFogRecord(t.s.db, "nope")).toBeNull();
    // ADR-0041: another scene's row arrives with its scene load.
    const load = t.s.records.loadScene(
      { db: t.s.db, presence: { list: () => [] } },
      t.h.viewer("dm"),
      t.town.id,
    );
    expect((load.fog as FogRecord[]).map((f) => [f.id, f.undo])).toEqual([[t.town.id, null]]);
  });

  test("FR-FOG-44 darkness: DM wire without seenBy; a player gets only shapes with them in seenBy", () => {
    const t = setup();
    t.run(I.activateScene, { sceneId: t.town.id });
    t.writeFog(t.town.id);
    t.s.db
      .update(sceneFog)
      .set({
        darkness: [
          { id: "d1", circle: [3, 3, 1.5], seenBy: [t.h.p1.id] },
          { id: "d2", rect: [0, 0, 1, 1], seenBy: [] },
        ],
      })
      .run();
    const dm = t.h.snapshot(t.h.viewer("dm")).fog as FogRecord[];
    expect(dm[0]?.darkness).toEqual([
      { id: "d1", circle: [3, 3, 1.5] },
      { id: "d2", rect: [0, 0, 1, 1] },
    ]);
    const p1 = t.h.snapshot(t.h.viewer("player", t.h.p1.id)).fog as PlayerFogRecord[];
    expect(p1[0]?.darkness).toEqual([{ id: "d1", circle: [3, 3, 1.5] }]);
    const p2 = t.h.snapshot(t.h.viewer("player", t.h.p2.id)).fog as PlayerFogRecord[];
    expect(p2[0]?.darkness).toEqual([]);
    expect(JSON.stringify([dm, p1, p2])).not.toContain("seenBy");
  });

  test("FR-FOG-12 / FOG §9 players: redacted (no campaign, no undo), active scene only; owner = others", () => {
    const t = setup();
    t.writeFog(t.town.id);
    t.writeFog(t.ambush.id);
    t.edit(t.town.id, "e1", "reveal-rect");
    for (const p of [t.h.p1, t.h.p2]) {
      const v = t.h.viewer("player", p.id);
      expect(t.h.snapshot(v).fog).toEqual([]);
    }
    t.run(I.activateScene, { sceneId: t.town.id });
    for (const p of [t.h.p1, t.h.p2]) {
      const fog = t.h.snapshot(t.h.viewer("player", p.id)).fog as PlayerFogRecord[];
      expect(fog).toEqual([
        {
          id: t.town.id,
          fill: "fog",
          box: [0, 0, 20, 14],
          runs: `0,5,3,${(272).toString(36)}`,
          shapes: [],
          darkness: [],
          explored: false,
        },
      ]);
      expect(Object.keys(fog[0] as object).sort()).toEqual([
        "box",
        "darkness",
        "explored",
        "fill",
        "id",
        "runs",
        "shapes",
      ]);
      expect(PlayerFogRecord.parse(fog[0])).toEqual(fog[0] as PlayerFogRecord);
    }
  });

  test("FOG §9 live changes: active scene → redacted upsert / delete for players; other scene → nothing", () => {
    const t = setup();
    t.run(I.activateScene, { sceneId: t.town.id });
    t.writeFog(t.town.id);
    t.writeFog(t.ambush.id);
    const town = readFogRecord(t.s.db, t.town.id) as FogRecord;
    const ambush = readFogRecord(t.s.db, t.ambush.id) as FogRecord;
    const ch = (before: FogRecord | null, after: FogRecord | null): RecordChange => ({
      type: "fog",
      id: (after ?? before)?.id as string,
      before,
      after,
    });
    const p1 = t.h.viewer("player", t.h.p1.id);
    const dm = t.h.viewer("dm");
    const revealed = { ...town, runs: "0,280", fill: "fog" as const };
    expect(t.s.records.filterChange(ch(town, revealed), p1)).toEqual({
      type: "fog",
      id: t.town.id,
      op: "upsert",
      data: {
        id: t.town.id,
        fill: "fog",
        box: [0, 0, 20, 14],
        runs: "0,280",
        shapes: [],
        darkness: [],
        explored: false,
      },
    });
    expect(t.s.records.filterChange(ch(ambush, { ...ambush, runs: "" }), p1)).toBeNull();
    expect(t.s.records.filterChange(ch(ambush, null), p1)).toBeNull();
    expect(t.s.records.filterChange(ch(ambush, null), dm)).toEqual({
      type: "fog",
      id: t.ambush.id,
      op: "delete",
    });
    expect(t.s.records.filterChange(ch(null, ambush), dm)?.data).toEqual(ambush);
  });

  test("FOG §9 campaign scope: another campaign's fog reaches no viewer of this one", () => {
    const t = setup();
    const other = t.newScene("Elsewhere", t.h.dmSecond, "art-other");
    t.writeFog(other.id, t.h.secondCampaignId);
    t.writeFog(t.town.id);
    // OQ-FOG-30 B: windowed; make both scenes active in their campaigns.
    t.run(I.activateScene, { sceneId: t.town.id });
    t.run(I.activateScene, { sceneId: other.id }, t.h.dmSecond);
    expect((t.h.snapshot(t.h.viewer("dm")).fog as FogRecord[]).map((f) => f.id)).toEqual([
      t.town.id,
    ]);
    const second = t.h.viewer("dm", null, t.h.secondCampaignId);
    expect((t.h.snapshot(second).fog as FogRecord[]).map((f) => f.id)).toEqual([other.id]);
    const otherRec = readFogRecord(t.s.db, other.id) as FogRecord;
    expect(
      t.s.records.filterChange(
        { type: "fog", id: other.id, before: null, after: otherRec },
        t.h.viewer("dm"),
      ),
    ).toBeNull();
  });
});
