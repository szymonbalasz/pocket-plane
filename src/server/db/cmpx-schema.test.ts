// Compendium expansion (§8, data model §149; fix/cmpx-core): drizzle push adds `replaces`,
// `art_path` and `imported_art` to an old dev DB without data loss; old rows read the defaults.
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createSchema, pushSchema } from "./push";

const AT = "2026-01-01T00:00:00.000Z";

const columns = (db: Database, table: string) =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);

/** Today's schema minus this slice's columns and table, with one imported entry. */
async function oldDb(): Promise<Database> {
  const db = new Database(":memory:", { strict: true });
  await createSchema(db);
  db.run("DROP TABLE imported_art");
  db.run("ALTER TABLE compendium_entry DROP COLUMN replaces");
  db.run("ALTER TABLE compendium_entry DROP COLUMN art_path");
  db.query(
    `INSERT INTO compendium_source (key, name, licence, attribution, version, imported_at, counts)
     VALUES ('srd-5.1', 'SRD 5.1', 'CC', 'a', 'v', ?, '{}')`,
  ).run(AT);
  db.query(
    `INSERT INTO compendium_entry (id, kind, source, source_key, name, name_key, line, facets, body,
       search_text, data_hash, shared, created_at, updated_at)
     VALUES ('e1', 'spell', 'srd-5.1', 'spell/fireball', 'Fireball', 'fireball', 'l', '{}', '{}',
       'fireball', 'h', 0, ?, ?)`,
  ).run(AT, AT);
  return db;
}

describe("compendium expansion schema", () => {
  test("FR-CMPX-13 FR-CMPX-23 FR-CMPX-24 push adds replaces, art_path, imported_art: no data loss, defaults on old rows", async () => {
    const db = await oldDb();
    expect((await pushSchema(db)).applied).toBeGreaterThan(0);
    expect(columns(db, "compendium_entry")).toEqual(
      expect.arrayContaining(["replaces", "art_path"]),
    );
    expect(columns(db, "imported_art")).toEqual([
      "campaign_id",
      "source",
      "source_key",
      "asset_id",
      "created_at",
    ]);
    expect(
      db.query("SELECT id, replaces, art_path, data_hash FROM compendium_entry").all(),
    ).toEqual([{ id: "e1", replaces: "[]", art_path: null, data_hash: "h" }]);
    expect((await pushSchema(db)).applied).toBe(0);
  });
});
