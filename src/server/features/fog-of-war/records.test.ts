// Record type `fog` (FOG §9): DM full on every scene (never windowed), players redacted on the
// active scene only; undo depth + latest entry on the DM wire; campaign-scoped. Rows are written
// directly here (commands come with build/fog-server).
import { describe, expect, test } from "bun:test";
import { FogRecord, PlayerFogRecord } from "@shared/fog-of-war/schemas";
import type { SceneRecord } from "@shared/scenes-map/schemas";
import { MAP_INTENTS as I } from "@shared/scenes-map/schemas";
import { sceneFog, sceneFogEdit, sceneFogEditSeqNext } from "../../db/schema";
import type { RecordChange } from "../../events/types";
import { MAP_REST as R } from "../scenes-map/commands";
import { scenesSetup } from "../scenes-map/testing";
import { readFogRecord } from "./rows";

const AT = "2026-01-01T00:00:00.000Z";

function setup() {
  const t = scenesSetup();
  const newScene = (name: string, actor = t.h.dm, mapAssetId = "map-battle") =>
    t.run<SceneRecord>(R.createScene, { name, mapAssetId }, actor);
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
  test("FOG §9 DM wire: every scene's row (never windowed), box tuple, undo depth + latest entry", () => {
    const t = setup();
    t.run(I.activateScene, { sceneId: t.town.id });
    t.writeFog(t.town.id);
    t.writeFog(t.ambush.id);
    t.edit(t.ambush.id, "e1", "fog-all");
    t.edit(t.ambush.id, "e2", "reveal-rect");
    const fog = t.h.snapshot(t.h.viewer("dm")).fog as FogRecord[];
    expect(fog.map((f) => f.id).sort()).toEqual([t.town.id, t.ambush.id].sort());
    const ambush = fog.find((f) => f.id === t.ambush.id) as FogRecord;
    expect(ambush).toEqual({
      id: t.ambush.id,
      campaignId: t.h.campaignId,
      fill: "fog",
      box: [0, 0, 20, 14],
      runs: `0,5,3,${(272).toString(36)}`,
      undo: { n: 2, editId: "e2", kind: "reveal-rect" },
    });
    expect(FogRecord.parse(ambush)).toEqual(ambush);
    expect(fog.find((f) => f.id === t.town.id)?.undo).toBeNull();
    expect(readFogRecord(t.s.db, t.ambush.id)).toEqual(ambush);
    expect(readFogRecord(t.s.db, "nope")).toBeNull();
    // ADR-0041: `fog` is not a dmWindow type, so a scene load carries none.
    expect(
      Object.keys(
        t.s.records.loadScene(
          { db: t.s.db, presence: { list: () => [] } },
          t.h.viewer("dm"),
          t.ambush.id,
        ),
      ),
    ).not.toContain("fog");
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
        { id: t.town.id, fill: "fog", box: [0, 0, 20, 14], runs: `0,5,3,${(272).toString(36)}` },
      ]);
      expect(Object.keys(fog[0] as object).sort()).toEqual(["box", "fill", "id", "runs"]);
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
      data: { id: t.town.id, fill: "fog", box: [0, 0, 20, 14], runs: "0,280" },
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
