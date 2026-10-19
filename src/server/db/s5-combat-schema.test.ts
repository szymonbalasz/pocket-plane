// Sprint 5 track R core (fix/s5-combat-core; CBT §8 sprint 5, data model §65): drizzle push adds
// the `hit_ruling` table, `combatant.side` / `public_side`, `encounter_entry.side` and
// `token.trail` to an old dev DB with safe defaults and no data loss; one ruling per card.
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createSchema, pushSchema } from "./push";

const AT = "2026-01-01T00:00:00.000Z";

const S5_COLUMNS: [string, string][] = [
  ["combatant", "side"],
  ["combatant", "public_side"],
  ["encounter_entry", "side"],
  ["token", "trail"],
];

const columns = (db: Database, table: string) =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);

/** Today's schema minus R0's table and columns, a planned encounter with one entry. */
async function oldDb(): Promise<Database> {
  const db = new Database(":memory:", { strict: true });
  await createSchema(db);
  db.run("DROP TABLE hit_ruling");
  for (const [table, col] of S5_COLUMNS) db.run(`ALTER TABLE ${table} DROP COLUMN ${col}`);
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
    "INSERT INTO encounter (id, campaign_id, seq, name, status, created_at, updated_at) VALUES ('e1', 'c1', 1, 'E', 'planned', ?, ?)",
    AT,
    AT,
  );
  ins(
    "INSERT INTO encounter_entry (id, encounter_id, seq, definition_id, quantity) VALUES ('x1', 'e1', 1, 'goblin', 3)",
  );
  return db;
}

test("FR-CBT-98 FR-MAP-65 push adds R0's table and columns to an old dev DB: defaults, no data loss", async () => {
  const db = await oldDb();
  const { applied } = await pushSchema(db);
  expect(applied).toBeGreaterThan(0);
  for (const [table, col] of S5_COLUMNS) expect(columns(db, table)).toContain(col);
  expect(columns(db, "hit_ruling")).toEqual([
    "id",
    "campaign_id",
    "encounter_id",
    "card_id",
    "to_hit_total",
    "to_hit_set",
    "targets",
    "created_at",
  ]);
  expect(db.query("SELECT quantity, side FROM encounter_entry").get()).toEqual({
    quantity: 3,
    side: "enemy",
  });
  // Idempotent: a second boot changes nothing.
  expect((await pushSchema(db)).applied).toBe(0);
  db.close();
});

test("FR-CBT-88 one hit ruling per card; it goes with its encounter", async () => {
  const db = new Database(":memory:", { strict: true });
  await createSchema(db);
  db.run("PRAGMA foreign_keys = ON");
  const ins = (sql: string, ...v: (string | number | null)[]) => db.query(sql).run(...v);
  ins(
    "INSERT INTO campaign (id, name, active, created_at, updated_at) VALUES ('c1', 'C', 1, ?, ?)",
    AT,
    AT,
  );
  ins(
    "INSERT INTO encounter (id, campaign_id, seq, name, status, created_at, updated_at) VALUES ('e1', 'c1', 1, 'E', 'started', ?, ?)",
    AT,
    AT,
  );
  ins(
    "INSERT INTO notification (id, campaign_id, seq, kind, audience, text, payload, state, created_at, updated_at) VALUES ('n1', 'c1', 1, 'damage-card', 'dm', 'x', '{}', 'pending', ?, ?)",
    AT,
    AT,
  );
  const ruling = (id: string) =>
    ins(
      "INSERT INTO hit_ruling (id, campaign_id, encounter_id, card_id, to_hit_total, to_hit_set, targets, created_at) VALUES (?, 'c1', 'e1', 'n1', 15, 0, '[]', ?)",
      id,
      AT,
    );
  ruling("r1");
  expect(() => ruling("r2")).toThrow();
  db.run("DELETE FROM encounter WHERE id = 'e1'");
  expect(db.query("SELECT count(*) AS n FROM hit_ruling").get()).toEqual({ n: 0 });
  db.close();
});
