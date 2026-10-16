// biome-ignore-all lint/suspicious/noThenProperty: `then` is the rule's effect field (MOD §8.4); rules are data, never awaited.
// Rule-trigger tables and columns (MOD §8.2, data model §27; fix/rt-core R0): drizzle push adds
// them to an old dev DB without data loss; FKs, cascades and indexes hold; stored rows parse as
// the records.
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { HpChangeRecord } from "@shared/combat-tracker/schemas";
import { EffectPresetRecord } from "@shared/effect-modifiers/schemas";
import { RuleTriggerRecord } from "@shared/effect-modifiers/trigger-records";
import type { TriggerRule } from "@shared/effect-modifiers/triggers";
import { eq } from "drizzle-orm";
import { createSchema, pushSchema } from "./push";
import {
  campaign,
  combatant,
  combatantSeqNext,
  effectPreset,
  effectPresetSeqNext,
  encounter,
  encounterSeqNext,
  entity,
  player,
  ruleTrigger,
  ruleTriggerSeqNext,
  triggerUse,
  triggerUseSeqNext,
} from "./schema";
import { openTestDb } from "./testing";

const AT = "2026-01-01T00:00:00.000Z";
const bless = { kind: "dice", on: { roll: "attack" }, dice: "1d4", sign: 1 } as const;
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

/** Today's schema minus R0's tables and columns, one preset and one hp_change-free campaign. */
async function oldDb(): Promise<Database> {
  const db = new Database(":memory:", { strict: true });
  await createSchema(db);
  db.run("DROP TABLE trigger_use");
  db.run("DROP TABLE rule_trigger");
  db.run("ALTER TABLE effect_preset DROP COLUMN origin_key");
  db.run("ALTER TABLE hp_change DROP COLUMN trigger_parts");
  db.run("PRAGMA foreign_keys = ON");
  const ins = (sql: string, ...v: (string | number | null)[]) => db.query(sql).run(...v);
  ins(
    "INSERT INTO campaign (id, name, active, created_at, updated_at) VALUES ('c1', 'C', 1, ?, ?)",
    AT,
    AT,
  );
  ins(
    "INSERT INTO effect_preset (id, campaign_id, seq, name, modifiers, created_at, updated_at) VALUES ('pr1', 'c1', 1, 'Rage', ?, ?, ?)",
    JSON.stringify([bless]),
    AT,
    AT,
  );
  return db;
}

