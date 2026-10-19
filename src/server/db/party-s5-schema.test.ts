// Sprint-5 party core tables and columns (PARTY §8, ASSET §8, data model §65; build/party-s5-core):
// drizzle push adds `handout_present` and `asset.listed` to an old dev DB without data loss
// (existing assets stay listed); one present per player (unique index); a handout delete
// cascades its presents.
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createSchema, pushSchema } from "./push";

const AT = "2026-01-01T00:00:00.000Z";

const columns = (db: Database, table: string) =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);
const indexes = (db: Database, table: string) =>
  db
    .query<{ name: string }, []>(`PRAGMA index_list(${table})`)
    .all()
    .map((c) => c.name);

/** Today's schema minus P0's table and column, with one campaign, player, asset, handout. */
async function oldDb(): Promise<Database> {
  const db = new Database(":memory:", { strict: true });
  await createSchema(db);
  db.run("DROP TABLE handout_present");
  db.run("ALTER TABLE asset DROP COLUMN listed");
  db.run("PRAGMA foreign_keys = ON");
  db.query(
    "INSERT INTO campaign (id, name, active, created_at, updated_at) VALUES ('c1', 'C', 1, ?, ?)",
  ).run(AT, AT);
  db.query(
    `INSERT INTO player (id, campaign_id, name, link_token, created_at, updated_at)
     VALUES ('p1', 'c1', 'Player 1', 'tok-1', ?, ?)`,
  ).run(AT, AT);
  db.query(
    `INSERT INTO asset (id, campaign_id, seq, name, hash, mime, bytes, width, height, display_width, display_height, created_at)
     VALUES ('a1', 'c1', 1, 'Map', 'h1', 'image/png', 10, 1, 1, 1, 1, ?)`,
  ).run(AT);
  db.query(
    `INSERT INTO handout (id, campaign_id, seq, title, body, image_asset_ids, shared_with, rev, body_rev, created_at, updated_at, shared_at)
     VALUES ('h1', 'c1', 1, 'Letter', '', '[]', '{"mode":"all","playerIds":[]}', 1, 1, ?, ?, ?)`,
  ).run(AT, AT, AT);
  return db;
}

describe("party-board S5 schema (PARTY §8, ASSET §8, P0)", () => {
  test("FR-PARTY-31 FR-ASSET-24 push adds handout_present + asset.listed: indexes, no data loss, old assets listed", async () => {
    const db = await oldDb();
    const { applied } = await pushSchema(db);
    expect(applied).toBeGreaterThan(0);
    expect(columns(db, "handout_present")).toEqual([
      "id",
      "campaign_id",
      "handout_id",
      "player_id",
      "presented_at",
    ]);
    expect(indexes(db, "handout_present")).toEqual(
      expect.arrayContaining(["handout_present_campaign_player", "handout_present_handout"]),
    );
    expect(db.query("SELECT id, name, listed FROM asset").all()).toEqual([
      { id: "a1", name: "Map", listed: 1 },
    ]);
    expect(db.query("SELECT id, title FROM handout").all()).toEqual([
      { id: "h1", title: "Letter" },
    ]);
    expect((await pushSchema(db)).applied).toBe(0);
    db.close();
  });

  test("FR-PARTY-31 one present per (campaign, player); FR-PARTY-35 a handout delete cascades its presents", async () => {
    const db = await oldDb();
    await pushSchema(db);
    db.run("PRAGMA foreign_keys = ON");
    const insert = db.query(
      "INSERT INTO handout_present (id, campaign_id, handout_id, player_id, presented_at) VALUES (?, 'c1', 'h1', 'p1', ?)",
    );
    insert.run("x1", AT);
    expect(() => insert.run("x2", AT)).toThrow();
    db.run("DELETE FROM handout WHERE id = 'h1'");
    expect(db.query("SELECT id FROM handout_present").all()).toEqual([]);
    db.close();
  });
});
