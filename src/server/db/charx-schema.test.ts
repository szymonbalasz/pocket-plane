// `creature_sheet` (character-sheet-full §8.2, data model §20): drizzle push adds it to an
// existing dev DB without touching MVP rows; FKs and the 1:1 primary key hold.
import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { createSchema, pushSchema } from "./push";

const AT = "2026-01-01T00:00:00.000Z";

async function dbWithMvpRows(): Promise<Database> {
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
    "INSERT INTO player (id, campaign_id, name, link_token, created_at, updated_at) VALUES ('p1', 'c1', 'Player 1', 'tok', ?, ?)",
    AT,
    AT,
  );
  ins(
    "INSERT INTO entity (id, kind, campaign_id, name, stat_block, owner_player_id, hp_current, created_at, updated_at) VALUES ('mira', 'character', 'c1', 'Mira', '{\"ac\":16}', 'p1', 12, ?, ?)",
    AT,
    AT,
  );
  return db;
}

const sheet = (entityId: string, campaignId = "c1", owner: string | null = "p1") =>
  [
    "INSERT INTO creature_sheet (entity_id, campaign_id, owner_player_id, status, proficiency_notes, spells, features, items, slots_used, hit_dice_used, created_at, updated_at) VALUES (?, ?, ?, 'draft', '{}', '[]', '[]', '[]', '{}', '{}', ?, ?)",
    entityId,
    campaignId,
    owner,
    AT,
    AT,
  ] as const;

test("FR-CHARX-02 push adds creature_sheet to a DB without it; MVP rows unchanged", async () => {
  const db = await dbWithMvpRows();
  db.run("DROP TABLE creature_sheet");
  const before = db.query("SELECT * FROM entity").all();
  const { applied } = await pushSchema(db);
  expect(applied).toBeGreaterThan(0);
  expect(db.query("SELECT * FROM entity").all()).toEqual(before);
  expect(db.query("SELECT count(*) AS n FROM creature_sheet").get()).toEqual({ n: 0 });
  expect((await pushSchema(db)).applied).toBe(0);
  db.close();
});

test("FR-CHARX-02 creature_sheet: 1:1 with an entity, text defaults, FKs enforced", async () => {
  const db = await dbWithMvpRows();
  const [sql, ...args] = sheet("mira");
  db.query(sql).run(...args);
  expect(
    db.query("SELECT locked, background, alignment, notes, status FROM creature_sheet").get(),
  ).toEqual({ locked: 0, background: "", alignment: "", notes: "", status: "draft" });
  // Primary key = entity id: a second row for the same entity fails.
  expect(() => db.query(sql).run(...args)).toThrow();
  const [s2, ...a2] = sheet("nobody");
  expect(() => db.query(s2).run(...a2)).toThrow(/FOREIGN KEY/);
  const [s3, ...a3] = sheet("mira", "c1", "ghost");
  db.run("DELETE FROM creature_sheet");
  expect(() => db.query(s3).run(...a3)).toThrow(/FOREIGN KEY/);
  db.close();
});
