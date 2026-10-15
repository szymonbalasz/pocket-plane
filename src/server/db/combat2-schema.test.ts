// Sprint-2 P2a columns (fix/combat2-core; CBT §14, FR-MAP-50): drizzle push adds them to an old
// dev DB with safe defaults and no data loss; the scenes-map boot backfill fills `character_id`.
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { backfillCharacterIds } from "../features/scenes-map/character-copy";
import type { Db } from "./client";
import { createSchema, pushSchema } from "./push";
import { schema } from "./schema";

const AT = "2026-01-01T00:00:00.000Z";

/** Columns added by fix/combat2-core: table → column. */
const COMBAT2_COLUMNS: [string, string][] = [
  ["encounter", "create_tokens"],
  ["encounter", "add_hidden"],
  ["encounter_entry", "hp_mode"],
  ["token", "character_id"],
];

const columns = (db: Database, table: string) =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);

/** Today's schema minus the new columns, rows in each touched table. */
async function oldDb(): Promise<Database> {
  const db = new Database(":memory:", { strict: true });
  await createSchema(db);
  for (const [table, col] of COMBAT2_COLUMNS) db.run(`ALTER TABLE ${table} DROP COLUMN ${col}`);
  db.run("PRAGMA foreign_keys = ON");
  const ins = (sql: string, ...v: (string | number | null)[]) => db.query(sql).run(...v);
  ins(
    "INSERT INTO campaign (id, name, active, created_at, updated_at) VALUES ('c1', 'C', 1, ?, ?)",
    AT,
    AT,
  );
  ins(
    "INSERT INTO player (id, campaign_id, name, link_token, created_at, updated_at) VALUES ('p1', 'c1', 'Player 1', 'tok', ?, ?)",
    AT,
    AT,
  );
  ins(
    "INSERT INTO entity (id, kind, campaign_id, name, stat_block, owner_player_id, created_at, updated_at) VALUES ('mira', 'character', 'c1', 'Mira', '{}', 'p1', ?, ?)",
    AT,
    AT,
  );
  ins(
    "INSERT INTO entity (id, kind, campaign_id, name, stat_block, created_at, updated_at) VALUES ('goblin', 'monster', 'c1', 'Goblin', '{}', ?, ?)",
    AT,
    AT,
  );
  ins(
    "INSERT INTO asset (id, campaign_id, seq, name, hash, mime, bytes, width, height, display_width, display_height, created_at) VALUES ('map', 'c1', 1, 'map', 'h', 'image/png', 1, 10, 10, 10, 10, ?)",
    AT,
  );
  ins(
    "INSERT INTO scene (id, campaign_id, seq, name, map_asset_id, map_width, map_height, grid_cell_size, grid_offset_x, grid_offset_y, grid_visible, grid_color, grid_opacity, created_at, updated_at) VALUES ('s1', 'c1', 1, 'S', 'map', 700, 700, 70, 0, 0, 1, '#000000', 0.5, ?, ?)",
    AT,
    AT,
  );
  for (const [id, def, seq] of [
    ["t-mira", "mira", 1],
    ["t-gob", "goblin", 2],
  ] as const) {
    ins(
      "INSERT INTO token (id, campaign_id, scene_id, definition_id, seq, name, size, col, row, created_at, updated_at) VALUES (?, 'c1', 's1', ?, ?, ?, 'medium', 0, 0, ?, ?)",
      id,
      def,
      seq,
      id,
      AT,
      AT,
    );
  }
  ins(
    "INSERT INTO encounter (id, campaign_id, seq, name, status, created_at, updated_at) VALUES ('e1', 'c1', 1, 'E', 'planned', ?, ?)",
    AT,
    AT,
  );
  ins(
    "INSERT INTO encounter_entry (id, encounter_id, seq, definition_id, quantity) VALUES ('x1', 'e1', 1, 'goblin', 3)",
  );
  return db;
}

test("CBT §14 / FR-MAP-50 push adds the P2a columns to an old dev DB: defaults, no data loss; backfill", async () => {
  const db = await oldDb();
  const { applied } = await pushSchema(db);
  expect(applied).toBeGreaterThan(0);
  for (const [table, col] of COMBAT2_COLUMNS) expect(columns(db, table)).toContain(col);
  expect(db.query("SELECT name, create_tokens, add_hidden FROM encounter").get()).toEqual({
    name: "E",
    create_tokens: 1,
    add_hidden: 1,
  });
  expect(db.query("SELECT quantity, hp_mode FROM encounter_entry").get()).toEqual({
    quantity: 3,
    hp_mode: "average",
  });
  const tokens = () =>
    db.query("SELECT id, character_id FROM token ORDER BY seq").all() as {
      id: string;
      character_id: string | null;
    }[];
  expect(tokens()).toEqual([
    { id: "t-mira", character_id: null },
    { id: "t-gob", character_id: null },
  ]);
  // Idempotent: a second boot changes nothing.
  expect((await pushSchema(db)).applied).toBe(0);
  // The scenes-map start hook fills character tokens only.
  backfillCharacterIds(drizzle(db, { schema }) as Db);
  expect(tokens()).toEqual([
    { id: "t-mira", character_id: "mira" },
    { id: "t-gob", character_id: null },
  ]);
  db.close();
});
