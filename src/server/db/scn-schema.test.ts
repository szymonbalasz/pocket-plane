// scene-tools tables (SCN §8, data model §25): drizzle push adds them to an old dev DB without
// data loss; scene tables cascade with their scene; FKs hold; JSON leaves round-trip.
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createSchema, pushSchema } from "./push";
import {
  aoeTemplate,
  aoeTemplateSeqNext,
  asset,
  campaign,
  mapSettings,
  player,
  prop,
  propSeqNext,
  scene,
  sceneSeqNext,
  sceneStructure,
} from "./schema";
import { openTestDb } from "./testing";

const AT = "2026-01-01T00:00:00.000Z";
const TABLES = ["scene_structure", "prop", "aoe_template", "map_settings"];

const columns = (db: Database, table: string) =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);

describe("scene-tools schema (SCN §8)", () => {
  test("SCN §8 push adds scene_structure / prop / aoe_template / map_settings: no data loss", async () => {
    const db = new Database(":memory:", { strict: true });
    await createSchema(db);
    for (const t of TABLES) db.run(`DROP TABLE ${t}`);
    db.run("PRAGMA foreign_keys = ON");
    db.query(
      "INSERT INTO campaign (id, name, active, created_at, updated_at) VALUES ('c1', 'C', 1, ?, ?)",
    ).run(AT, AT);
    const { applied } = await pushSchema(db);
    expect(applied).toBeGreaterThan(0);
    expect(columns(db, "scene_structure")).toEqual(
      expect.arrayContaining(["scene_id", "campaign_id", "rev", "next_n", "walls", "doors"]),
    );
    expect(columns(db, "prop")).toEqual(
      expect.arrayContaining(["asset_id", "w", "h", "rotation", "z", "hidden", "locked", "fogged"]),
    );
    expect(columns(db, "aoe_template")).toEqual(
      expect.arrayContaining(["shape", "x", "y", "size", "width", "angle", "placed_by_player_id"]),
    );
    expect(columns(db, "aoe_template")).toContain("fogged");
    expect(columns(db, "map_settings")).toEqual(["campaign_id", "diagonal_rule", "updated_at"]);
    expect(db.query("SELECT name FROM campaign").get()).toEqual({ name: "C" });
    expect((await pushSchema(db)).applied).toBe(0);
    db.close();
  });

  function seed() {
    const db = openTestDb();
    db.insert(campaign)
      .values({ id: "c1", name: "c1", active: true, createdAt: AT, updatedAt: AT })
      .run();
    db.insert(player)
      .values({
        id: "p1",
        campaignId: "c1",
        name: "P1",
        linkToken: "t".repeat(32),
        createdAt: AT,
        updatedAt: AT,
      })
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
      db.insert(sceneStructure)
        .values({
          sceneId: id,
          campaignId: "c1",
          rev: 1,
          nextN: 3,
          walls: [[1, 8, 0, 8, 5]],
          doors: [[2, 8, 5, 8, 6, 1, 0]],
          updatedAt: AT,
        })
        .run();
      db.insert(prop)
        .values({
          id: `${id}-barrel`,
          campaignId: "c1",
          sceneId: id,
          seq: propSeqNext,
          assetId: "m",
          col: 5,
          row: 3,
          w: 1,
          h: 1,
          createdAt: AT,
          updatedAt: AT,
        })
        .run();
      db.insert(aoeTemplate)
        .values({
          id: `${id}-sphere`,
          campaignId: "c1",
          sceneId: id,
          seq: aoeTemplateSeqNext,
          shape: "sphere",
          x: 3,
          y: 8,
          size: 15,
          angle: 0,
          placedByPlayerId: "p1",
          createdAt: AT,
          updatedAt: AT,
        })
        .run();
    }
    return db;
  }

  test("SCN §8 scene delete cascades its structure, props and templates only", () => {
    const db = seed();
    db.delete(scene).where(eq(scene.id, "s1")).run();
    expect(
      db
        .select()
        .from(sceneStructure)
        .all()
        .map((r) => r.sceneId),
    ).toEqual(["s2"]);
    expect(
      db
        .select()
        .from(prop)
        .all()
        .map((r) => r.id),
    ).toEqual(["s2-barrel"]);
    expect(
      db
        .select()
        .from(aoeTemplate)
        .all()
        .map((r) => r.id),
    ).toEqual(["s2-sphere"]);
  });

  test("SCN §8 defaults, JSON leaves, seq by the DB; FKs refuse unknown scene / asset / player", () => {
    const db = seed();
    const s = db.select().from(sceneStructure).where(eq(sceneStructure.sceneId, "s1")).get();
    expect(s?.walls).toEqual([[1, 8, 0, 8, 5]]);
    expect(s?.doors).toEqual([[2, 8, 5, 8, 6, 1, 0]]);
    const p = db.select().from(prop).where(eq(prop.id, "s1-barrel")).get();
    expect(p).toMatchObject({ rotation: 0, z: 0, hidden: false, locked: false, fogged: false });
    expect(
      db
        .select()
        .from(prop)
        .all()
        .map((r) => r.seq),
    ).toEqual([1, 2]);
    const t = db.select().from(aoeTemplate).where(eq(aoeTemplate.id, "s1-sphere")).get();
    expect(t).toMatchObject({ width: null, label: "", hidden: false, fogged: false });
    expect(
      db
        .select()
        .from(aoeTemplate)
        .all()
        .map((r) => r.seq),
    ).toEqual([1, 2]);
    expect(() =>
      db
        .insert(sceneStructure)
        .values({
          sceneId: "nope",
          campaignId: "c1",
          rev: 1,
          nextN: 1,
          walls: [],
          doors: [],
          updatedAt: AT,
        })
        .run(),
    ).toThrow(/FOREIGN KEY/);
    expect(() =>
      db
        .insert(prop)
        .values({
          id: "x",
          campaignId: "c1",
          sceneId: "s1",
          seq: propSeqNext,
          assetId: "nope",
          col: 0,
          row: 0,
          w: 1,
          h: 1,
          createdAt: AT,
          updatedAt: AT,
        })
        .run(),
    ).toThrow(/FOREIGN KEY/);
    expect(() =>
      db
        .insert(aoeTemplate)
        .values({
          id: "y",
          campaignId: "c1",
          sceneId: "s1",
          seq: aoeTemplateSeqNext,
          shape: "cone",
          x: 0,
          y: 0,
          size: 15,
          angle: 0,
          placedByPlayerId: "nope",
          createdAt: AT,
          updatedAt: AT,
        })
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });

  test("FR-SCN-29 map_settings: one row per campaign", () => {
    const db = seed();
    db.insert(mapSettings).values({ campaignId: "c1", diagonalRule: "5", updatedAt: AT }).run();
    expect(() =>
      db
        .insert(mapSettings)
        .values({ campaignId: "c1", diagonalRule: "5-10-5", updatedAt: AT })
        .run(),
    ).toThrow(/UNIQUE|PRIMARY/);
    expect(() =>
      db.insert(mapSettings).values({ campaignId: "nope", diagonalRule: "5", updatedAt: AT }).run(),
    ).toThrow(/FOREIGN KEY/);
  });
});
