// Sprint 6 track CP core (fix/cp-core; CBT §8 sprint 6, ENT §8, data model): drizzle push adds
// the pet columns on `entity`, the companion columns on `combatant` and
// `game_log_entry.audience_player_id` to an old dev DB with safe defaults and no data loss (plain
// ADD COLUMNs: no table rebuild; `position` 0 = no rank, FR-CBT-107).
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createSchemaStatements, pushSchema } from "./push";

const AT = "2026-01-01T00:00:00.000Z";

const CP_COLUMNS: [string, string][] = [
  ["entity", "companion_of"],
  ["entity", "turn_mode"],
  ["entity", "pet_present"],
  ["combatant", "owner_character_id"],
  ["combatant", "owner_player_id"],
  ["combatant", "turn_mode"],
  ["combatant", "pet"],
  ["combatant", "owner_hidden"],
  ["combatant", "concentration_effect_id"],
  ["combatant", "card"],
  ["game_log_entry", "audience_player_id"],
];

const columns = (db: Database, table: string) =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);

/**
 * Today's schema as it was before CP0: the sprint-6 columns (and their FKs / index) left out of
 * the CREATE statements (SQLite can't drop a column an FK names).
 */
async function oldDb(): Promise<Database> {
  const strip = (stmt: string) => {
    const table = /^CREATE TABLE `(\w+)`/.exec(stmt)?.[1];
    const drop = CP_COLUMNS.filter(([t]) => t === table).map(([, c]) => `\`${c}\``);
    if (drop.length === 0) return stmt;
    const lines = stmt.split("\n").filter((l) => !drop.some((c) => l.includes(c)));
    return lines.join("\n").replace(/,(\s*\n\);?\s*)$/, "$1");
  };
  const db = new Database(":memory:", { strict: true });
  for (const s of (await createSchemaStatements()).map(strip)) if (s) db.run(s);
  db.run("PRAGMA foreign_keys = ON");
  const ins = (q: string, ...v: (string | number | null)[]) => db.query(q).run(...v);
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
    "INSERT INTO encounter (id, campaign_id, seq, name, status, created_at, updated_at) VALUES ('e1', 'c1', 1, 'E', 'started', ?, ?)",
    AT,
    AT,
  );
  ins(
    "INSERT INTO combatant (id, campaign_id, encounter_id, seq, kind, entity_id, name, position, hp_current, hp_max) VALUES ('k1', 'c1', 'e1', 1, 'monster', 'goblin', 'Goblin', 3, 5, 7)",
  );
  ins(
    "INSERT INTO game_log_entry (id, campaign_id, n, at, kind, category, public, roller_role, actor_name, payload, roll_ids) VALUES ('g1', 'c1', 1, ?, 'roll', 'other', 0, 'dm', 'DM', '[]', '[]')",
    AT,
  );
  return db;
}

test("FR-CBT-105 FR-ENT-31 push adds CP0's columns to an old dev DB: defaults, no data loss", async () => {
  const db = await oldDb();
  for (const [table, col] of CP_COLUMNS) expect(columns(db, table)).not.toContain(col);
  const { applied } = await pushSchema(db);
  expect(applied).toBeGreaterThan(0);
  for (const [table, col] of CP_COLUMNS) expect(columns(db, table)).toContain(col);
  expect(
    db
      .query(
        "SELECT position, owner_character_id, turn_mode, pet, owner_hidden, card FROM combatant",
      )
      .get(),
  ).toEqual({
    position: 3,
    owner_character_id: null,
    turn_mode: null,
    pet: 0,
    owner_hidden: 0,
    card: null,
  });
  expect(db.query("SELECT companion_of, turn_mode, pet_present FROM entity").get()).toEqual({
    companion_of: null,
    turn_mode: null,
    pet_present: 0,
  });
  expect(db.query("SELECT audience_player_id FROM game_log_entry").get()).toEqual({
    audience_player_id: null,
  });
  // Idempotent: a second boot changes nothing.
  expect((await pushSchema(db)).applied).toBe(0);
  db.close();
});
