// fog-of-war tables and `token.fogged` (FOG §8, data model §24): drizzle push adds them to an old
// dev DB without data loss; both fog tables cascade with their scene; FKs hold.
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { FogEditKind, FogFill } from "@shared/fog-of-war/schemas";
import { TokenRecord } from "@shared/scenes-map/schemas";
import { eq } from "drizzle-orm";
import { toTokenRecord } from "../features/scenes-map/rows";
import { createSchema, pushSchema } from "./push";
import {
  asset,
  campaign,
  entity,
  scene,
  sceneFog,
  sceneFogEdit,
  sceneFogEditSeqNext,
  sceneSeqNext,
  token,
  tokenSeqNext,
} from "./schema";
import { openTestDb } from "./testing";

const AT = "2026-01-01T00:00:00.000Z";

const columns = (db: Database, table: string) =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);

describe("fog-of-war schema (FOG §8)", () => {
  test("FOG §8 push adds token.fogged (default false) and scene_fog / scene_fog_edit: no data loss", async () => {
    const db = new Database(":memory:", { strict: true });
    await createSchema(db);
    db.run("DROP TABLE scene_fog_edit");
    db.run("DROP TABLE scene_fog");
    db.run("ALTER TABLE token DROP COLUMN fogged");
    db.run("PRAGMA foreign_keys = ON");
    const ins = (sql: string, ...v: (string | number | null)[]) => db.query(sql).run(...v);
    ins(
      "INSERT INTO campaign (id, name, active, created_at, updated_at) VALUES ('c1', 'C', 1, ?, ?)",
      AT,
      AT,
    );
    ins(
      "INSERT INTO asset (id, campaign_id, seq, name, hash, mime, bytes, width, height, display_width, display_height, created_at) VALUES ('m', 'c1', 1, 'm', 'h', 'image/png', 1, 1, 1, 1, 1, ?)",
      AT,
    );
    ins(
      "INSERT INTO entity (id, kind, campaign_id, name, stat_block, created_at, updated_at) VALUES ('gob', 'monster', 'c1', 'Goblin', '{}', ?, ?)",
      AT,
      AT,
    );
    ins(
      "INSERT INTO scene (id, campaign_id, seq, name, map_asset_id, map_width, map_height, grid_cell_size, grid_offset_x, grid_offset_y, grid_visible, grid_color, grid_opacity, created_at, updated_at) VALUES ('s1', 'c1', 1, 'S', 'm', 1, 1, 70, 0, 0, 1, '#000000', 0.5, ?, ?)",
      AT,
      AT,
    );
    ins(
      "INSERT INTO token (id, campaign_id, scene_id, definition_id, seq, name, size, col, row, created_at, updated_at) VALUES ('t1', 'c1', 's1', 'gob', 1, 'Goblin', 'small', 3, 4, ?, ?)",
      AT,
      AT,
    );
    const { applied } = await pushSchema(db);
    expect(applied).toBeGreaterThan(0);
    expect(columns(db, "token")).toContain("fogged");
    expect(columns(db, "scene_fog")).toEqual(
      expect.arrayContaining(["scene_id", "campaign_id", "fill", "col0", "rows", "runs"]),
    );
    expect(columns(db, "scene_fog_edit")).toEqual(
      expect.arrayContaining(["id", "scene_id", "seq", "kind", "prev_fill", "prev_runs"]),
    );
    expect(db.query("SELECT name, col, row, fogged FROM token").get()).toEqual({
      name: "Goblin",
      col: 3,
      row: 4,
      fogged: 0,
    });
    // FR-FOG-01: scenes that exist before this build have no fog row (every cell clear).
    expect(db.query("SELECT count(*) AS n FROM scene_fog").get()).toEqual({ n: 0 });
    expect((await pushSchema(db)).applied).toBe(0);
    db.close();
  });

  function seed() {
    const db = openTestDb();
    db.insert(campaign)
      .values({ id: "c1", name: "c1", active: true, createdAt: AT, updatedAt: AT })
      .run();
    db.insert(asset)
      .values({
        id: "m",
        campaignId: "c1",
        seq: 1,
        name: "m",
        hash: "h",
        mime: "image/png",
        bytes: 1,
        width: 1,
        height: 1,
        displayWidth: 1,
        displayHeight: 1,
        createdAt: AT,
      })
      .run();
    db.insert(entity)
      .values({
        id: "gob",
        kind: "monster",
        campaignId: "c1",
        name: "Goblin",
        statBlock: {},
        createdAt: AT,
        updatedAt: AT,
      })
      .run();
    for (const id of ["s1", "s2"]) {
      db.insert(scene)
        .values({
          id,
          campaignId: "c1",
          seq: sceneSeqNext,
          name: id,
          mapAssetId: "m",
          mapWidth: 1400,
          mapHeight: 980,
          gridCellSize: 70,
          gridOffsetX: 0,
          gridOffsetY: 0,
          gridVisible: true,
          gridColor: "#000000",
          gridOpacity: 0.5,
          createdAt: AT,
          updatedAt: AT,
        })
        .run();
      db.insert(sceneFog)
        .values({
          sceneId: id,
          campaignId: "c1",
          fill: "fog",
          col0: 0,
          row0: 0,
          cols: 20,
          rows: 14,
          runs: "",
          updatedAt: AT,
        })
        .run();
      for (const n of [1, 2]) {
        db.insert(sceneFogEdit)
          .values({
            id: `${id}-e${n}`,
            campaignId: "c1",
            sceneId: id,
            seq: sceneFogEditSeqNext,
            kind: "reveal-rect",
            prevFill: "fog",
            prevCol0: 0,
            prevRow0: 0,
            prevCols: 20,
            prevRows: 14,
            prevRuns: "",
            createdAt: AT,
          })
          .run();
      }
    }
    return db;
  }

  test("FR-FOG-23 scene delete cascades its fog row and undo stack only", () => {
    const db = seed();
    db.delete(scene).where(eq(scene.id, "s1")).run();
    expect(
      db
        .select()
        .from(sceneFog)
        .all()
        .map((r) => r.sceneId),
    ).toEqual(["s2"]);
    expect(
      db
        .select()
        .from(sceneFogEdit)
        .all()
        .map((r) => r.id),
    ).toEqual(["s2-e1", "s2-e2"]);
  });

  test("FOG §8 one fog row per scene; FKs refuse unknown scenes; seq by the DB; enums parse", () => {
    const db = seed();
    expect(() =>
      db
        .insert(sceneFog)
        .values({
          sceneId: "s1",
          campaignId: "c1",
          fill: "clear",
          col0: 0,
          row0: 0,
          cols: 1,
          rows: 1,
          runs: "",
          updatedAt: AT,
        })
        .run(),
    ).toThrow(/UNIQUE|PRIMARY/);
    expect(() =>
      db
        .insert(sceneFog)
        .values({
          sceneId: "nope",
          campaignId: "c1",
          fill: "clear",
          col0: 0,
          row0: 0,
          cols: 1,
          rows: 1,
          runs: "",
          updatedAt: AT,
        })
        .run(),
    ).toThrow(/FOREIGN KEY/);
    const edits = db.select().from(sceneFogEdit).all();
    expect(edits.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
    for (const e of edits) {
      expect(FogEditKind.parse(e.kind)).toBe(e.kind);
      expect(FogFill.parse(e.prevFill)).toBe(e.prevFill);
    }
  });

  test("FR-FOG-10 token.fogged defaults false; the record carries `fogged` only when true", () => {
    const db = seed();
    const base = {
      campaignId: "c1",
      sceneId: "s1",
      definitionId: "gob",
      name: "Goblin",
      size: "small" as const,
      col: 1,
      row: 1,
      createdAt: AT,
      updatedAt: AT,
    };
    db.insert(token)
      .values({ ...base, id: "clear", seq: tokenSeqNext })
      .run();
    db.insert(token)
      .values({ ...base, id: "dark", seq: tokenSeqNext, fogged: true })
      .run();
    const read = (id: string) => db.select().from(token).where(eq(token.id, id)).get();
    expect(read("clear")?.fogged).toBe(false);
    const clear = toTokenRecord(read("clear") as typeof token.$inferSelect);
    const dark = toTokenRecord(read("dark") as typeof token.$inferSelect);
    expect("fogged" in clear).toBe(false);
    expect(dark.fogged).toBe(true);
    expect(TokenRecord.parse(dark)).toEqual(dark);
    expect(TokenRecord.parse(clear)).toEqual(clear);
  });
});
