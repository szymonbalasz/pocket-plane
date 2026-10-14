// combat-extras tables and columns (CBTX §8, data model §21): drizzle push adds them to an old
// dev DB without data loss; the partial unique indexes, the one-target check and the FKs hold.
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { EffectRecord } from "@shared/combat-extras/schemas";
import { eq } from "drizzle-orm";
import { createSchema, pushSchema } from "./push";
import {
  campaign,
  combatant,
  combatantSeqNext,
  effect,
  effectSeqNext,
  encounter,
  encounterSeqNext,
  entity,
  gameLogEntry,
  hpChange,
  hpChangeSeqNext,
  player,
} from "./schema";
import { openTestDb } from "./testing";

const AT = "2026-01-01T00:00:00.000Z";

/** Columns added by fix/cbtx-core: table → column. */
const CBTX_COLUMNS: [string, string][] = [
  ["combatant", "temp_hp"],
  ["entity", "temp_hp"],
  ["entity", "death_successes"],
  ["entity", "death_failures"],
  ["hp_change", "temp_before"],
  ["hp_change", "temp_after"],
  ["hp_change", "death_before"],
  ["hp_change", "death_after"],
  ["hp_change", "note_ids"],
];

const columns = (db: Database, table: string) =>
  db
    .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);

/** Today's schema minus the CBTX table and columns, one row in each touched table. */
async function oldDb(): Promise<Database> {
  const db = new Database(":memory:", { strict: true });
  await createSchema(db);
  db.run("DROP TABLE effect");
  for (const [table, col] of CBTX_COLUMNS) db.run(`ALTER TABLE ${table} DROP COLUMN ${col}`);
  db.run("PRAGMA foreign_keys = ON");
  const ins = (sql: string, ...v: (string | number | null)[]) => db.query(sql).run(...v);
  ins(
    "INSERT INTO campaign (id, name, active, created_at, updated_at) VALUES ('c1', 'C', 1, ?, ?)",
    AT,
    AT,
  );
  ins(
    "INSERT INTO player (id, campaign_id, name, link_token, created_at, updated_at) VALUES ('p1', 'c1', 'Player 1', 'tok', ?, ?)",
    AT,
    AT,
  );
  ins(
    "INSERT INTO entity (id, kind, campaign_id, name, stat_block, owner_player_id, hp_current, created_at, updated_at) VALUES ('mira', 'character', 'c1', 'Mira', '{}', 'p1', 12, ?, ?)",
    AT,
    AT,
  );
  ins(
    "INSERT INTO entity (id, kind, campaign_id, name, stat_block, created_at, updated_at) VALUES ('goblin', 'monster', 'c1', 'Goblin', '{}', ?, ?)",
    AT,
    AT,
  );
  ins(
    "INSERT INTO encounter (id, campaign_id, seq, name, status, created_at, updated_at) VALUES ('e1', 'c1', 1, 'E', 'started', ?, ?)",
    AT,
    AT,
  );
  ins(
    "INSERT INTO combatant (id, campaign_id, encounter_id, seq, kind, entity_id, name, position, hp_current, hp_max) VALUES ('k1', 'c1', 'e1', 1, 'monster', 'goblin', 'Goblin', 0, 5, 7)",
  );
  ins(
    "INSERT INTO game_log_entry (id, campaign_id, n, at, kind, category, public, roller_role, actor_name, payload, roll_ids) VALUES ('g1', 'c1', 1, ?, 'cbt.hp', 'damage', 0, 'dm', 'DM', '{}', '[]')",
    AT,
  );
  ins(
    "INSERT INTO hp_change (id, campaign_id, encounter_id, seq, at, kind, source, roll_ids, target_id, target_entity_id, target_name, target_ac, damage_total, raw, applied, overkill, hp_before, hp_after, entry_id) VALUES ('h1', 'c1', 'e1', 1, ?, 'damage', 'direct', '[]', 'k1', 'goblin', 'Goblin', 15, 2, 2, 2, 0, 7, 5, 'g1')",
    AT,
  );
  return db;
}

