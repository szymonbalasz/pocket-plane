// Scenes list columns (FR-MAP-02, FR-MAP-116): drizzle push adds them to an old DB, a real campaign's
// included, with its rows kept and its list order unchanged.
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { sceneOrder } from "@shared/scenes-map/list-tree";
import { createSchema, dropFalseTruncates, pushSchema } from "./push";

const AT = "2026-01-01T00:00:00.000Z";

const columns = (db: Database, table: string) =>
  (db.query(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);

function seedRows(db: Database) {
  const ins = (sql: string, ...args: string[]) => db.query(sql).run(...args);
  ins(
    "INSERT INTO campaign (id, name, active, created_at, updated_at) VALUES ('c1', 'C', 1, ?, ?)",
    AT,
    AT,
  );
  ins(
    "INSERT INTO scene_folder (id, campaign_id, seq, name, created_at, updated_at) VALUES ('f1', 'c1', 1, 'Act 1', ?, ?)",
    AT,
    AT,
  );
  ins(
    "INSERT INTO asset (id, campaign_id, seq, name, hash, mime, bytes, width, height, display_width, display_height, created_at) VALUES ('a1', 'c1', 1, 'm', 'h', 'image/png', 1, 10, 10, 10, 10, ?)",
    AT,
  );
  for (const [id, seq, folder, name] of [
    ["s1", 1, "f1", "Town"],
    ["s2", 2, "f1", "Goblin Ambush"],
    ["s3", 3, null, "Cellar"],
  ] as const) {
    db.query(
      "INSERT INTO scene (id, campaign_id, folder_id, seq, name, map_asset_id, map_width, map_height, grid_cell_size, grid_offset_x, grid_offset_y, grid_visible, grid_color, grid_opacity, created_at, updated_at) VALUES (?, 'c1', ?, ?, ?, 'a1', 10, 10, 70, 0, 0, 1, '#000000', 0.5, ?, ?)",
    ).run(id, folder, seq, name, AT, AT);
  }
  ins(
    "INSERT INTO entity (id, kind, campaign_id, name, stat_block, created_at, updated_at) VALUES ('gob', 'monster', 'c1', 'Goblin', '{}', ?, ?)",
    AT,
    AT,
  );
  ins(
    "INSERT INTO token (id, campaign_id, scene_id, definition_id, seq, name, size, col, row, created_at, updated_at) VALUES ('t1', 'c1', 's1', 'gob', 1, 'Goblin', 'small', 3, 4, ?, ?)",
    AT,
    AT,
  );
  ins(
    "INSERT INTO overview (id, campaign_id, folder_id, seq, name, created_at, updated_at) VALUES ('o1', 'c1', 'f1', 1, 'Sword Coast', ?, ?)",
    AT,
    AT,
  );
}

describe("Scenes list schema", () => {
  test("FR-MAP-116 push adds parent and position to an old DB: rows kept, order unchanged", async () => {
    const db = new Database(":memory:", { strict: true });
    await createSchema(db);
    // The old folder table, as a real campaign has it: a self-reference can't be dropped.
    db.run("PRAGMA foreign_keys = OFF");
    db.run("DROP TABLE scene_folder");
    db.run(
      "CREATE TABLE scene_folder (id text PRIMARY KEY NOT NULL, campaign_id text NOT NULL, seq integer NOT NULL, name text NOT NULL, created_at text NOT NULL, updated_at text NOT NULL, FOREIGN KEY (campaign_id) REFERENCES campaign(id))",
    );
    db.run("CREATE UNIQUE INDEX scene_folder_seq ON scene_folder (seq)");
    db.run("CREATE INDEX scene_folder_campaign ON scene_folder (campaign_id)");
    db.run("ALTER TABLE scene DROP COLUMN position");
    db.run("ALTER TABLE overview DROP COLUMN position");
    db.run("PRAGMA foreign_keys = ON");
    seedRows(db);

    const { applied } = await pushSchema(db);
    expect(applied).toBeGreaterThan(0);
    expect(columns(db, "scene_folder")).toEqual(expect.arrayContaining(["parent_id", "position"]));
    expect(columns(db, "scene")).toContain("position");
    expect(columns(db, "overview")).toContain("position");

    const folders = db
      .query("SELECT id, name, seq, parent_id AS parentId, position FROM scene_folder")
      .all() as { id: string; name: string; seq: number; parentId: null; position: number }[];
    expect(folders).toEqual([{ id: "f1", name: "Act 1", seq: 1, parentId: null, position: 0 }]);
    const scenes = db
      .query("SELECT id, name, seq, folder_id AS folderId, position FROM scene")
      .all() as {
      id: string;
      name: string;
      seq: number;
      folderId: string | null;
      position: number;
    }[];
    expect(scenes.map((s) => s.position)).toEqual([0, 0, 0]);
    // Nothing else went with it: tokens and overviews, in every table adding `position`.
    expect(db.query("SELECT id FROM token").all()).toEqual([{ id: "t1" }]);
    expect(db.query("SELECT id, position FROM overview").all()).toEqual([
      { id: "o1", position: 0 },
    ]);
    // As before: the folder's scenes by name, then the root's.
    expect(sceneOrder(folders, scenes).map((s) => s.name)).toEqual([
      "Goblin Ambush",
      "Town",
      "Cellar",
    ]);
    expect((await pushSchema(db)).applied).toBe(0);
    db.close();
  });

  // drizzle-kit 0.31 wrongly truncates a table gaining a `NOT NULL DEFAULT 0` column.
  const warn = (col: string) =>
    `· You're about to add not-null ${col} column without default value, which contains 3 items`;
  const add = (table: string, tail = "DEFAULT 0 NOT NULL") =>
    `ALTER TABLE \`${table}\` ADD \`position\` integer ${tail};`;

  test("FR-MAP-116 the same column on two non-empty tables: both false truncates go", () => {
    const stmts = ["delete from scene;", add("scene"), "delete from overview;", add("overview")];
    expect(dropFalseTruncates(stmts, [warn("position"), warn("position")])).toEqual([]);
    expect(stmts).toEqual([add("scene"), add("overview")]);
  });

  test("FR-MAP-116 a column truly without a default stays refused, even beside one with", () => {
    const stmts = [
      "delete from scene;",
      add("scene"),
      "delete from overview;",
      add("overview", "NOT NULL"),
    ];
    expect(dropFalseTruncates(stmts, [warn("position"), warn("position")])).toEqual([
      warn("position"),
    ]);
  });

  test("FR-MAP-116 a truncate no warning accounts for is never dropped silently", () => {
    const stmts = ["delete from scene;", add("scene")];
    expect(dropFalseTruncates(stmts, [warn("other")])).toEqual([warn("other")]);
    expect(stmts).toContain("delete from scene;");
  });
});
