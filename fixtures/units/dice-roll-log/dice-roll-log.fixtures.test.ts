import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { closeDb } from "@server/db/client";
import { gameLogEntry, gameLogSettings, roll } from "@server/db/schema";
import { asc } from "drizzle-orm";
import { loadBundle } from "../../index";
import { SECRET_LABEL } from "./rolls-1";

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

async function loaded() {
  const r = await loadBundle("dice-log");
  dirs.push(r.dir);
  const db = r.openDb();
  const out = {
    manifest: r.manifest,
    rolls: db.select().from(roll).all(),
    entries: db.select().from(gameLogEntry).orderBy(asc(gameLogEntry.n)).all(),
    settings: db.select().from(gameLogSettings).all(),
  };
  closeDb(db);
  return out;
}

describe("dice-roll-log fixtures (DICE §13)", () => {
  test("DICE §13 dice-log bundle: contents, settings and rolls-1 e1–e4", async () => {
    const r = await loaded();
    expect(r.manifest.fixtures).toEqual([
      "campaign",
      "player-1",
      "player-2",
      "char-mira",
      "char-thorn",
      "enemy-1",
      "dice-settings",
      "rolls-1",
    ]);
    expect(r.settings).toEqual([
      expect.objectContaining({
        attack: true,
        damage: true,
        initiative: true,
        healing: true,
        skillCheck: false,
        other: false,
      }),
    ]);
    expect(r.entries.map((e) => [e.n, e.actorName, e.category, e.public, e.rollerRole])).toEqual([
      [1, "Goblin", "attack", true, "dm"],
      [2, "Goblin", "damage", false, "dm"],
      [3, "Goblin", "skill-check", false, "dm"],
      [4, "Mira", "initiative", true, "dm"],
    ]);
    expect(r.rolls.map((x) => [x.label, x.manual, x.expression])).toEqual([
      ["Scimitar", false, "1d20+4"],
      [SECRET_LABEL, false, "1d6+2"],
      ["Perception", false, "1d20+3"],
      [null, true, "1d20+2"],
    ]);
    expect(r.rolls[3]).toMatchObject({ total: 17, natural: 15, actorKind: "entity" });
  });

  test("FR-DICE-25 FR-DICE-03 seeded per fixture key: two loads give identical rolls and entries", async () => {
    const a = await loaded();
    const b = await loaded();
    expect(b.rolls).toEqual(a.rolls);
    expect(b.entries).toEqual(a.entries);
  });
});
