// biome-ignore-all lint/suspicious/noThenProperty: `then` is the rule's effect field (MOD §8.4); rules are data, never awaited.
// Sprint-4 rules tables and columns (MOD §8.2, CBT §8, data model §27; fix/rules4-core S4-0):
// drizzle push adds `trigger_state` and `hp_change.damage_parts` to an old dev DB without data
// loss; the unique owner index, FKs and the trigger cascade hold; stored rows parse as records.
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { HpChangeRecord } from "@shared/combat-tracker/schemas";
import { TriggerStateRecord } from "@shared/effect-modifiers/trigger-state";
import type { TriggerRule } from "@shared/effect-modifiers/triggers";
import { eq } from "drizzle-orm";
import { createSchema, pushSchema } from "./push";
import {
  campaign,
  combatant,
  combatantSeqNext,
  encounter,
  encounterSeqNext,
  entity,
  player,
  ruleTrigger,
  ruleTriggerSeqNext,
  triggerState,
} from "./schema";
import { openTestDb } from "./testing";

const AT = "2026-01-01T00:00:00.000Z";
const fury: TriggerRule = {
  on: "hit",
  requires: { preset: "rage" },
  when: [{ if: "via", via: "weapon" }, { if: "ownTurn" }],
  every: "turn",
  then: { do: "damage", formula: "1d6 + floor(level(barbarian) / 2)", type: "radiant" },
};

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

describe("sprint-4 rules schema (MOD §8.2, CBT §8, S4-0)", () => {
  test("MOD §14.3 push adds trigger_state and hp_change.damage_parts (null), no data loss", async () => {
    const db = new Database(":memory:", { strict: true });
    await createSchema(db);
    db.run("DROP TABLE trigger_state");
    db.run("ALTER TABLE hp_change DROP COLUMN damage_parts");
    db.query(
      "INSERT INTO campaign (id, name, active, created_at, updated_at) VALUES ('c1', 'Kept', 1, ?, ?)",
    ).run(AT, AT);
    const { applied } = await pushSchema(db);
    expect(applied).toBeGreaterThan(0);
    expect(columns(db, "trigger_state")).toEqual(
      expect.arrayContaining([
        "encounter_id",
        "combatant_id",
        "trigger_id",
        "character_id",
        "owner_player_id",
        "on",
        "armed",
        "charge",
        "feature_id",
      ]),
    );
    expect(indexes(db, "trigger_state")).toEqual(
      expect.arrayContaining(["trigger_state_owner", "trigger_state_campaign"]),
    );
    expect(columns(db, "hp_change")).toContain("damage_parts");
    expect(db.query("SELECT name FROM campaign").get()).toEqual({ name: "Kept" });
    expect((await pushSchema(db)).applied).toBe(0);
    db.close();
  });

  function seed() {
    const db = openTestDb();
    db.insert(campaign)
      .values({ id: "c1", name: "C", active: true, createdAt: AT, updatedAt: AT })
      .run();
    db.insert(player)
      .values({
        id: "p1",
        campaignId: "c1",
        name: "P1",
        linkToken: "t",
        createdAt: AT,
        updatedAt: AT,
      })
      .run();
    db.insert(entity)
      .values({
        id: "brakka",
        kind: "character",
        campaignId: "c1",
        name: "Brakka",
        statBlock: {},
        createdAt: AT,
        updatedAt: AT,
      })
      .run();
    db.insert(encounter)
      .values({
        id: "enc",
        campaignId: "c1",
        seq: encounterSeqNext,
        name: "E",
        status: "started",
        createdAt: AT,
        updatedAt: AT,
      })
      .run();
    db.insert(combatant)
      .values({
        id: "k-brakka",
        campaignId: "c1",
        encounterId: "enc",
        seq: combatantSeqNext,
        kind: "pc",
        entityId: "brakka",
        name: "Brakka",
        position: 1,
      })
      .run();
    db.insert(ruleTrigger)
      .values({
        id: "trg",
        campaignId: "c1",
        seq: ruleTriggerSeqNext,
        characterId: "brakka",
        ownerPlayerId: "p1",
        name: "Divine Fury",
        public: true,
        rule: fury,
        updatedAt: AT,
      })
      .run();
    const state = (v: Partial<typeof triggerState.$inferInsert> = {}) =>
      db
        .insert(triggerState)
        .values({
          id: "ts1",
          campaignId: "c1",
          encounterId: "enc",
          combatantId: "k-brakka",
          triggerId: "trg",
          characterId: "brakka",
          ownerPlayerId: "p1",
          name: "Divine Fury",
          on: "hit",
          armed: false,
          charge: "waiting",
          updatedAt: AT,
          ...v,
        })
        .run();
    return { db, state };
  }

  test("FR-MOD-53 a stored row parses as the `trigger-state` record; one row per (encounter, combatant, trigger)", () => {
    const { db, state } = seed();
    state();
    const row = db.select().from(triggerState).where(eq(triggerState.id, "ts1")).get();
    expect(row).toMatchObject({ armed: false, charge: "waiting", featureId: null });
    expect(TriggerStateRecord.parse(row)).toEqual(row as TriggerStateRecord);
    expect(() => state({ id: "ts2" })).toThrow(/UNIQUE/);
    for (const charge of ["ready", "used", "waiting"]) {
      expect(TriggerStateRecord.safeParse({ ...row, charge }).success).toBe(true);
    }
    expect(TriggerStateRecord.safeParse({ ...row, charge: "spent" }).success).toBe(false);
    // A monster row carries no owner copies.
    expect(TriggerStateRecord.safeParse({ ...row, characterId: null }).success).toBe(false);
    expect(
      TriggerStateRecord.safeParse({ ...row, characterId: null, ownerPlayerId: null }).success,
    ).toBe(true);
  });

  test("MOD §8.2 relations: a trigger's delete cascades to its state rows; unknown FKs refused", () => {
    const { db, state } = seed();
    state();
    expect(() => state({ id: "x1", triggerId: "nope" })).toThrow(/FOREIGN KEY/);
    expect(() => state({ id: "x2", combatantId: "nope" })).toThrow(/FOREIGN KEY/);
    expect(() => state({ id: "x3", encounterId: "nope" })).toThrow(/FOREIGN KEY/);
    db.delete(ruleTrigger).where(eq(ruleTrigger.id, "trg")).run();
    expect(db.select().from(triggerState).all()).toEqual([]);
  });

  test("FR-CBT-84 hp_change.damage_parts: null = none; ≤ 2 typed parts", () => {
    const parts = HpChangeRecord.shape.damageParts;
    expect(parts.parse(null)).toBeNull();
    const fire = { type: "fire", rolled: 8, total: 8, multiplier: "half", raw: 4 };
    expect(parts.parse([fire]) as unknown).toEqual([fire]);
    expect(parts.safeParse([]).success).toBe(false);
    expect(parts.safeParse([fire, fire, fire]).success).toBe(false);
    expect(parts.safeParse([{ ...fire, type: null }]).success).toBe(false);
  });
});
