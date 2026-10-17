// Token creature type (ENT §8, MAP §8, data model token; fix/cmp-art-core): drizzle push adds
// `token.creature_type` (null) to an old dev DB without data loss; stored rows parse as records.
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { TokenRecord } from "@shared/scenes-map/schemas";
import { toTokenRecord } from "../features/scenes-map/rows";
import { createSchema, pushSchema } from "./push";
import { token } from "./schema";
import { openTestDb } from "./testing";

const AT = "2026-01-01T00:00:00.000Z";

const columns = (db: Database, table: string) =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);

function seedRows(db: Database) {
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
}

describe("token creature type schema (ENT §8)", () => {
  test("FR-ENT-27 push adds token.creature_type (null) to an old DB: no data loss", async () => {
    const db = new Database(":memory:", { strict: true });
    await createSchema(db);
    db.run("ALTER TABLE token DROP COLUMN creature_type");
    db.run("PRAGMA foreign_keys = ON");
    seedRows(db);
    const { applied } = await pushSchema(db);
    expect(applied).toBeGreaterThan(0);
    expect(columns(db, "token")).toContain("creature_type");
    expect(db.query("SELECT name, col, row, creature_type FROM token").get()).toEqual({
      name: "Goblin",
      col: 3,
      row: 4,
      creature_type: null,
    });
    expect((await pushSchema(db)).applied).toBe(0);
    db.close();
  });

  test("FR-ENT-27 stored rows (null, a type, initials) parse as token records", () => {
    const d = openTestDb();
    seedRows(d.$client);
    for (const v of [null, "giant", "initials"] as const) {
      d.update(token).set({ creatureType: v }).run();
      const row = d.select().from(token).get();
      expect(row?.creatureType).toBe(v);
      expect(TokenRecord.safeParse(toTokenRecord(row as typeof token.$inferSelect)).success).toBe(
        true,
      );
    }
  });
});
