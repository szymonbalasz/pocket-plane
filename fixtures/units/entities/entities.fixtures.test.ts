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

  test("FR-FIX-08 two loads → identical rows; same IDs in session-sim", async () => {
    const a = await loaded("entities");
    const b = await loaded("entities");
    expect(b.rows).toEqual(a.rows);
    const s = await loaded("session-sim");
    expect(s.manifest.records["enemy-1"]).toEqual(a.manifest.records["enemy-1"] ?? {});
    expect(s.manifest.records["enemy-2"]).toEqual(a.manifest.records["enemy-2"] ?? {});
  });
});
