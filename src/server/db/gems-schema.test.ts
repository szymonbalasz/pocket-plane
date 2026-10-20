// Sprint 7 schema (gems GM0, data model): drizzle push adds `campaign.features` (default `[]`) and
// `character_gems` to an old dev DB without data loss; one row per character, FKs hold.
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createSchema, pushSchema } from "./push";
import { campaign, characterGems, entity, player } from "./schema";
import { openTestDb } from "./testing";

const AT = "2026-01-01T00:00:00.000Z";

const columns = (db: Database, table: string) =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);

describe("gems schema (GEM §8, CAMP §8)", () => {
  test("FR-CAMP-38 FR-GEM-06 push adds campaign.features ([] for old rows) and character_gems: no data loss", async () => {
    const db = new Database(":memory:", { strict: true });
    await createSchema(db);
    db.run("DROP TABLE character_gems");
    db.run("ALTER TABLE campaign DROP COLUMN features");
    db.run("PRAGMA foreign_keys = ON");
    db.query(
      "INSERT INTO campaign (id, name, active, created_at, updated_at) VALUES ('c1', 'C', 1, ?, ?)",
    ).run(AT, AT);
    const { applied } = await pushSchema(db);
    expect(applied).toBeGreaterThan(0);
    expect(columns(db, "campaign")).toContain("features");
    expect(columns(db, "character_gems")).toEqual([
      "id",
      "campaign_id",
      "inspiration",
      "fortune",
      "combat",
      "divine",
      "action",
      "updated_at",
    ]);
    expect(db.query("SELECT name, features FROM campaign").get()).toEqual({
      name: "C",
      features: "[]",
    });
    expect((await pushSchema(db)).applied).toBe(0);
    db.close();
  });

  test("FR-GEM-06 one row per character; counts default 0; unknown character / campaign refused", () => {
    const db = openTestDb();
    db.insert(campaign)
      .values({ id: "c1", name: "C", active: true, createdAt: AT, updatedAt: AT })
      .run();
    expect(db.select({ f: campaign.features }).from(campaign).get()).toEqual({ f: [] });
    db.insert(player)
      .values({
        id: "p1",
        campaignId: "c1",
        name: "P",
        linkToken: "t".repeat(22),
        createdAt: AT,
        updatedAt: AT,
      })
      .run();
    db.insert(entity)
      .values({
        id: "e1",
        kind: "character",
        campaignId: "c1",
        name: "Mira",
        statBlock: {},
        ownerPlayerId: "p1",
        createdAt: AT,
        updatedAt: AT,
      })
      .run();
    db.insert(characterGems)
      .values({ id: "e1", campaignId: "c1", fortune: 2, updatedAt: AT })
      .run();
    expect(db.select().from(characterGems).where(eq(characterGems.id, "e1")).get()).toEqual({
      id: "e1",
      campaignId: "c1",
      inspiration: 0,
      fortune: 2,
      combat: 0,
      divine: 0,
      action: 0,
      updatedAt: AT,
    });
    expect(() =>
      db.insert(characterGems).values({ id: "e1", campaignId: "c1", updatedAt: AT }).run(),
    ).toThrow();
    expect(() =>
      db.insert(characterGems).values({ id: "nope", campaignId: "c1", updatedAt: AT }).run(),
    ).toThrow();
    expect(() =>
      db.insert(characterGems).values({ id: "e1x", campaignId: "nope", updatedAt: AT }).run(),
    ).toThrow();
  });
});