describe("rule-trigger schema (MOD §8.2, R0)", () => {
  test("MOD §14.1 push adds rule_trigger, trigger_use, effect_preset.origin_key, hp_change.trigger_parts: defaults, no data loss", async () => {
    const db = await oldDb();
    const { applied } = await pushSchema(db);
    expect(applied).toBeGreaterThan(0);
    expect(columns(db, "rule_trigger")).toEqual(
      expect.arrayContaining(["character_id", "definition_id", "owner_player_id", "rule"]),
    );
    expect(columns(db, "trigger_use")).toEqual(
      expect.arrayContaining(["trigger_id", "owner_combatant_id", "window", "state", "forced"]),
    );
    expect(indexes(db, "rule_trigger")).toEqual(
      expect.arrayContaining(["rule_trigger_character", "rule_trigger_definition"]),
    );
    expect(indexes(db, "trigger_use")).toEqual(
      expect.arrayContaining(["trigger_use_charge", "trigger_use_card", "trigger_use_hp_change"]),
    );
    expect(db.query("SELECT name, origin_key FROM effect_preset").get()).toEqual({
      name: "Rage",
      origin_key: null,
    });
    expect(columns(db, "hp_change")).toContain("trigger_parts");
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
    const ent = (id: string, kind: "character" | "monster", campaignId: string | null) =>
      db
        .insert(entity)
        .values({ id, kind, campaignId, name: id, statBlock: {}, createdAt: AT, updatedAt: AT })
        .run();
    ent("brakka", "character", "c1");
    ent("troll", "monster", "c1");
    ent("srd-goblin", "monster", null);
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
    let n = 0;
    const trigger = (v: Partial<typeof ruleTrigger.$inferInsert> = {}) => {
      const id = v.id ?? `trg${++n}`;
      db.insert(ruleTrigger)
        .values({
          id,
          campaignId: "c1",
          seq: ruleTriggerSeqNext,
          characterId: "brakka",
          ownerPlayerId: "p1",
          name: "Divine Fury",
          public: true,
          rule: fury,
          updatedAt: AT,
          ...v,
        })
        .run();
      return id;
    };
    const use = (triggerId: string, v: Partial<typeof triggerUse.$inferInsert> = {}) => {
      const id = v.id ?? `use${++n}`;
      db.insert(triggerUse)
        .values({
          id,
          campaignId: "c1",
          encounterId: "enc",
          seq: triggerUseSeqNext,
          triggerId,
          ownerCombatantId: "k-brakka",
          window: "t:1:k-brakka",
          state: "offered",
          cardId: "card-1",
          rollId: "roll-1",
          part: 0,
          createdAt: AT,
          updatedAt: AT,
          ...v,
        })
        .run();
      return id;
    };
    return { db, trigger, use };
  }

  test("FR-MOD-32 a stored trigger parses as the `rule-trigger` record (enabled default, seq by the DB)", () => {
    const { db, trigger } = seed();
    const id = trigger();
    const row = db.select().from(ruleTrigger).where(eq(ruleTrigger.id, id)).get();
    expect(row).toMatchObject({ seq: 1, enabled: true, definitionId: null, rule: fury });
    expect(RuleTriggerRecord.parse(row)).toEqual(row as RuleTriggerRecord);
    // Definition triggers: imported (global) and custom definitions alike.
    trigger({ characterId: null, ownerPlayerId: null, definitionId: "srd-goblin", public: false });
    trigger({ characterId: null, ownerPlayerId: null, definitionId: "troll", public: false });
    expect(RuleTriggerRecord.safeParse({ ...row, definitionId: "troll" }).success).toBe(false);
    expect(RuleTriggerRecord.safeParse({ ...row, characterId: null }).success).toBe(false);
  });

  test("MOD §8.2 relations: owner deletes cascade to triggers, a trigger's delete to its uses; unknown FKs refused", () => {
    const { db, trigger, use } = seed();
    const own = trigger();
    const mon = trigger({ characterId: null, ownerPlayerId: null, definitionId: "troll" });
    const u1 = use(own);
    use(own, {
      state: "used",
      targetId: "k-goblin",
      hpChangeId: "hp-1",
      value: 6,
      multiplier: "normal",
    });
    expect(() => trigger({ characterId: "nope" })).toThrow(/FOREIGN KEY/);
    expect(() => use("nope")).toThrow(/FOREIGN KEY/);
    expect(() => use(own, { ownerCombatantId: "nope" })).toThrow(/FOREIGN KEY/);
    expect(() => use(own, { encounterId: "nope" })).toThrow(/FOREIGN KEY/);
    db.delete(ruleTrigger).where(eq(ruleTrigger.id, own)).run();
    expect(db.select().from(triggerUse).all()).toEqual([]);
    expect(u1).toBeTruthy();
    db.delete(entity).where(eq(entity.id, "troll")).run();
    expect(db.select().from(ruleTrigger).where(eq(ruleTrigger.id, mon)).get()).toBeUndefined();
  });

  test("FR-MOD-36 effect_preset.origin_key round-trips; FR-MOD-48 hp_change.trigger_parts defaults to []", () => {
    const { db } = seed();
    db.insert(effectPreset)
      .values({
        id: "pr-rage",
        campaignId: "c1",
        seq: effectPresetSeqNext,
        characterId: "brakka",
        ownerPlayerId: "p1",
        name: "Rage",
        modifiers: [bless],
        originKey: "rage",
        createdAt: AT,
        updatedAt: AT,
      })
      .run();
    const row = db.select().from(effectPreset).where(eq(effectPreset.id, "pr-rage")).get();
    expect(EffectPresetRecord.parse(row).originKey).toBe("rage");
    expect(
      EffectPresetRecord.safeParse({
        ...row,
        characterId: null,
        ownerPlayerId: null,
        activeEffectId: null,
        key: "rage",
      }).success,
    ).toBe(false);
    expect(HpChangeRecord.shape.triggerParts.parse([])).toEqual([]);
  });
});
