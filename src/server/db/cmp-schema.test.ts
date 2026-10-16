// Compendium tables (CMP §8, data model; fix/cmp-core, schema lock 4th): drizzle push adds them to
// an old dev DB without data loss; imported provenance and homebrew names are unique.
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

/** Today's schema minus C1's tables, with one campaign. */
async function oldDb(): Promise<Database> {
  const db = new Database(":memory:", { strict: true });
  await createSchema(db);
  db.run("DROP TABLE compendium_entry");
  db.run("DROP TABLE compendium_source");
  db.run("PRAGMA foreign_keys = ON");
  db.query(
    "INSERT INTO campaign (id, name, active, created_at, updated_at) VALUES ('c1', 'C', 1, ?, ?)",
  ).run(AT, AT);
  return db;
}

const entry = (db: Database, v: Record<string, string | number | null>) => {
  const row = {
    id: "e1",
    campaign_id: null,
    kind: "spell",
    source: "srd-5.1",
    source_key: "spell/fireball",
    name: "Fireball",
    name_key: "fireball",
    line: "Level 3 evocation",
    facets: "{}",
    body: "{}",
    search_text: "fireball",
    data_hash: "h",
    shared: 0,
    created_at: AT,
    updated_at: AT,
    ...v,
  };
  const keys = Object.keys(row);
  db.query(
    `INSERT INTO compendium_entry (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`,
  ).run(...(Object.values(row) as (string | number | null)[]));
};

describe("compendium schema (CMP §8, C1)", () => {
  test("FR-CMP-02 FR-CMP-04 push adds compendium_source, compendium_entry: columns, indexes, no data loss", async () => {
    const db = await oldDb();
    const { applied } = await pushSchema(db);
    expect(applied).toBeGreaterThan(0);
    expect(columns(db, "compendium_source")).toEqual(
      expect.arrayContaining([
        "key",
        "name",
        "licence",
        "attribution",
        "url",
        "version",
        "imported_at",
        "counts",
      ]),
    );
    expect(columns(db, "compendium_entry")).toEqual(
      expect.arrayContaining([
        "id",
        "campaign_id",
        "kind",
        "source",
        "source_key",
        "name",
        "name_key",
        "line",
        "facets",
        "body",
        "search_text",
        "data_hash",
        "definition_id",
        "shared",
        "derived_from_id",
        "created_at",
        "updated_at",
        "imported_at",
      ]),
    );
    expect(indexes(db, "compendium_entry")).toEqual(
      expect.arrayContaining([
        "compendium_entry_source_key",
        "compendium_entry_campaign_kind_name",
        "compendium_entry_kind_name",
        "compendium_entry_campaign",
      ]),
    );
    expect(db.query("SELECT id, name FROM campaign").all()).toEqual([{ id: "c1", name: "C" }]);
    expect((await pushSchema(db)).applied).toBe(0);
    db.close();
  });

  test("FR-CMP-02 unique (source, sourceKey); homebrew name unique ci per (campaign, kind); imported names don't count", async () => {
    const db = await oldDb();
    await pushSchema(db);
    db.query(
      `INSERT INTO compendium_source (key, name, licence, attribution, url, version, imported_at, counts)
       VALUES ('srd-5.1', 'SRD 5.1', 'CC BY 4.0', 'a', null, 'v', ?, '{}')`,
    ).run(AT);
    entry(db, {});
    expect(() => entry(db, { id: "e2" })).toThrow(/UNIQUE/);
    // Same name imported twice under different keys: fine (imported names don't count).
    entry(db, { id: "e3", source_key: "spell/fireball-2" });
    const homebrew = { campaign_id: "c1", source: null, source_key: null };
    entry(db, { ...homebrew, id: "h1" });
    expect(() => entry(db, { ...homebrew, id: "h2" })).toThrow(/UNIQUE/);
    entry(db, { ...homebrew, id: "h3", kind: "item" });
    // Unknown source → FK error.
    expect(() => entry(db, { id: "e4", source: "nope", source_key: "spell/x" })).toThrow(
      /FOREIGN KEY/,
    );
    db.close();
  });
});
