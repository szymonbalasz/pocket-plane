import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { closeDb } from "@server/db/client";
import { entity, eventLog, gameLogEntry, gameLogSettings } from "@server/db/schema";
import { defineBundle } from "@server/features/fixtures-adapters/fixture-types";
import { loadInProcess } from "@server/features/fixtures-adapters/loader";
import { asc } from "drizzle-orm";
import { library, loadBundle } from "../../index";

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

describe("vision-senses (CHARX / FOG §13, sprint 3)", () => {
  test("FR-CHARX-49 vision-senses patch from empty: one char.edit {senses} per character, nothing else changed (composes on character-sheet-full)", async () => {
    const lib = {
      ...library,
      bundles: [
        ...library.bundles,
        defineBundle({
          name: "senses-on-full",
          includes: ["character-sheet-full"],
          fixtures: ["vision-senses"],
        }),
      ],
    };
    const load = async (bundle: string) => {
      const r = await loadInProcess(lib, bundle);
      dirs.push(r.dir);
      const db = r.openDb();
      const out = {
        manifest: r.manifest,
        blocks: Object.fromEntries(
          db
            .select()
            .from(entity)
            .all()
            .map((e) => [e.name, e.statBlock as Record<string, unknown>]),
        ),
        log: db.select().from(eventLog).orderBy(asc(eventLog.seq)).all(),
      };
      closeDb(db);
      return out;
    };
    const before = await load("character-sheet-full");
    const after = await load("senses-on-full");
    expect(after.manifest.status).toBe("complete");
    expect(after.manifest.fixtures.at(-1)).toBe("vision-senses");
    expect(after.blocks.Mira?.senses).toEqual({
      visionFt: 30,
      darkvisionFt: 0,
      seesMagicalDarkness: false,
    });
    expect(after.blocks.Thorn?.senses).toEqual({
      visionFt: 0,
      darkvisionFt: 60,
      seesMagicalDarkness: true,
    });
    // Patch only: every other field of every creature as before (a legacy attack gains its row
    // id on any char.edit write, FR-CHARX-16).
    const noIds = ({ attacks, ...b }: Record<string, unknown>) => ({
      ...b,
      attacks: (attacks as { id?: string }[]).map(({ id: _id, ...a }) => a),
    });
    for (const [name, block] of Object.entries(after.blocks)) {
      const { senses: _s, ...rest } = block;
      expect(noIds(rest)).toEqual(noIds(before.blocks[name] as Record<string, unknown>));
    }
    const added = after.log.slice(before.log.length);
    expect(added.map((e) => [e.type, (e.payload as { fields?: string[] }).fields])).toEqual([
      ["CharacterSheetEdited", ["senses"]],
      ["CharacterSheetEdited", ["senses"]],
    ]);
  });
});
