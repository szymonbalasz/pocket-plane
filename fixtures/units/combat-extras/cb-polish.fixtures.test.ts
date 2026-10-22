// CBTX §13.1 (sprint 8, CB0): `combat-polish` loads from empty; the e2e aliases resolve to it.
import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { combatant, effect, encounter, entity } from "@server/db/schema";
import { and, eq, isNull } from "drizzle-orm";
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

describe("combat-polish fixtures (CBTX §13.1)", () => {
  test("CBTX §13.1 combat-polish loads from empty: 12-tie, fog-hidden Goblin, party values", async () => {
    const r = await loadBundle("combat-polish");
    dirs.push(r.dir);
    expect(r.manifest.fixtures.slice(-3)).toEqual(["cb-ties", "cb-fog-goblin", "cb-party"]);
    const db = r.openDb();
    const enc = db.select().from(encounter).where(eq(encounter.status, "started")).get();
    const rows = db
      .select()
      .from(combatant)
      .where(and(eq(combatant.encounterId, enc?.id as string), eq(combatant.active, true)))
      .all();
    const ranked = rows.filter((c) => c.position > 0).sort((a, b) => a.position - b.position);
    expect(ranked.map((c) => `${c.name} ${c.initiative ?? "-"}`)).toEqual([
      "Wolf 18",
      "Brakka 17",
      "Mira 15",
      "Goblin 2 12",
      "Owlbear -",
      "Fire Elemental -",
      // cb-ties: the three-way tie by the default rules (init bonus, then PC first)
      "Thorn 12",
      "Fire Elemental 3 12",
      "Goblin 12",
      "Elite Goblin Warrior 8",
    ]);
    expect(rows.every((c) => c.tieOrder === null)).toBe(true);
    const by = (n: string) => rows.find((c) => c.name === n) as typeof combatant.$inferSelect;
    // cb-fog-goblin: visible to the DM, fog-hidden to players (token not hidden)
    expect(by("Goblin").hidden).toBe(true);
    expect(by("Goblin").playerPosition).toBeNull();
    expect(by("Fire Elemental 3").turnMode).toBe("own");
    // cb-party
    const ch = (n: string) =>
      db
        .select()
        .from(entity)
        .where(eq(entity.name, n))
        .all()
        .find((e) => e.kind === "character");
    expect(ch("Thorn")?.tempHp).toBe(5);
    expect(ch("Brakka")).toMatchObject({ hpCurrent: 35 });
    const poisoned = db
      .select()
      .from(effect)
      .where(and(eq(effect.condition, "poisoned"), isNull(effect.endedAt)))
      .all()
      .map((e) => e.targetCharacterId);
    // a PC combatant target resolves to its character (CBTX §6)
    expect(poisoned).toContain(by("Mira").entityId);
    // still round 1, the Wolf's turn
    expect(enc).toMatchObject({ round: 1, turnCombatantId: by("Wolf").id });
  }, 120_000);

  test("CBTX §13.1 wf-frame-e2e loads from empty with cb-party-six: 6 PCs, worst-width figures (FR-SHELL-141)", async () => {
    const r = await loadBundle("wf-frame-e2e");
    dirs.push(r.dir);
    expect(r.manifest.fixtures.slice(-2)).toEqual(["cb-party", "cb-party-six"]);
    const pcs = r
      .openDb()
      .select()
      .from(entity)
      .all()
      .filter((e) => e.kind === "character");
    expect(pcs).toHaveLength(6);
    const six = pcs.filter((e) => (e.statBlock as { ac: number }).ac === 30);
    expect(six.map((e) => [e.name.length, e.hpCurrent, e.tempHp])).toEqual([
      [3, 999, 999],
      [5, 999, 999],
      [40, 999, 999],
    ]);
  }, 120_000);

  test("CBTX §13.1 e2e aliases are combat-polish", () => {
    for (const name of ["cb-reorder-e2e", "cb-turn-ring-e2e", "cb-party-e2e"]) {
      const b = library.bundles.find((x) => x.name === name);
      expect(b).toMatchObject({ includes: ["combat-polish"], fixtures: [] });
    }
  });
});
