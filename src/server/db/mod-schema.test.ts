// effect-modifiers table and columns (MOD §8.2, data model §23): drizzle push adds them to an old
// dev DB without data loss; the per-campaign key index, the FKs and the JSON leaves hold.
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { EffectRecord } from "@shared/combat-extras/schemas";
import { EffectPresetRecord } from "@shared/effect-modifiers/schemas";
import { eq } from "drizzle-orm";
import { createSchema, pushSchema } from "./push";
import {
  campaign,
  effect,
  effectPreset,
  effectPresetSeqNext,
  effectSeqNext,
  entity,
  player,
} from "./schema";
import { openTestDb } from "./testing";

const AT = "2026-01-01T00:00:00.000Z";
const bless = { kind: "dice", on: { roll: "attack" }, dice: "1d4", sign: 1 } as const;

const columns = (db: Database, table: string) =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);

/** Today's schema minus the MOD table and columns, one effect row. */
async function oldDb(): Promise<Database> {
  const db = new Database(":memory:", { strict: true });
  await createSchema(db);
  db.run("DROP TABLE effect_preset");
  db.run("ALTER TABLE effect DROP COLUMN modifiers");
  db.run("ALTER TABLE effect DROP COLUMN preset_key");
  db.run("PRAGMA foreign_keys = ON");
  const ins = (sql: string, ...v: (string | number | null)[]) => db.query(sql).run(...v);
  ins(
    "INSERT INTO campaign (id, name, active, created_at, updated_at) VALUES ('c1', 'C', 1, ?, ?)",
    AT,
    AT,
  );
  ins(
    "INSERT INTO entity (id, kind, campaign_id, name, stat_block, created_at, updated_at) VALUES ('mira', 'character', 'c1', 'Mira', '{}', ?, ?)",
    AT,
    AT,
  );
  ins(
    "INSERT INTO effect (id, campaign_id, seq, kind, label, target_character_id, created_at, updated_at) VALUES ('fx1', 'c1', 1, 'custom', 'Bless', 'mira', ?, ?)",
    AT,
    AT,
  );
  return db;
}

describe("effect-modifiers schema (MOD §8.2)", () => {
  test("MOD §14.1 push adds effect.modifiers / preset_key and effect_preset: defaults, no data loss", async () => {
    const db = await oldDb();
    const { applied } = await pushSchema(db);
    expect(applied).toBeGreaterThan(0);
    expect(columns(db, "effect")).toEqual(expect.arrayContaining(["modifiers", "preset_key"]));
    expect(columns(db, "effect_preset")).toEqual(
      expect.arrayContaining(["key", "character_id", "active_effect_id", "uses_feature_id"]),
    );
    expect(db.query("SELECT label, modifiers, preset_key FROM effect").get()).toEqual({
      label: "Bless",
      modifiers: "[]",
      preset_key: null,
    });
    // Idempotent: a second boot changes nothing.
    expect((await pushSchema(db)).applied).toBe(0);
    db.close();
  });

  function seed() {
    const db = openTestDb();
    for (const id of ["c1", "c2"]) {
      db.insert(campaign)
        .values({ id, name: id, active: id === "c1", createdAt: AT, updatedAt: AT })
        .run();
    }
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
        id: "thorn",
        kind: "character",
        campaignId: "c1",
        name: "Thorn",
        statBlock: {},
        ownerPlayerId: "p1",
        createdAt: AT,
        updatedAt: AT,
      })
      .run();
    let n = 0;
    const preset = (v: Partial<typeof effectPreset.$inferInsert>) => {
      const id = v.id ?? `pr${++n}`;
      db.insert(effectPreset)
        .values({
          id,
          campaignId: "c1",
          seq: effectPresetSeqNext,
          name: "Bless",
          modifiers: [bless],
          createdAt: AT,
          updatedAt: AT,
          ...v,
        })
        .run();
      return id;
    };
    const fx = (v: Partial<typeof effect.$inferInsert> = {}) => {
      const id = v.id ?? `fx${++n}`;
      db.insert(effect)
        .values({
          id,
          campaignId: "c1",
          seq: effectSeqNext,
          kind: "custom",
          label: "Rage",
          targetCharacterId: "thorn",
          createdAt: AT,
          updatedAt: AT,
          ...v,
        })
        .run();
      return id;
    };
    return { db, preset, fx };
  }

  test("MOD §8.3 unique (campaign, key) where key set; other campaigns and null keys free", () => {
    const { preset } = seed();
    preset({ key: "bless" });
    expect(() => preset({ key: "bless" })).toThrow(/UNIQUE/);
    preset({ key: "bless", campaignId: "c2" });
    preset({ key: "bane" });
    preset({});
    preset({});
  });

  test("MOD §8.3 FKs: activeEffectId set null on effect delete; characterId cascades; unknowns refused", () => {
    const { db, preset, fx } = seed();
    const effectId = fx();
    const id = preset({ characterId: "thorn", ownerPlayerId: "p1", activeEffectId: effectId });
    db.delete(effect).where(eq(effect.id, effectId)).run();
    expect(
      db.select().from(effectPreset).where(eq(effectPreset.id, id)).get()?.activeEffectId,
    ).toBe(null);
    expect(() => preset({ characterId: "nope" })).toThrow(/FOREIGN KEY/);
    expect(() => preset({ activeEffectId: "nope" })).toThrow(/FOREIGN KEY/);
    db.delete(entity).where(eq(entity.id, "thorn")).run();
    expect(db.select().from(effectPreset).where(eq(effectPreset.id, id)).get()).toBeUndefined();
  });

  test("FR-MOD-03 effect rows: modifiers JSON leaf default []; stored row round-trips as the record", () => {
    const { db, fx } = seed();
    const plain = fx({ id: "plain" });
    const rage = { kind: "flat", on: { roll: "damage", via: "weapon" }, value: 2 } as const;
    fx({ id: "raging", modifiers: [rage], presetKey: "rage" });
    const read = (id: string) => db.select().from(effect).where(eq(effect.id, id)).get();
    expect(read(plain)).toMatchObject({ modifiers: [], presetKey: null });
    expect(read("raging")).toMatchObject({ modifiers: [rage], presetKey: "rage" });
    const rec = EffectRecord.parse(read("raging"));
    expect(EffectRecord.parse(JSON.parse(JSON.stringify(rec)))).toEqual(rec);
  });

  test("MOD §8.2 a stored preset row parses as the `effect-preset` record (defaults, seq by the DB)", () => {
    const { db, preset } = seed();
    const id = preset({ key: "bless", durationRounds: 10, concentration: true });
    const row = db.select().from(effectPreset).where(eq(effectPreset.id, id)).get();
    expect(row).toMatchObject({ seq: 1, note: "", usesFeatureId: null, activeEffectId: null });
    expect(EffectPresetRecord.parse(row)).toEqual(row as EffectPresetRecord);
  });
});
