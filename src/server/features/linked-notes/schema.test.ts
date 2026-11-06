// FR-NOTES-24 new tables only (#416): a DB from before linked notes (today's schema minus `note`,
// `note_change`, `note_link`, with a campaign row) gets the three tables from the schema push with
// no data loss and no rename question; they start empty; a second push applies nothing. N8: a
// `note` table from before categories gains `category`, its notes Other (FR-NOTES-25).
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createSchema, pushSchema } from "../../db/push";

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
const rows = (db: Database, table: string) =>
  db.query<{ n: number }, []>(`SELECT count(*) AS n FROM ${table}`).get()?.n;

async function preNotesDb(): Promise<Database> {
  const db = new Database(":memory:", { strict: true });
  await createSchema(db);
  db.run("DROP TABLE note_link");
  db.run("DROP TABLE note_change");
  db.run("DROP TABLE note");
  db.run("PRAGMA foreign_keys = ON");
  db.query(
    "INSERT INTO campaign (id, name, active, created_at, updated_at) VALUES ('c1', 'C', 1, ?, ?)",
  ).run(AT, AT);
  return db;
}

describe("linked-notes schema (N1)", () => {
  test("FR-NOTES-24 a DB without the notes tables boots: push adds them empty, keeps the data, then applies nothing", async () => {
    const db = await preNotesDb();
    const { applied } = await pushSchema(db);
    expect(applied).toBeGreaterThan(0);
    expect(columns(db, "note")).toEqual([
      "id",
      "campaign_id",
      "title",
      "title_fold",
      "category",
      "created_by_role",
      "created_by_player_id",
      "created_at",
      "updated_at",
      "updated_by_role",
      "updated_by_player_id",
      "deleted_at",
      "deleted_by_role",
      "deleted_by_player_id",
      "body",
      "body_fold",
      "body_version",
      "version",
    ]);
    expect(columns(db, "note_change")).toEqual([
      "note_id",
      "version",
      "client_id",
      "changes",
      "at",
    ]);
    expect(columns(db, "note_link")).toEqual(["note_id", "target_fold"]);
    expect(indexes(db, "note")).toContain("note_campaign_title");
    expect(indexes(db, "note_link")).toContain("note_link_target");
    for (const t of ["note", "note_change", "note_link"]) expect([t, rows(db, t)]).toEqual([t, 0]);
    expect(db.query("SELECT id, name FROM campaign").all()).toEqual([{ id: "c1", name: "C" }]);
    expect((await pushSchema(db)).applied).toBe(0);
    db.close();
  });

  test("FR-NOTES-25 a note table from before categories gains the column: every note is Other, nothing lost", async () => {
    const db = new Database(":memory:", { strict: true });
    await createSchema(db);
    db.run("ALTER TABLE note DROP COLUMN category");
    db.query(
      "INSERT INTO campaign (id, name, active, created_at, updated_at) VALUES ('c1', 'C', 1, ?, ?)",
    ).run(AT, AT);
    for (const [id, title] of [
      ["n1", "Burnt Ledger"],
      ["n2", "Quest log"],
    ])
      db.query(
        `INSERT INTO note (id, campaign_id, title, title_fold, created_by_role, created_at, updated_at, updated_by_role, body)
         VALUES (?, 'c1', ?, lower(?), 'dm', ?, ?, 'dm', 'kept')`,
      ).run(id as string, title as string, title as string, AT, AT);
    expect(columns(db, "note")).not.toContain("category");
    const { applied } = await pushSchema(db);
    expect(applied).toBeGreaterThan(0);
    expect(db.query("SELECT id, title, category, body FROM note ORDER BY id").all()).toEqual([
      { id: "n1", title: "Burnt Ledger", category: "other", body: "kept" },
      { id: "n2", title: "Quest log", category: "other", body: "kept" },
    ]);
    expect((await pushSchema(db)).applied).toBe(0);
    db.close();
  });

  test("FR-NOTES-24 a note's change and link rows go with it (cascade, for a later purge)", async () => {
    const db = new Database(":memory:", { strict: true });
    await createSchema(db);
    db.run("PRAGMA foreign_keys = ON");
    db.query(
      "INSERT INTO campaign (id, name, active, created_at, updated_at) VALUES ('c1', 'C', 1, ?, ?)",
    ).run(AT, AT);
    db.query(
      `INSERT INTO note (id, campaign_id, title, title_fold, created_by_role, created_at, updated_at, updated_by_role)
       VALUES ('n1', 'c1', 'T', 't', 'dm', ?, ?, 'dm')`,
    ).run(AT, AT);
    expect(db.query("SELECT body, body_fold, body_version, version FROM note").get()).toEqual({
      body: "",
      body_fold: "",
      body_version: 0,
      version: 0,
    });
    db.query(
      "INSERT INTO note_change (note_id, version, client_id, changes, at) VALUES ('n1', 1, 'c', '[]', ?)",
    ).run(AT);
    db.run("INSERT INTO note_link (note_id, target_fold) VALUES ('n1', 'duke varen')");
    db.run("DELETE FROM note WHERE id = 'n1'");
    expect([rows(db, "note_change"), rows(db, "note_link")]).toEqual([0, 0]);
    db.close();
  });
});
