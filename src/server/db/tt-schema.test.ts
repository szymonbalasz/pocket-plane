// Sprint 8 schema (table tools TT0, data model): drizzle push adds `roll_macro`, `roll_request`,
// `asset.kind` / `asset.duration_ms` and `campaign.pause` / `campaign.alert_sounds` to an old dev DB
// without data loss (old assets = images, old campaigns running with no picks); FKs hold.
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createSchema, pushSchema } from "./push";
import { asset, campaign, player, rollMacro, rollRequest } from "./schema";
import { openTestDb } from "./testing";

const AT = "2026-01-01T00:00:00.000Z";

const columns = (db: Database, table: string) =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);

describe("table-tools schema (DICEX §8, ASSET §8, CAMP §8; sprint 8)", () => {
  test("FR-DICEX-64 FR-DICEX-73 FR-ASSET-54 FR-CAMP-46 push adds the tables and columns: no data loss", async () => {
    const db = new Database(":memory:", { strict: true });
    await createSchema(db);
    db.run("DROP TABLE roll_macro");
    db.run("DROP TABLE roll_request");
    db.run("ALTER TABLE asset DROP COLUMN kind");
    db.run("ALTER TABLE asset DROP COLUMN duration_ms");
    db.run("ALTER TABLE campaign DROP COLUMN pause");
    db.run("ALTER TABLE campaign DROP COLUMN alert_sounds");
    db.run("PRAGMA foreign_keys = ON");
    db.query(
      "INSERT INTO campaign (id, name, active, created_at, updated_at) VALUES ('c1', 'C', 1, ?, ?)",
    ).run(AT, AT);
    db.query(
      `INSERT INTO asset (id, campaign_id, seq, name, hash, mime, bytes, width, height,
        display_width, display_height, created_at) VALUES ('a1', 'c1', 1, 'Map', 'h', 'image/webp',
        1, 1, 1, 1, 1, ?)`,
    ).run(AT);
    const { applied } = await pushSchema(db);
    expect(applied).toBeGreaterThan(0);
    expect(columns(db, "roll_macro")).toEqual([
      "id",
      "campaign_id",
      "player_id",
      "creature_id",
      "name",
      "expression",
      "category",
      "sort_order",
      "created_by",
      "updated_at",
    ]);
    expect(columns(db, "roll_request")).toEqual([
      "id",
      "campaign_id",
      "seq",
      "roll",
      "label",
      "dc",
      "dc_shown",
      "mode",
      "results",
      "state",
      "targets",
      "created_at",
      "closed_at",
    ]);
    expect(db.query("SELECT pause, alert_sounds FROM campaign").get()).toEqual({
      pause: null,
      alert_sounds: "{}",
    });
    expect(db.query("SELECT kind, duration_ms FROM asset").get()).toEqual({
      kind: "image",
      duration_ms: null,
    });
    expect((await pushSchema(db)).applied).toBe(0);
    db.close();
  });

  test("FR-DICEX-64 FR-DICEX-73 rows: JSON leaves round-trip; unknown campaign / player refused; seq unique", () => {
    const db = openTestDb();
    db.insert(campaign)
      .values({ id: "c1", name: "C", active: true, createdAt: AT, updatedAt: AT })
      .run();
    expect(db.select({ p: campaign.pause, s: campaign.alertSounds }).from(campaign).get()).toEqual({
      p: null,
      s: {},
    });
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
    const macro = {
      id: "m1",
      campaignId: "c1",
      playerId: "p1",
      creatureId: "gone-creature",
      name: "Luck",
      expression: "1d100",
      category: "other" as const,
      order: 0,
      createdBy: "p1",
      updatedAt: AT,
    };
    db.insert(rollMacro).values(macro).run();
    expect(db.select().from(rollMacro).where(eq(rollMacro.id, "m1")).get()).toEqual(macro);
    expect(() =>
      db
        .insert(rollMacro)
        .values({ ...macro, id: "m2", playerId: "nope" })
        .run(),
    ).toThrow();
    expect(() =>
      db
        .insert(rollMacro)
        .values({ ...macro, id: "m3", campaignId: "nope" })
        .run(),
    ).toThrow();
    const req = {
      id: "r1",
      campaignId: "c1",
      seq: 1,
      roll: { kind: "save" as const, key: "dex" as const, expression: null },
      label: "DEX save",
      dc: 15,
      dcShown: true,
      mode: "advantage" as const,
      results: "hidden" as const,
      state: "open" as const,
      targets: [
        {
          characterId: "e1",
          playerId: "p1",
          name: "Mira",
          notificationId: "n1",
          state: "open" as const,
          entryId: null,
          total: null,
          natural: null,
          success: null,
          at: null,
        },
      ],
      createdAt: AT,
      closedAt: null,
    };
    db.insert(rollRequest).values(req).run();
    expect(db.select().from(rollRequest).where(eq(rollRequest.id, "r1")).get()).toEqual(req);
    expect(() =>
      db
        .insert(rollRequest)
        .values({ ...req, id: "r2" })
        .run(),
    ).toThrow();
    db.insert(asset)
      .values({
        id: "a1",
        campaignId: "c1",
        seq: 1,
        name: "Chime",
        hash: "h",
        mime: "audio/wav",
        bytes: 1,
        width: 0,
        height: 0,
        displayWidth: 0,
        displayHeight: 0,
        createdAt: AT,
        kind: "audio",
        durationMs: 400,
      })
      .run();
    expect(db.select({ k: asset.kind, d: asset.durationMs }).from(asset).get()).toEqual({
      k: "audio",
      d: 400,
    });
  });
});
