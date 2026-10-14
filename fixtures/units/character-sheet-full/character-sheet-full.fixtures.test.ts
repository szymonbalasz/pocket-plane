import { afterAll, describe, expect, test } from "bun:test";
import { closeDb } from "@server/db/client";
import { creatureSheet, entity, eventLog } from "@server/db/schema";
import { CreatureSheetRecord } from "@shared/character-sheet/sheet";
import { asc } from "drizzle-orm";
import { loadBundle } from "../../index";

const cleanups: (() => void)[] = [];
afterAll(() => {
  for (const c of cleanups) c();
});

async function load() {
  const r = await loadBundle("character-sheet-full", { testMode: true });
  cleanups.push(r.cleanup);
  const db = r.openDb();
  const out = {
    manifest: r.manifest,
    entities: db.select().from(entity).orderBy(asc(entity.name)).all(),
    sheets: db.select().from(creatureSheet).all(),
    log: db.select().from(eventLog).all(),
  };
  closeDb(db);
  return out;
}

describe("character-sheet-full fixtures (CHARX §13)", () => {
  test("FR-CHARX-40 bundle character-sheet-full loads from empty with the §13 contents", async () => {
    const r = await load();
    expect(r.manifest.status).toBe("complete");
    expect(r.manifest.fixtures).toEqual([
      "campaign",
      "player-1",
      "player-2",
      "char-mira",
      "char-thorn",
      "char-pip",
      "char-wounds",
      "enemy-1",
      "enemy-custom",
      "char-mira-full",
      "char-mira-locked",
      "char-sela",
      "npc-elite-sheet",
      "loot-1",
      "loot-wallets",
    ]);
    const by = (name: string) => r.entities.find((e) => e.name === name);
    const sheetOf = (name: string) =>
      CreatureSheetRecord.parse(
        r.sheets.map((s) => ({ id: s.entityId, ...s })).find((s) => s.entityId === by(name)?.id),
      );
    // Every row passes the record schema; one per creature that had a CHARX write.
    expect(r.sheets).toHaveLength(3);

    const mira = by("Mira");
    expect(mira?.statBlock).toMatchObject({
      level: 1,
      className: "Fighter",
      classes: [{ name: "Fighter", level: 1, hitDie: "d10" }],
      species: "Human",
      skills: { athletics: "proficient", perception: "proficient" },
      overrides: { "passive.perception": { value: 14, note: "Alert (test)" } },
    });
    const attacks = (mira as { statBlock: { attacks: { id?: string; name: string }[] } }).statBlock
      .attacks;
    expect(attacks.map((a) => a.name)).toEqual(["Shortsword", "Light crossbow"]);
    // FR-CHARX-16: the legacy Shortsword got an id on the first write.
    expect(attacks.every((a) => typeof a.id === "string")).toBe(true);
    const ms = sheetOf("Mira");
    expect(ms).toMatchObject({ status: "ready", locked: true, notes: "MIRA-NOTE-7" });
    expect(ms.ownerPlayerId).toBe(mira?.ownerPlayerId as string);
    expect(ms.features.map((f) => [f.name, f.usesMax ?? null, f.used, f.reset ?? null])).toEqual([
      ["Second Wind", 1, 0, "short"],
      ["Fighting Style", null, 0, null],
    ]);
    expect(ms.items.map((i) => [i.name, i.qty])).toEqual([
      ["Shortsword", 1],
      ["Light crossbow", 1],
      ["Bolts", 20],
    ]);

    const sela = by("Sela");
    expect(sela?.hpCurrent).toBe(10); // FR-CHARX-15: a draft follows its HP max.
    expect(sela?.statBlock).toMatchObject({
      className: "Cleric",
      species: "Dwarf",
      abilities: { wis: 16 },
      skills: { medicine: "proficient", insight: "proficient" },
      spellcasting: { ability: "wis", slots: { "1": 2 } },
    });
    const ss = sheetOf("Sela");
    expect(ss).toMatchObject({ status: "draft", locked: false, notes: "SELA-NOTE-3" });
    expect(ss.ownerPlayerId).toBe(by("Thorn")?.ownerPlayerId as string);
    expect(ss.spells.map((s) => [s.name, s.roll, s.effect, s.damage])).toEqual([
      ["Sacred Flame", "save", "damage", "1d8"],
      ["Guiding Bolt", "attack", "damage", "4d6"],
      ["Cure Wounds", "none", "healing", "1d8+3"],
    ]);

    const elite = by("Elite Goblin Warrior");
    expect(elite?.statBlock).toMatchObject({ skills: { stealth: "expertise" } });
    expect(
      (elite as { statBlock: { attacks: { name: string }[] } }).statBlock.attacks.map(
        (a) => a.name,
      ),
    ).toEqual(["Scimitar", "Shortbow"]);
    const es = sheetOf("Elite Goblin Warrior");
    expect(es).toMatchObject({ status: "ready", ownerPlayerId: null, notes: "NPC-NOTE-9" });
    expect(es.features.map((f) => f.name)).toEqual(["Nimble Escape"]);

    // FR-CHARX-19: every CHARX step is logged.
    const types = r.log.map((l) => l.type);
    expect(types.filter((t) => t === "CharacterCreated")).toHaveLength(1);
    expect(types.filter((t) => t === "CharacterLockSet")).toHaveLength(1);
    expect(types.filter((t) => t === "CharacterSheetEdited")).toHaveLength(14); // Mira 7, Sela 4, Elite 3
  });

  test("FR-CHARX-40 deterministic: two loads → identical entities, sheets and IDs", async () => {
    const a = await load();
    const b = await load();
    expect(b.entities).toEqual(a.entities);
    expect(b.sheets).toEqual(a.sheets);
    expect(b.manifest.records).toEqual(a.manifest.records);
  });
});
