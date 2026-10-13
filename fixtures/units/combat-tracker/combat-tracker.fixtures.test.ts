import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { closeDb } from "@server/db/client";
import {
  combatant,
  encounter,
  encounterEntry,
  entity,
  hpChange,
  notification,
} from "@server/db/schema";
import { asc, eq } from "drizzle-orm";
import { loadBundle } from "../../index";

const dirs: string[] = [];
afterAll(() => {
  Bun.gc(true);
  for (const d of dirs) {
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // Windows: a closed SQLite handle can linger until GC; a leftover OS temp dir is harmless.
    }
  }
});

async function loaded(bundle: string) {
  const r = await loadBundle(bundle);
  dirs.push(r.dir);
  const db = r.openDb();
  const out = {
    manifest: r.manifest,
    mira: db.select().from(entity).where(eq(entity.name, "Mira")).get(),
    hpChanges: db.select().from(hpChange).all(),
    // Damage cards only: session-sim also carries `loot-1`'s loot-received notifications.
    cards: db
      .select()
      .from(notification)
      .where(eq(notification.kind, "damage-card"))
      .orderBy(asc(notification.seq))
      .all(),
    encounters: db.select().from(encounter).orderBy(asc(encounter.seq)).all(),
    entries: db.select().from(encounterEntry).orderBy(asc(encounterEntry.seq)).all(),
    combatants: db.select().from(combatant).orderBy(asc(combatant.position)).all(),
  };
  closeDb(db);
  return out;
}

describe("combat-tracker fixtures (CBT §13)", () => {
  test("CBT §13 combat bundle loads from empty: planned encounter-1, party null", async () => {
    const r = await loaded("combat");
    expect(r.manifest.fixtures).toEqual([
      "campaign",
      "player-1",
      "images",
      "enemy-1",
      "enemy-2",
      "enemy-custom",
      "char-mira",
      "town",
      "battlemap",
      "dice-settings",
      "encounter-1",
      "goblin-2",
      "loot-1",
      "player-2",
      "char-thorn",
      "loot-wallets",
      "thorn-battlemap",
    ]);
    expect(r.encounters).toEqual([
      expect.objectContaining({
        name: "Ambush at the Ford",
        status: "planned",
        partyCharacterIds: null,
      }),
    ]);
    expect(r.entries.map((e) => e.quantity)).toEqual([2, 1, 1]);
    expect(r.combatants).toEqual([]);
  });

  test("CBT §13 mid-combat: combat-1 order, round 1, Wolf's turn; combat-hit Mira 6/12; Elite card pending", async () => {
    const r = await loaded("mid-combat");
    expect(r.mira?.hpCurrent).toBe(6);
    expect(r.hpChanges).toEqual([
      expect.objectContaining({
        targetName: "Mira",
        attackerName: "Goblin",
        toHitTotal: 19,
        damageTotal: 6,
        applied: 6,
        hpAfter: 6,
      }),
    ]);
    expect(r.cards.map((c) => [c.text, c.state, c.audience])).toEqual([
      ["Goblin: 19 to hit, 6 slashing", "resolved", "dm"],
      ["Elite Goblin Warrior: 24 to hit, 8 slashing", "pending", "dm"],
    ]);
    expect(r.combatants.map((c) => [c.name, c.initiative, c.playerPosition])).toEqual([
      ["Wolf", 18, null],
      ["Mira", 15, 1],
      ["Goblin", 12, 2],
      ["Goblin 2", 12, 3],
      ["Thorn", 10, 4],
      ["Elite Goblin Warrior", 8, null],
    ]);
    const enc = r.encounters[0];
    expect(enc).toMatchObject({ status: "started", round: 1, playerTurnCombatantId: null });
    expect(enc?.turnCombatantId).toBe(r.combatants[0]?.id as string);
  });
});
