import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { closeDb } from "@server/db/client";
import { campaign, compendiumSource, entity, token } from "@server/db/schema";
import { readEventLog } from "@server/events/log";
import { asc, sql } from "drizzle-orm";
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
  const rows = db.select().from(entity).orderBy(asc(sql`rowid`)).all();
  const campaigns = db.select().from(campaign).orderBy(asc(sql`rowid`)).all();
  const log = readEventLog(db);
  const tokens = db.select().from(token).orderBy(asc(token.seq)).all();
  const sources = db.select().from(compendiumSource).all();
  closeDb(db);
  return { ...r, rows, campaigns, log, tokens, sources };
}

describe("entities fixtures (ENT §13)", () => {
  test("FR-ENT-06 / FR-ENT-25 enemy-1 / enemy-2: SRD goblin + wolf (HP formulas), global, fixture provenance", async () => {
    const r = await loaded("entities");
    const imported = r.rows.filter((e) => e.campaignId === null);
    expect(imported.map((e) => [e.name, e.kind, e.source, e.sourceKey, e.licence])).toEqual([
      ["Goblin", "monster", "fixture", "goblin", "CC BY 4.0"],
      ["Wolf", "monster", "fixture", "wolf", "CC BY 4.0"],
    ]);
    expect(imported[0]?.attribution).toContain("System Reference Document 5.1");
    expect(imported[0]?.statBlock).toEqual({
      size: "small",
      ac: 15,
      hpMax: 7,
      hpFormula: "2d6",
      initBonus: 2,
      speed: 30,
      abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
      attacks: [{ name: "Scimitar", toHit: 4, damage: "1d6+2", damageType: "slashing" }],
      cr: "1/4",
      type: "humanoid",
    });
    expect(imported[1]?.statBlock).toEqual({
      size: "medium",
      ac: 13,
      hpMax: 11,
      hpFormula: "2d8+2",
      initBonus: 2,
      speed: 40,
      abilities: { str: 12, dex: 15, con: 12, int: 3, wis: 12, cha: 6 },
      attacks: [{ name: "Bite", toHit: 4, damage: "2d4+2", damageType: "piercing" }],
      cr: "1/4",
      type: "beast",
    });
    expect(imported.map((e) => e.tokenShape)).toEqual([null, null]);
    expect(r.manifest.records["enemy-1"]?.["imported-entity"]).toEqual([imported[0]?.id as string]);
    expect(r.manifest.records["enemy-2"]?.["imported-entity"]).toEqual([imported[1]?.id as string]);
    expect(r.log.filter((e) => e.type === "EntityImported")).toHaveLength(2);
  });

  test("ENT §13 setup fixtures: Elite (derived), Mira, Thorn, Marsh Troll in Second Campaign", async () => {
    const r = await loaded("entities");
    const fixture = r.campaigns.find((c) => c.name === "Fixture Campaign");
    const second = r.campaigns.find((c) => c.name === "Second Campaign");
    expect([fixture?.active, second?.active]).toEqual([true, false]);
    const by = (n: string) => r.rows.find((e) => e.name === n);
    const goblin = by("Goblin");
    expect(by("Elite Goblin Warrior")).toMatchObject({
      kind: "monster",
      campaignId: fixture?.id,
      derivedFromId: goblin?.id,
      source: null,
      tokenShape: "square",
    });
    expect(by("Elite Goblin Warrior")?.statBlock).toEqual({
      size: "small",
      ac: 16,
      hpMax: 15,
      initBonus: 2,
      speed: 30,
      abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
      saveProficiencies: ["dex"],
      attacks: [{ name: "Scimitar", toHit: 5, damage: "1d6+3", damageType: "slashing" }],
      cr: "1/2",
      type: "humanoid",
    });
    expect(by("Mira")).toMatchObject({
      kind: "character",
      campaignId: fixture?.id,
      hpCurrent: 12,
      tokenShape: null,
    });
    expect(by("Mira")?.statBlock).toEqual({
      size: "medium",
      ac: 16,
      hpMax: 12,
      initBonus: 2,
      speed: 30,
      abilities: { str: 14, dex: 14, con: 14, int: 10, wis: 12, cha: 10 },
      saveProficiencies: ["str", "con"],
      attacks: [{ name: "Shortsword", toHit: 4, damage: "1d6+2", damageType: "piercing" }],
      level: 1,
      className: "Fighter",
    });
    expect(by("Thorn")).toMatchObject({ hpCurrent: 10, tokenShape: null });
    expect(by("Thorn")?.statBlock).toEqual({
      size: "medium",
      ac: 14,
      hpMax: 10,
      initBonus: 3,
      speed: 30,
      abilities: { str: 8, dex: 16, con: 14, int: 12, wis: 10, cha: 13 },
      saveProficiencies: ["dex", "int"],
      attacks: [{ name: "Dagger", toHit: 5, damage: "1d4+3", damageType: "piercing" }],
      level: 1,
      className: "Rogue",
    });
    expect(by("Marsh Troll")).toMatchObject({ campaignId: second?.id, tokenShape: null });
    expect(by("Marsh Troll")?.statBlock).toEqual({
      size: "large",
      ac: 15,
      hpMax: 59,
      initBonus: 1,
      speed: 30,
      attacks: [{ name: "Claw", toHit: 7, damage: "2d6+4", damageType: "slashing" }],
      cr: "5",
      type: "giant",
    });
    expect(r.manifest.records["char-mira"]?.entity).toEqual([by("Mira")?.id as string]);
    expect(r.manifest.records["enemy-custom-second"]?.entity).toEqual([
      by("Marsh Troll")?.id as string,
    ]);
    expect(r.rows).toHaveLength(6);
  });

  test("FR-ENT-27 ent-art-tokens (compendium-full): each token's creatureType from its definition; Ogre hidden", async () => {
    const r = await loaded("compendium-full");
    const mine = r.manifest.records["ent-art-tokens"]?.token ?? [];
    const art = mine.map((id) => r.tokens.find((t) => t.id === id));
    expect(art.map((t) => [t?.name, t?.creatureType, t?.hidden, t?.imageAssetId !== null])).toEqual(
      [
        ["Goblin 2", "humanoid", false, false],
        ["Goblin 3", "humanoid", false, false],
        ["Elite Goblin Warrior 2", "humanoid", false, false],
        ["Adult Red Dragon", "dragon", false, false],
        ["Wolf 2", "beast", false, true],
        ["Plain Brute", null, false, false],
        ["Ogre", "giant", true, false],
      ],
    );
    const brute = r.rows.find((e) => e.name === "Plain Brute");
    expect(brute?.statBlock).not.toHaveProperty("type");
    expect(brute?.portraitAssetId).toBeNull();
  }, 60_000);

  test("FR-ENT-27 token-art-update: sprint-3 SRD definitions (no type), version mini-s3; Goblin / Ogre null, Wolf Initials", async () => {
    const r = await loaded("token-art-update");
    const srd = r.rows.filter((e) => e.source === "srd-5.1");
    expect(srd.map((e) => e.name).sort()).toEqual([
      "Adult Red Dragon",
      "Goblin",
      "Hobgoblin",
      "Ogre",
      "Wolf",
    ]);
    for (const e of srd) expect(e.statBlock).not.toHaveProperty("type");
    expect(r.sources.map((x) => [x.key, x.version])).toEqual([["srd-5.1", "mini-s3"]]);
    const mine = r.manifest.records["art-update-tokens"]?.token ?? [];
    const art = mine.map((id) => r.tokens.find((t) => t.id === id));
    expect(art.map((t) => [t?.name, t?.creatureType])).toEqual([
      ["Goblin 2", null],
      ["Ogre", null],
      ["Wolf 2", "initials"],
    ]);
  });

  test("FR-FIX-08 two loads → identical rows; same IDs in session-sim", async () => {
    const a = await loaded("entities");
    const b = await loaded("entities");
    expect(b.rows).toEqual(a.rows);
    const s = await loaded("session-sim");
    expect(s.manifest.records["enemy-1"]).toEqual(a.manifest.records["enemy-1"] ?? {});
    expect(s.manifest.records["enemy-2"]).toEqual(a.manifest.records["enemy-2"] ?? {});
    expect(s.manifest.records["enemy-custom"]).toEqual(a.manifest.records["enemy-custom"] ?? {});
    expect(s.manifest.records["char-mira"]).toEqual(a.manifest.records["char-mira"] ?? {});
  });
});
