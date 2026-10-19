// Sprint 5 track K core (fix/colours-core; CAMP §8, NOTE §8): drizzle push adds `player.color`
// (null, filled by the boot backfill), `campaign.dm_color` (default amber) and
// `notification.by_role` / `by_player_id` (null on old rows) to a populated DB, no data loss.
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createSchema, pushSchema } from "./push";

const AT = "2026-01-01T00:00:00.000Z";

const K0_COLUMNS: [string, string][] = [
  ["player", "color"],
  ["campaign", "dm_color"],
  ["notification", "by_role"],
  ["notification", "by_player_id"],
];

const columns = (db: Database, table: string) =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);

test("FR-CAMP-23 FR-CAMP-24 FR-NOTE-38 push adds K0's columns to a populated DB: amber DM colour, null player colour and stamp, no data loss", async () => {
  const db = new Database(":memory:", { strict: true });
  await createSchema(db);
  for (const [table, col] of K0_COLUMNS) db.run(`ALTER TABLE ${table} DROP COLUMN ${col}`);
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
    "INSERT INTO notification (id, campaign_id, seq, kind, audience, text, payload, state, created_at, updated_at) VALUES ('n1', 'c1', 1, 'test', 'all', 'x', '{}', 'info', ?, ?)",
    AT,
    AT,
  );

  const { applied } = await pushSchema(db);
  expect(applied).toBeGreaterThan(0);
  for (const [table, col] of K0_COLUMNS) expect(columns(db, table)).toContain(col);
  expect(db.query("SELECT name, dm_color FROM campaign").get()).toEqual({
    name: "C",
    dm_color: "amber",
  });
  expect(db.query("SELECT name, link_token, color FROM player").get()).toEqual({
    name: "Player 1",
    link_token: "tok",
    color: null,
  });
  expect(db.query("SELECT text, by_role, by_player_id FROM notification").get()).toEqual({
    text: "x",
    by_role: null,
    by_player_id: null,
  });
  // A new campaign row without a value gets the default.
  ins(
    "INSERT INTO campaign (id, name, active, created_at, updated_at) VALUES ('c2', 'D', 0, ?, ?)",
    AT,
    AT,
  );
  expect(db.query("SELECT dm_color FROM campaign WHERE id = 'c2'").get()).toEqual({
    dm_color: "amber",
  });
  // Idempotent: a second boot changes nothing.
  expect((await pushSchema(db)).applied).toBe(0);
  db.close();
});
