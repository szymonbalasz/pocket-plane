// Party-board tables and columns (PARTY §8, data model §28; build/party-core): drizzle push adds
// them to an old dev DB without data loss; indexes hold; a stored loot row keeps `qty` null and
// its wire record has no `qty`; an item row's record carries it (FR-PARTY-25).
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { LootEntryRecord } from "@shared/party-loot/schemas";
import { toEntryRecord } from "../features/party-loot/rows";
import { createSchema, pushSchema } from "./push";
import { campaign, lootEntry, lootEntrySeqNext } from "./schema";
import { openTestDb } from "./testing";

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

/** Today's schema minus P core's tables and column, with one loot row. */
async function oldDb(): Promise<Database> {
  const db = new Database(":memory:", { strict: true });
  await createSchema(db);
  db.run("DROP TABLE handout");
  db.run("DROP TABLE party_item");
  db.run("ALTER TABLE loot_entry DROP COLUMN qty");
  db.run("PRAGMA foreign_keys = ON");
  db.query(
    "INSERT INTO campaign (id, name, active, created_at, updated_at) VALUES ('c1', 'C', 1, ?, ?)",
  ).run(AT, AT);
  db.query(
    `INSERT INTO loot_entry (id, campaign_id, seq, kind, from_kind, to_kind, text, cp, sp, ep, gp, pp, created_at)
     VALUES ('e1', 'c1', 1, 'loot', 'world', 'party', 'Pouch', 0, 0, 0, 12, 0, ?)`,
  ).run(AT);
  return db;
}

describe("party-board schema (PARTY §8, P core)", () => {
  test("FR-PARTY-01 FR-PARTY-17 FR-PARTY-25 push adds handout, party_item, loot_entry.qty: indexes, no data loss", async () => {
    const db = await oldDb();
    const { applied } = await pushSchema(db);
    expect(applied).toBeGreaterThan(0);
    expect(columns(db, "handout")).toEqual(
      expect.arrayContaining([
        "id",
        "campaign_id",
        "seq",
        "title",
        "body",
        "image_asset_ids",
        "shared_with",
        "rev",
        "body_rev",
        "created_at",
        "updated_at",
        "shared_at",
      ]),
    );
    expect(columns(db, "party_item")).toEqual(
      expect.arrayContaining(["id", "campaign_id", "seq", "name", "qty", "notes"]),
    );
    expect(indexes(db, "handout")).toEqual(
      expect.arrayContaining(["handout_seq", "handout_campaign_seq"]),
    );
    expect(indexes(db, "party_item")).toEqual(
      expect.arrayContaining(["party_item_seq", "party_item_campaign_seq"]),
    );
    expect(db.query("SELECT id, text, gp, qty FROM loot_entry").all()).toEqual([
      { id: "e1", text: "Pouch", gp: 12, qty: null },
    ]);
    expect((await pushSchema(db)).applied).toBe(0);
    db.close();
  });

  test("FR-PARTY-25 loot-entry wire: `qty` only on item rows; kind item parses", () => {
    const db = openTestDb();
    db.insert(campaign)
      .values({ id: "c1", name: "C", active: true, createdAt: AT, updatedAt: AT })
      .run();
    const row = (id: string, kind: "loot" | "item", qty: number | null) =>
      db
        .insert(lootEntry)
        .values({
          id,
          campaignId: "c1",
          seq: lootEntrySeqNext,
          kind,
          fromKind: "world",
          toKind: "party",
          text: kind === "item" ? "Torch" : "Pouch",
          cp: 0,
          sp: 0,
          ep: 0,
          gp: kind === "item" ? 0 : 5,
          pp: 0,
          qty,
          createdAt: AT,
        })
        .run();
    row("e1", "loot", null);
    row("e2", "item", 10);
    const [loot, item] = db.select().from(lootEntry).all().map(toEntryRecord);
    expect(loot && "qty" in loot).toBe(false);
    expect(LootEntryRecord.parse(loot)).toEqual(loot as LootEntryRecord);
    expect(item?.qty).toBe(10);
    expect(item?.kind).toBe("item");
    expect(LootEntryRecord.parse(item)).toEqual(item as LootEntryRecord);
    for (const qty of [0, 10_000, 1.5])
      expect(LootEntryRecord.safeParse({ ...item, qty }).success).toBe(false);
    expect(LootEntryRecord.safeParse({ ...item, kind: "gift" }).success).toBe(false);
  });
});