describe("combat-extras schema (CBTX §8)", () => {
  test("CBTX §14 push adds effect + play-state columns to an old dev DB: defaults, no data loss", async () => {
    const db = await oldDb();
    const { applied } = await pushSchema(db);
    expect(applied).toBeGreaterThan(0);
    for (const [table, col] of CBTX_COLUMNS) expect(columns(db, table)).toContain(col);
    expect(
      db
        .query(
          "SELECT name, hp_current, temp_hp, death_successes, death_failures FROM entity WHERE id = 'mira'",
        )
        .get(),
    ).toEqual({ name: "Mira", hp_current: 12, temp_hp: 0, death_successes: 0, death_failures: 0 });
    expect(db.query("SELECT hp_current, temp_hp FROM combatant").get()).toEqual({
      hp_current: 5,
      temp_hp: 0,
    });
    expect(
      db
        .query(
          "SELECT hp_after, temp_before, temp_after, death_before, death_after, note_ids FROM hp_change",
        )
        .get(),
    ).toEqual({
      hp_after: 5,
      temp_before: 0,
      temp_after: 0,
      death_before: null,
      death_after: null,
      note_ids: "[]",
    });
    expect(db.query("SELECT count(*) AS n FROM effect").get()).toEqual({ n: 0 });
    // Idempotent: a second boot changes nothing.
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
    const ent = (id: string, kind: "character" | "monster") =>
      db
        .insert(entity)
        .values({
          id,
          kind,
          campaignId: "c1",
          name: id,
          statBlock: {},
          ownerPlayerId: kind === "character" ? "p1" : null,
          hpCurrent: kind === "character" ? 12 : null,
          createdAt: AT,
          updatedAt: AT,
        })
        .run();
    ent("mira", "character");
    ent("goblin", "monster");
    db.insert(encounter)
      .values({
        id: "e1",
        campaignId: "c1",
        seq: encounterSeqNext,
        name: "E",
        status: "started",
        createdAt: AT,
        updatedAt: AT,
      })
      .run();
    for (const id of ["k1", "k2"]) {
      db.insert(combatant)
        .values({
          id,
          campaignId: "c1",
          encounterId: "e1",
          seq: combatantSeqNext,
          kind: "monster",
          entityId: "goblin",
          name: id,
          position: 0,
          hpCurrent: 7,
          hpMax: 7,
        })
        .run();
    }
    let n = 0;
    const add = (v: Partial<typeof effect.$inferInsert>) => {
      const id = v.id ?? `x${++n}`;
      db.insert(effect)
        .values({
          id,
          campaignId: "c1",
          seq: effectSeqNext,
          kind: "condition",
          condition: "prone",
          targetCombatantId: "k1",
          createdAt: AT,
          updatedAt: AT,
          ...v,
        })
        .run();
      return id;
    };
    const end = (id: string) =>
      db.update(effect).set({ endedAt: AT, endedReason: "removed" }).where(eq(effect.id, id)).run();
    return { db, add, end };
  }

  test("FR-CBTX-09 one active concentration per target (combatant and character), ended rows free the slot", () => {
    const { add, end } = seed();
    const conc = { kind: "concentration" as const, condition: null, label: "Bless" };
    const a = add({ ...conc });
    expect(() => add({ ...conc, label: "Hex" })).toThrow(/UNIQUE/);
    add({ ...conc, targetCombatantId: "k2" });
    const m = add({ ...conc, targetCombatantId: null, targetCharacterId: "mira" });
    expect(() => add({ ...conc, targetCombatantId: null, targetCharacterId: "mira" })).toThrow(
      /UNIQUE/,
    );
    end(a);
    end(m);
    add({ ...conc, label: "Hold Person" });
    add({ ...conc, targetCombatantId: null, targetCharacterId: "mira" });
  });

  test("FR-CBTX-04 one active condition per (target, key); custom effects never collide", () => {
    const { add, end } = seed();
    const prone = add({});
    expect(() => add({})).toThrow(/UNIQUE/);
    add({ condition: "poisoned" });
    add({ targetCombatantId: "k2" });
    add({ targetCombatantId: null, targetCharacterId: "mira" });
    expect(() => add({ targetCombatantId: null, targetCharacterId: "mira" })).toThrow(/UNIQUE/);
    add({ condition: "exhaustion", level: 2 });
    expect(() => add({ condition: "exhaustion", level: 3 })).toThrow(/UNIQUE/);
    for (let i = 0; i < 3; i++) add({ kind: "custom", condition: null, label: "Bless" });
    end(prone);
    add({});
  });

  test("CBTX §8 FKs enforced; concentration link set null on delete; exactly one target (zod)", () => {
    const { db, add } = seed();
    const both = add({ condition: "deafened", targetCharacterId: "mira" });
    const row = db.select().from(effect).where(eq(effect.id, both)).get();
    expect(EffectRecord.safeParse(row).success).toBe(false);
    expect(EffectRecord.safeParse({ ...row, targetCharacterId: null }).success).toBe(true);
    expect(EffectRecord.safeParse({ ...row, targetCombatantId: null }).success).toBe(true);
    expect(
      EffectRecord.safeParse({ ...row, targetCombatantId: null, targetCharacterId: null }).success,
    ).toBe(false);
    expect(() => add({ targetCombatantId: "nope" })).toThrow(/FOREIGN KEY/);
    expect(() =>
      add({ targetCombatantId: null, targetCharacterId: "nope", condition: "blinded" }),
    ).toThrow(/FOREIGN KEY/);
    const conc = add({ kind: "concentration", condition: null, label: "Bless" });
    const linked = add({
      kind: "custom",
      condition: null,
      label: "Bless",
      targetCombatantId: "k2",
      concentrationId: conc,
    });
    db.delete(effect).where(eq(effect.id, conc)).run();
    expect(db.select().from(effect).where(eq(effect.id, linked)).get()?.concentrationId).toBeNull();
  });

  test("FR-CBTX-03 a stored effect row round-trips as the `effect` record (defaults, seq by the DB)", () => {
    const { db, add } = seed();
    add({
      id: "e-1",
      kind: "custom",
      condition: null,
      label: "Marked",
      durationRounds: 3,
      endsRound: 4,
    });
    const row = db.select().from(effect).where(eq(effect.id, "e-1")).get();
    expect(row).toMatchObject({ seq: 1, secret: false, hidden: false, endedAt: null, level: null });
    const rec = EffectRecord.parse(row);
    expect(EffectRecord.parse(JSON.parse(JSON.stringify(rec)))).toEqual(rec);
  });

  test("FR-CBTX-21 hp_change: temp / death / noteIds columns hold JSON leaves; defaults 0 / null / []", () => {
    const { db } = seed();
    db.insert(gameLogEntry)
      .values({
        id: "g1",
        campaignId: "c1",
        n: 1,
        at: AT,
        kind: "cbt.hp",
        category: "damage",
        public: false,
        rollerRole: "dm",
        actorName: "DM",
        payload: {},
        rollIds: [],
      })
      .run();
    const base = {
      campaignId: "c1",
      encounterId: "e1",
      seq: hpChangeSeqNext,
      at: AT,
      kind: "damage" as const,
      source: "direct" as const,
      rollIds: [],
      targetId: "k1",
      targetEntityId: "goblin",
      targetName: "k1",
      targetAc: 15,
      damageTotal: 4,
      raw: 4,
      applied: 1,
      overkill: 0,
      hpBefore: 1,
      hpAfter: 0,
      entryId: "g1",
    };
    db.insert(hpChange)
      .values({ ...base, id: "h0" })
      .run();
    db.insert(hpChange)
      .values({
        ...base,
        id: "h1",
        tempBefore: 3,
        tempAfter: 0,
        deathBefore: { successes: 0, failures: 0 },
        deathAfter: { successes: 0, failures: 2 },
        noteIds: ["n1", "n2"],
      })
      .run();
    const [h0, h1] = db.select().from(hpChange).orderBy(hpChange.seq).all();
    expect(h0).toMatchObject({
      tempBefore: 0,
      tempAfter: 0,
      deathBefore: null,
      deathAfter: null,
      noteIds: [],
    });
    expect(h1).toMatchObject({
      tempBefore: 3,
      tempAfter: 0,
      deathBefore: { successes: 0, failures: 0 },
      deathAfter: { successes: 0, failures: 2 },
      noteIds: ["n1", "n2"],
    });
  });
});
