// dice-extras table (DICEX §8, data model §36): drizzle push adds `dice_look` to an old dev DB
// without data loss; one row per (campaign, owner); the campaign FK holds.
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createSchema, pushSchema } from "./push";
import { campaign, diceLook } from "./schema";
import { openTestDb } from "./testing";

const AT = "2026-01-01T00:00:00.000Z";
const LOOK = {
  style: "crimson",
  body: "#8b1a1a",
  pips: "#ffffff",
  material: "metal",
  updatedAt: AT,
} as const;

const columns = (db: Database, table: string) =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);

describe("dice-extras schema (DICEX §8)", () => {
  test("DICEX §8 push adds dice_look: no data loss", async () => {
    const db = new Database(":memory:", { strict: true });
    await createSchema(db);
    db.run("DROP TABLE dice_look");
    db.run("PRAGMA foreign_keys = ON");
    db.query(
      "INSERT INTO campaign (id, name, active, created_at, updated_at) VALUES ('c1', 'C', 1, ?, ?)",
    ).run(AT, AT);
    const { applied } = await pushSchema(db);
    expect(applied).toBeGreaterThan(0);
    expect(columns(db, "dice_look")).toEqual([
      "id",
      "campaign_id",
      "owner_key",
      "owner_player_id",
      "style",
      "body",
      "pips",
      "material",
      "updated_at",
    ]);
    expect(db.query("SELECT name FROM campaign").get()).toEqual({ name: "C" });
    expect((await pushSchema(db)).applied).toBe(0);
    db.close();
  });

  test("FR-DICEX-24 one look per (campaign, owner); unknown campaign refused", () => {
    const db = openTestDb();
    for (const id of ["c1", "c2"])
      db.insert(campaign)
        .values({ id, name: id, active: false, createdAt: AT, updatedAt: AT })
        .run();
    db.insert(diceLook)
      .values({ id: "l1", campaignId: "c1", ownerKey: "dm", ownerPlayerId: null, ...LOOK })
      .run();
    db.insert(diceLook)
      .values({ id: "l2", campaignId: "c2", ownerKey: "dm", ownerPlayerId: null, ...LOOK })
      .run();
    db.insert(diceLook)
      .values({ id: "l3", campaignId: "c1", ownerKey: "p1", ownerPlayerId: "p1", ...LOOK })
      .run();
    expect(() =>
      db
        .insert(diceLook)
        .values({ id: "l4", campaignId: "c1", ownerKey: "dm", ownerPlayerId: null, ...LOOK })
        .run(),
    ).toThrow();
    expect(() =>
      db
        .insert(diceLook)
        .values({ id: "l5", campaignId: "nope", ownerKey: "dm", ownerPlayerId: null, ...LOOK })
        .run(),
    ).toThrow();
    expect(db.select().from(diceLook).all()).toHaveLength(3);
  });
});
