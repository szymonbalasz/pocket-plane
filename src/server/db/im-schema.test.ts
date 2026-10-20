// Sprint-6 image tags column (ASSET §8, data model; fix/im-core): drizzle push adds `asset.tags`
// to an old dev DB without data loss; old rows read null (pre-IM-1, backfilled once at start,
// FR-ASSET-49).
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createSchema, pushSchema } from "./push";

const AT = "2026-01-01T00:00:00.000Z";

async function oldDb(): Promise<Database> {
  const db = new Database(":memory:", { strict: true });
  await createSchema(db);
  db.run("ALTER TABLE asset DROP COLUMN tags");
  db.query(
    "INSERT INTO campaign (id, name, active, created_at, updated_at) VALUES ('c1', 'C', 1, ?, ?)",
  ).run(AT, AT);
  db.query(
    `INSERT INTO asset (id, campaign_id, seq, name, hash, mime, bytes, width, height, display_width, display_height, created_at)
     VALUES ('a1', 'c1', 1, 'Map', 'h1', 'image/png', 10, 1, 1, 1, 1, ?)`,
  ).run(AT);
  return db;
}

describe("image tags schema (ASSET §8, IM-1)", () => {
  test("FR-ASSET-39 push adds asset.tags: old rows kept, tags null (pre-IM-1)", async () => {
    const db = await oldDb();
    const { applied } = await pushSchema(db);
    expect(applied).toBeGreaterThan(0);
    const rows = db.query<{ id: string; name: string; tags: string | null }, []>(
      "SELECT id, name, tags FROM asset",
    );
    expect(rows.all()).toEqual([{ id: "a1", name: "Map", tags: null }]);
    expect((await pushSchema(db)).applied).toBe(0);
  });
});
