// Push at boot (ADR-0001) onto a DB created before the feedback-pass columns (protocol §28):
// additive, no data loss, defaults filled in.
import { Database } from "bun:sqlite";
import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyStatements,
  createSchema,
  dropDuplicateIndexCreates,
  pushSchema,
  SchemaPushError,
  withoutPrompts,
} from "./push";
import { schema } from "./schema";

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

// ---------- BL-172: what drizzle-kit would ask about becomes a refusal, in any terminal ----------

/** One of today's tables under another name: the schema gains a table and the DB has an extra one. */
const tableSwapped = (db: Database) => db.run("ALTER TABLE sync_probe RENAME TO sync_probe_old");
/** `name` now `name_old` in the DB: the schema gains a column and the DB has an extra one. */
const columnRenamed = (db: Database) => db.run("ALTER TABLE token RENAME COLUMN name TO name_old");

/** Runs `fn` with this process claiming the given terminal state, as a real pane would show it. */
async function withTty<T>(isTty: boolean, fn: () => Promise<T>): Promise<T> {
  const streams = [process.stdin, process.stdout];
  const before = streams.map((s) => Object.getOwnPropertyDescriptor(s, "isTTY"));
  for (const s of streams) Object.defineProperty(s, "isTTY", { value: isTty, configurable: true });
  try {
    return await fn();
  } finally {
    streams.forEach((s, i) => {
      const b = before[i];
      if (b) Object.defineProperty(s, "isTTY", b);
      else delete (s as { isTTY?: boolean }).isTTY;
    });
  }
}

const refusal = async (db: Database) => {
  const err = await pushSchema(db).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(SchemaPushError);
  return (err as Error).message;
};

for (const isTty of [false, true]) {
  const where = isTty ? "a terminal" : "no terminal";

  test(`BL-172 a table gaining one column and losing another is refused, nothing applied (${where})`, async () => {
    const db = await oldDb();
    columnRenamed(db);
    const message = await withTty(isTty, () => refusal(db));
    expect(message).toContain("nothing was changed");
    expect(message).toContain("table token: new column(s)");
    expect(message).toContain("old column(s) name_old");
    expect(message).toContain("copy at boot (ADR-0076)");
    expect(columns(db, "token")).toContain("name_old");
    expect(columns(db, "token")).not.toContain("shape");
    db.close();
  });

  test(`BL-172 a table swapped for another is refused, nothing applied (${where})`, async () => {
    const db = await oldDb();
    tableSwapped(db);
    const before = tables(db);
    const message = await withTty(isTty, () => refusal(db));
    expect(message).toContain("new table(s) sync_probe; old table(s) sync_probe_old");
    expect(message).toContain("add the new one and copy at boot (ADR-0076)");
    expect(tables(db)).toEqual(before);
    db.close();
  });

  test(`BL-172 a plain added column still applies (${where})`, async () => {
    const db = await oldDb();
    const { applied } = await withTty(isTty, () => pushSchema(db));
    expect(applied).toBeGreaterThan(0);
    expect(columns(db, "token")).toContain("shape");
    db.close();
  });
}

test("BL-172 a refused file DB gets no backup: nothing to restore from it, nothing written", async () => {
  const db = await fileDb();
  columnRenamed(db);
  const stem = path.basename(db.filename);
  await refusal(db);
  expect(readdirSync(tmp).filter((f) => f.startsWith(`${stem}.pre-push-`))).toEqual([]);
  db.close();
});

test("BL-172 drizzle-kit's own prompt rejects instead of waiting, in a terminal (the safety net)", async () => {
  const db = await oldDb();
  columnRenamed(db);
  const api = await import("drizzle-kit/api");
  const { drizzle } = await import("drizzle-orm/bun-sqlite");
  // Hide the spinner, as pushSchema does.
  const write = process.stdout.write;
  process.stdout.write = (() => true) as typeof write;
  const err = await withTty(true, () =>
    withoutPrompts(() => api.pushSQLiteSchema(schema, drizzle(db) as never)).then(
      () => null,
      (e: unknown) => e,
    ),
  ).finally(() => {
    process.stdout.write = write;
  });
  expect(String(err)).toContain("Interactive prompts require a TTY terminal");
  db.close();
});

test("BL-172 the terminal check is restored after a push, refused or not", async () => {
  await withTty(true, async () => {
    await withoutPrompts(async () => expect(process.stdout.isTTY).toBe(false));
    expect(process.stdout.isTTY).toBe(true);
    await withoutPrompts(() => Promise.reject(new Error("x"))).catch(() => {});
    expect(process.stdout.isTTY).toBe(true);
  });
});

test("BL-172 the data-loss refusal says what to do on real data, in plain text", async () => {
  const db = await oldDb();
  db.run("ALTER TABLE combatant DROP COLUMN position");
  const message = await refusal(db);
  expect(message).toContain("nothing was changed");
  expect(message).toContain("go back to the previous version of the app and restart");
  expect(message).toContain("`play` start-up backup or a `<db>.pre-push-*.bak`");
  expect(message).toContain("copy at boot (ADR-0076)");
  expect(message).toContain("fixtures:reset-load");
  // biome-ignore lint/suspicious/noControlCharactersInRegex: no colour codes in a refusal.
  expect(message).not.toMatch(/\u001b/);
  db.close();
});

test("BL-172 the interrupted-push refusal says what to do on real data", async () => {
  const db = await fileDb();
  db.run("CREATE TABLE `__new_token` (id text)");
  const message = await refusal(db);
  expect(message).toContain("`<db>.pre-push-*.bak` or `play` start-up backup");
  expect(message).toContain("-wal / -shm");
  expect(message).toContain("fixtures:reset-load");
  db.close();
});
