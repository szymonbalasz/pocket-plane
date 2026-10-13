import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { closeDb } from "@server/db/client";
import { entity, eventLog, gameLogEntry, gameLogSettings } from "@server/db/schema";
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

describe("character-sheet fixtures (CHAR §13)", () => {
  test("CHAR §13 character-sheet bundle loads from empty: Mira, Thorn 3/10, Pip without attack, speed or scores", async () => {
    const r = await loadBundle("character-sheet");
    dirs.push(r.dir);
    const db = r.openDb();
    const chars = db.select().from(entity).orderBy(asc(entity.name)).all();
    const log = db.select().from(eventLog).all();
    const entries = db.select().from(gameLogEntry).all();
    const settings = db.select().from(gameLogSettings).all();
    closeDb(db);
    expect(r.manifest.fixtures).toEqual([
      "campaign",
      "player-1",
      "player-2",
      "char-mira",
      "char-thorn",
      "char-pip",
      "char-wounds",
    ]);
    const players = r.manifest.records["player-1"]?.player ?? [];
    expect(
      chars.map((c) => [c.name, c.kind, c.hpCurrent, (c.statBlock as { hpMax: number }).hpMax]),
    ).toEqual([
      ["Mira", "character", 12, 12],
      ["Pip", "character", 8, 8],
      ["Thorn", "character", 3, 10],
    ]);
    const pip = chars.find((c) => c.name === "Pip");
    expect(pip?.ownerPlayerId).toBe(players[0] as string);
    expect(pip?.statBlock).toMatchObject({
      level: 1,
      className: "Wizard",
      ac: 12,
      initBonus: 2,
      attacks: [],
    });
    // FR-CHAR-18/19: Pip has no speed, scores or save proficiencies.
    expect(pip?.statBlock).not.toHaveProperty("speed");
    expect(pip?.statBlock).not.toHaveProperty("abilities");
    expect(pip?.statBlock).not.toHaveProperty("saveProficiencies");
    expect(log.filter((e) => e.type === "CharacterHpAdjusted")).toHaveLength(1);
    // Game-log settings at defaults (no row = all hidden); no rolls.
    expect(settings).toEqual([]);
    expect(entries).toEqual([]);
  });
});
