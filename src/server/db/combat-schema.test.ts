// Combat tables (data model §14–§18): shared definitions from fix/combat-core. The owning
// features test their commands; this file checks the DB-enforced constraints of §18.
import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
  campaign,
  combatant,
  combatantSeqNext,
  encounter,
  encounterEntry,
  encounterEntrySeqNext,
  encounterSeqNext,
  entity,
  gameLogEntry,
  gameLogSettings,
  hpChange,
  hpChangeSeqNext,
  notification,
  notificationSeqNext,
  roll,
} from "./schema";
import { openTestDb } from "./testing";

const AT = "2026-01-01T00:00:00.000Z";

function seed() {
  const db = openTestDb();
  for (const id of ["c1", "c2"]) {
    db.insert(campaign)
      .values({ id, name: id, active: id === "c1", createdAt: AT, updatedAt: AT })
      .run();
  }
  db.insert(entity)
    .values({
      id: "goblin",
      kind: "monster",
      campaignId: "c1",
      name: "Goblin",
      statBlock: {},
      createdAt: AT,
      updatedAt: AT,
    })
    .run();
  const enc = (id: string, campaignId: string, status: "planned" | "started" | "ended") =>
    db
      .insert(encounter)
      .values({
        id,
        campaignId,
        seq: encounterSeqNext,
        name: id,
        status,
        createdAt: AT,
        updatedAt: AT,
      })
      .run();
  return { db, enc };
}

test("data model §18: ≤ 1 started encounter per campaign; seq assigned by the DB (CON-20)", () => {
  const { db, enc } = seed();
  enc("e1", "c1", "started");
  enc("e2", "c1", "planned");
  enc("e3", "c2", "started");
  expect(() => enc("e4", "c1", "started")).toThrow(/UNIQUE/);
  const seqs = db.select({ id: encounter.id, seq: encounter.seq }).from(encounter).all();
  expect(seqs).toEqual([
    { id: "e1", seq: 1 },
    { id: "e2", seq: 2 },
    { id: "e3", seq: 3 },
  ]);
});

test("data model §18: encounter entries cascade with their encounter", () => {
  const { db, enc } = seed();
  enc("e1", "c1", "planned");
  db.insert(encounterEntry)
    .values({
      id: "x",
      encounterId: "e1",
      seq: encounterEntrySeqNext,
      definitionId: "goblin",
      quantity: 3,
    })
    .run();
  db.delete(encounter).where(eq(encounter.id, "e1")).run();
  expect(db.select().from(encounterEntry).all()).toEqual([]);
});

test("data model §15/§17: game log (campaignId, n) unique; combat rows link roll, entry, card, combatant", () => {
  const { db, enc } = seed();
  enc("e1", "c1", "started");
  db.insert(roll)
    .values({
      id: "r1",
      campaignId: "c1",
      at: AT,
      rollerRole: "dm",
      actorKind: "dm",
      actorName: "DM",
      category: "attack",
      source: "cbt",
      expression: "1d20+4",
      mode: "normal",
      manual: false,
      dice: [{ faces: 20, value: 12, kept: true }],
      constant: 4,
      total: 16,
      natural: 12,
    })
    .run();
  const entry = (id: string, n: number, campaignId = "c1") =>
    db
      .insert(gameLogEntry)
      .values({
        id,
        campaignId,
        n,
        at: AT,
        kind: "cbt.attack",
        category: "attack",
        public: true,
        rollerRole: "dm",
        actorName: "Goblin",
        payload: {},
        rollIds: ["r1"],
        encounterId: "e1",
      })
      .run();
  entry("g1", 1);
  entry("g2", 1, "c2");
  expect(() => entry("g3", 1)).toThrow(/UNIQUE/);
  db.insert(notification)
    .values({
      id: "card",
      campaignId: "c1",
      seq: notificationSeqNext,
      kind: "damage-card",
      audience: "dm",
      text: "Goblin: 16 to hit",
      payload: {},
      actionLabel: "Apply",
      actionRole: "dm",
      state: "pending",
      createdAt: AT,
      updatedAt: AT,
    })
    .run();
  db.insert(combatant)
    .values({
      id: "k1",
      campaignId: "c1",
      encounterId: "e1",
      seq: combatantSeqNext,
      kind: "monster",
      entityId: "goblin",
      name: "Goblin 1",
      position: 1,
      playerPosition: 1,
      hpCurrent: 7,
      hpMax: 7,
    })
    .run();
  db.insert(hpChange)
    .values({
      id: "h1",
      campaignId: "c1",
      encounterId: "e1",
      seq: hpChangeSeqNext,
      at: AT,
      kind: "damage",
      source: "card",
      cardId: "card",
      rollIds: ["r1"],
      targetId: "k1",
      targetEntityId: "goblin",
      targetName: "Goblin 1",
      targetAc: 15,
      damageTotal: 5,
      multiplier: "normal",
      hit: true,
      raw: 5,
      applied: 5,
      overkill: 0,
      hpBefore: 7,
      hpAfter: 2,
      entryId: "g1",
    })
    .run();
  const h = db.select().from(hpChange).get();
  expect(h).toMatchObject({ seq: 1, undone: false, undoneAt: null, entryId: "g1" });
  expect(db.select().from(combatant).get()).toMatchObject({
    hidden: false,
    active: true,
    removed: false,
    initiative: null,
  });
  // FKs enforced: an unknown target fails.
  expect(() =>
    db
      .insert(hpChange)
      .values({ ...(h as typeof hpChange.$inferInsert), id: "h2", seq: 2, targetId: "nope" })
      .run(),
  ).toThrow(/FOREIGN KEY/);
});

test("data model §15: public log settings, one row per campaign, all false by default", () => {
  const { db } = seed();
  db.insert(gameLogSettings).values({ id: "c1", campaignId: "c1" }).run();
  expect(db.select().from(gameLogSettings).get()).toMatchObject({
    attack: false,
    savingThrow: false,
    other: false,
  });
  expect(() => db.insert(gameLogSettings).values({ id: "x", campaignId: "c1" }).run()).toThrow(
    /UNIQUE/,
  );
});
