import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { closeDb } from "@server/db/client";
import { combatant, encounter, encounterEntry } from "@server/db/schema";
import { asc } from "drizzle-orm";
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
      "player-2",
      "char-thorn",
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

  test("CBT §13 mid-combat: combat-1 order, round 1, Wolf's turn (hidden → no player marker)", async () => {
    const r = await loaded("mid-combat");
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
