// Push at boot (ADR-0001) onto a DB created before the feedback-pass columns (protocol §28):
// additive, no data loss, defaults filled in.
import { Database } from "bun:sqlite";
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { applyStatements, createSchema, dropDuplicateIndexCreates, pushSchema } from "./push";

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
async function oldDb(file = ":memory:"): Promise<Database> {
  const db = new Database(file, { create: true, strict: true });
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

// ---------- #163: backup, one transaction, leftover rebuild tables ----------

const tmp = mkdtempSync(path.join(os.tmpdir(), "pp-push-"));
afterAll(() => {
  // Closed DBs stay locked on Windows until their statements are finalized (see `closeDb`).
  Bun.gc(true);
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {
    // A temp dir the OS cleans up; never fail the run over it.
  }
});
let n = 0;
const fileDb = () => oldDb(path.join(tmp, `db-${++n}.db`));
const tables = (db: Database) =>
  db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    .all()
    .map((r) => r.name);
const fkOn = (db: Database) => db.query("PRAGMA foreign_keys").get();

test("#163 push backs up a file DB (VACUUM INTO <db>.pre-push-<ts>.bak) before applying a change", async () => {
  const db = await fileDb();
  const r = await pushSchema(db, { now: () => new Date("2026-10-13T10:20:30.456Z") });
  expect(r.applied).toBeGreaterThan(0);
  expect(r.backup).toBe(`${db.filename}.pre-push-2026-10-13T10-20-30-456Z.bak`);
  expect(existsSync(r.backup as string)).toBe(true);
  const bak = new Database(r.backup as string, { readonly: true });
  // The backup is the DB as it was: old columns, same rows.
  expect(columns(bak, "token")).not.toContain("shape");
  expect(bak.query("SELECT name, col FROM token").get()).toEqual({ name: "Goblin", col: 3 });
  bak.close();
  expect(columns(db, "token")).toContain("shape");
  expect(fkOn(db)).toEqual({ foreign_keys: 1 });
  // No change → no backup.
  expect(await pushSchema(db)).toEqual({ applied: 0, backup: null });
  db.close();
});

test("#163 push statements apply all or nothing: a failing statement rolls back a table rebuild", async () => {
  const db = await oldDb();
  const before = tables(db);
  const rebuild = [
    "PRAGMA foreign_keys=OFF;",
    "CREATE TABLE `__new_token` AS SELECT * FROM `token`;",
    "DROP TABLE `token`;",
    "ALTER TABLE `__new_token` RENAME TO `token`;",
    "INSERT INTO `no_such_table` VALUES (1);",
    "PRAGMA foreign_keys=ON;",
  ];
  expect(() => applyStatements(db, rebuild)).toThrow(/no_such_table/);
  expect(tables(db)).toEqual(before);
  expect(db.query("SELECT name, col, row FROM token").get()).toEqual({
    name: "Goblin",
    col: 3,
    row: 4,
  });
  expect(fkOn(db)).toEqual({ foreign_keys: 1 });
  db.close();
});

test("#163 push refuses a change that breaks foreign keys (checked before commit)", async () => {
  const db = await oldDb();
  expect(() =>
    applyStatements(db, [
      "PRAGMA foreign_keys=OFF;",
      "UPDATE `token` SET `scene_id` = 'gone';",
      "PRAGMA foreign_keys=ON;",
    ]),
  ).toThrow(/foreign key/);
  expect(db.query("SELECT scene_id FROM token").get()).toEqual({ scene_id: "s1" });
  db.close();
});

test("#163 push refuses to start on leftover __new_* tables from an interrupted change", async () => {
  const db = await fileDb();
  db.run("CREATE TABLE `__new_token` (id text)");
  await expect(pushSchema(db)).rejects.toThrow(/__new_token left by an interrupted schema change/);
  expect(columns(db, "token")).not.toContain("shape");
  db.close();
});

test("FR-SCN-46 push drops drizzle-kit's repeated CREATE INDEX after a table rebuild; drop → create kept", () => {
  const stmts = [
    "DROP INDEX `campaign_one_active`;",
    "CREATE UNIQUE INDEX `campaign_one_active` ON `campaign` (`active`) WHERE active = 1;",
    "CREATE TABLE `__new_t` (`id` text);",
    "DROP TABLE `t`;",
    "ALTER TABLE `__new_t` RENAME TO `t`;",
    "CREATE UNIQUE INDEX `t_seq` ON `t` (`seq`);",
    "CREATE INDEX `t_scene` ON `t` (`scene_id`);",
    "CREATE UNIQUE INDEX `t_seq` ON `t` (`seq`);",
    "CREATE INDEX `t_scene` ON `t` (`scene_id`);",
  ];
  expect(dropDuplicateIndexCreates(stmts)).toEqual(stmts.slice(0, 7));
});
