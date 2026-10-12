import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { closeDb } from "@server/db/client";
import { campaign, entity } from "@server/db/schema";
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
  closeDb(db);
  return { ...r, rows, campaigns, log };
}

describe("entities fixtures (ENT §13)", () => {
  test("FR-ENT-06 enemy-1 / enemy-2: SRD goblin + wolf, global, fixture provenance", async () => {
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
      initBonus: 2,
      attacks: [{ name: "Scimitar", toHit: 4, damage: "1d6+2", damageType: "slashing" }],
      cr: "1/4",
    });
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
      statBlock: {
        size: "small",
        ac: 16,
        hpMax: 15,
        initBonus: 2,
        attacks: [{ name: "Scimitar", toHit: 5, damage: "1d6+3", damageType: "slashing" }],
        cr: "1/2",
      },
    });
    expect(by("Mira")).toMatchObject({
      kind: "character",
      campaignId: fixture?.id,
      hpCurrent: 12,
      statBlock: { ac: 16, hpMax: 12, initBonus: 2, level: 1, className: "Fighter" },
    });
    expect(by("Thorn")).toMatchObject({
      hpCurrent: 10,
      statBlock: { ac: 14, initBonus: 3, attacks: [{ toHit: 5, damage: "1d4+3" }] },
    });
    expect(by("Marsh Troll")).toMatchObject({
      campaignId: second?.id,
      statBlock: { size: "large", ac: 15, hpMax: 59, initBonus: 1, cr: "5" },
    });
    expect(r.manifest.records["char-mira"]?.entity).toEqual([by("Mira")?.id as string]);
    expect(r.manifest.records["enemy-custom-second"]?.entity).toEqual([
      by("Marsh Troll")?.id as string,
    ]);
    expect(r.rows).toHaveLength(6);
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
