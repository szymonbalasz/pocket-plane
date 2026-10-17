// MOD §13.1 sprint-4 units (S4-0): `rules-effects` loads from empty and is deterministic; each
// unit leaves exactly the state §13.1 names (Flame Tongue row beside the Greataxe, Fire Ward on
// Goblin only, Rage 0 / 3, Mira's Searing Strike 1 / 2 with its `feature` trigger).
import { afterAll, describe, expect, test } from "bun:test";
import { closeDb } from "@server/db/client";
import { creatureSheet, effect, effectPreset, entity, ruleTrigger } from "@server/db/schema";
import type { FeatureRow } from "@shared/character-sheet/sheet";
import { eq, isNull } from "drizzle-orm";
import { loadRulesEffects } from "./rules-effects";

const cleanups: (() => void)[] = [];
afterAll(() => {
  Bun.gc(true);
  for (const c of cleanups) c();
});

async function loaded() {
  const r = await loadRulesEffects({ testMode: true });
  cleanups.push(r.cleanup);
  const db = r.openDb();
  cleanups.unshift(() => closeDb(db));
  return { r, db };
}

describe("rules-effects units (MOD §13.1)", () => {
  test("FR-MOD-31 rules-effects loads from empty: Flame Tongue, Fire Ward on Goblin, Rage spent, Searing Strike", async () => {
    const { r, db } = await loaded();
    expect(r.manifest.fixtures.slice(-4)).toEqual([
      "weapon-flame-tongue",
      "mod-fire-ward",
      "uses-rage-spent",
      "trg-mira-uses",
    ]);
    const ent = (name: string) => db.select().from(entity).where(eq(entity.name, name)).get();
    const sheet = (name: string) =>
      db
        .select()
        .from(creatureSheet)
        .where(eq(creatureSheet.entityId, ent(name)?.id as string))
        .get() as { features: FeatureRow[] } | undefined;
    const brakka = ent("Brakka");
    expect((brakka?.statBlock as { attacks?: unknown[] } | undefined)?.attacks).toEqual([
      expect.objectContaining({ name: "Greataxe", damage: "1d12+4" }),
      expect.objectContaining({
        name: "Flame Tongue greatsword",
        toHit: 7,
        damage: "2d6+4",
        damageType: "slashing",
        bonus: 1,
        extraDamage: [{ damage: "2d6", type: "fire" }],
      }),
    ]);
    const features = (name: string) =>
      (sheet(name)?.features ?? []).map((f) => [f.name, f.usesMax ?? null, f.used]);
    expect(features("Brakka")).toContainEqual(["Rage", 3, 3]);
    expect(features("Mira")).toContainEqual(["Searing Strike", 2, 1]);
    const ward = db.select().from(effectPreset).where(eq(effectPreset.name, "Fire Ward")).get();
    expect(ward?.modifiers).toEqual([{ kind: "defense", types: ["fire"], level: "resistance" }]);
    const warded = db
      .select()
      .from(effect)
      .where(isNull(effect.endedAt))
      .all()
      .filter((e) => e.presetKey === ward?.id);
    expect(warded).toHaveLength(1);
    expect(warded[0]?.label).toBe("Fire Ward");
    const searing = db
      .select()
      .from(ruleTrigger)
      .where(eq(ruleTrigger.name, "Searing Strike"))
      .get();
    const row = sheet("Mira")?.features.find((f) => f.name === "Searing Strike");
    expect(searing).toMatchObject({ characterId: ent("Mira")?.id, public: true, enabled: true });
    expect(searing?.rule).toMatchObject({ on: "hit", every: { feature: row?.id } });
  }, 60_000);

  test("FR-MOD-31 rules-effects is deterministic: two loads give identical rows", async () => {
    const a = await loaded();
    const b = await loaded();
    for (const t of [ruleTrigger, effectPreset, entity, creatureSheet, effect] as const) {
      expect(b.db.select().from(t).all()).toEqual(a.db.select().from(t).all());
    }
  }, 60_000);
});
