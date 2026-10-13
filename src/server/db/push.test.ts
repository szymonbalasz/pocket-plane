// Push at boot (ADR-0001) onto a DB created before the feedback-pass columns (protocol §28):
// additive, no data loss, defaults filled in.
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createSchema, pushSchema } from "./push";

const AT = "2026-01-01T00:00:00.000Z";

/** Columns added by fix/feedback-core: table → column. */
const FEEDBACK_COLUMNS: [string, string][] = [
  ["token", "shape"],
  ["token", "speed"],
  ["entity", "token_shape"],
  ["combatant", "moved_ft"],
];

const columns = (db: Database, table: string) =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);

/** A DB with today's schema minus the feedback columns, holding one row in each table. */
async function oldDb(): Promise<Database> {
  const db = new Database(":memory:", { strict: true });
  await createSchema(db);
  for (const [table, col] of FEEDBACK_COLUMNS) db.run(`ALTER TABLE ${table} DROP COLUMN ${col}`);
  db.run("PRAGMA foreign_keys = ON");
  const ins = (sql: string, ...v: (string | number | null)[]) => db.query(sql).run(...v);
  ins(
    "INSERT INTO campaign (id, name, active, created_at, updated_at) VALUES ('c1', 'C', 1, ?, ?)",
    AT,
    AT,
  );
  ins(
    "INSERT INTO entity (id, kind, campaign_id, name, stat_block, created_at, updated_at) VALUES ('goblin', 'monster', 'c1', 'Goblin', '{}', ?, ?)",
    AT,
    AT,
  );
  ins(
    "INSERT INTO asset (id, campaign_id, seq, name, hash, mime, bytes, width, height, display_width, display_height, created_at) VALUES ('a1', 'c1', 1, 'map', 'h', 'image/webp', 1, 1, 1, 1, 1, ?)",
    AT,
  );
  ins(
    "INSERT INTO scene (id, campaign_id, seq, name, map_asset_id, map_width, map_height, grid_cell_size, grid_offset_x, grid_offset_y, grid_visible, grid_color, grid_opacity, created_at, updated_at) VALUES ('s1', 'c1', 1, 'S', 'a1', 1, 1, 70, 0, 0, 1, '#000000', 0.5, ?, ?)",
    AT,
    AT,
  );
  ins(
    "INSERT INTO token (id, campaign_id, scene_id, definition_id, seq, name, size, col, row, created_at, updated_at) VALUES ('t1', 'c1', 's1', 'goblin', 1, 'Goblin', 'small', 3, 4, ?, ?)",
    AT,
    AT,
  );
  ins(
    "INSERT INTO encounter (id, campaign_id, seq, name, status, created_at, updated_at) VALUES ('e1', 'c1', 1, 'E', 'started', ?, ?)",
    AT,
    AT,
  );
  ins(
    "INSERT INTO combatant (id, campaign_id, encounter_id, seq, kind, entity_id, token_id, name, position, hp_current, hp_max) VALUES ('k1', 'c1', 'e1', 1, 'monster', 'goblin', 't1', 'Goblin', 0, 5, 7)",
  );
  return db;
}

test("protocol §28: push adds the feedback columns to an old dev DB without data loss", async () => {
  const db = await oldDb();
  for (const [table, col] of FEEDBACK_COLUMNS) expect(columns(db, table)).not.toContain(col);

  const { applied } = await pushSchema(db);
  expect(applied).toBeGreaterThan(0);

  for (const [table, col] of FEEDBACK_COLUMNS) expect(columns(db, table)).toContain(col);
  const tok = db.query("SELECT name, col, row, shape, speed FROM token WHERE id = 't1'").get();
  expect(tok).toEqual({ name: "Goblin", col: 3, row: 4, shape: "round", speed: null });
  const ent = db.query("SELECT name, token_shape FROM entity WHERE id = 'goblin'").get();
  expect(ent).toEqual({ name: "Goblin", token_shape: null });
  const cbt = db.query("SELECT token_id, hp_current, moved_ft FROM combatant").get();
  expect(cbt).toEqual({ token_id: "t1", hp_current: 5, moved_ft: 0 });

  // Idempotent: a second boot changes nothing.
  expect((await pushSchema(db)).applied).toBe(0);
  db.close();
});

test("push still refuses a real lossy add (not-null column without a default, table not empty)", async () => {
  const db = await oldDb();
  db.run("ALTER TABLE combatant DROP COLUMN position");
  await expect(pushSchema(db)).rejects.toThrow(/would lose data[\s\S]*position/);
  expect(db.query("SELECT count(*) AS n FROM combatant").get()).toEqual({ n: 1 });
  db.close();
});
