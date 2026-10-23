// Sprint 9 FX3 bundle `fx-s9`: loads from empty on session-sim-12; Mira concentrates on Bless
// (no duration) beside Thorn's Conjure Elemental, which his Fire Elemental 3 names. End's effect
// on them (FR-CBTX-75): effects.test.ts.
import { afterAll, expect, test } from "bun:test";
import { closeDb } from "@server/db/client";
import { combatant, effect, entity } from "@server/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { loadBundle } from "../index";

const cleanups: (() => void)[] = [];
afterAll(() => {
  Bun.gc(true);
  for (const c of cleanups) {
    try {
      c();
    } catch {
      // Windows may hold the temp dir a moment longer; the OS cleans it up.
    }
  }
});

test("FR-CBTX-75 fx-s9 loads from empty: Thorn's summon concentration and Mira's Bless", async () => {
  const r = await loadBundle("fx-s9", { testMode: true });
  cleanups.push(r.cleanup);
  const db = r.openDb();
  cleanups.unshift(() => closeDb(db));
  expect(r.manifest.status).toBe("complete");
  expect(r.manifest.fixtures.at(-1)).toBe("fx-mira-bless");
  const idOf = (name: string) =>
    db.select().from(entity).where(eq(entity.name, name)).get()?.id as string;
  const conc = (characterId: string) =>
    db
      .select()
      .from(effect)
      .where(
        and(
          eq(effect.kind, "concentration"),
          eq(effect.targetCharacterId, characterId),
          isNull(effect.endedAt),
        ),
      )
      .all();
  const [thorn] = conc(idOf("Thorn"));
  const [mira] = conc(idOf("Mira"));
  expect([thorn?.label, mira?.label, mira?.endsRound]).toEqual([
    "Conjure Elemental",
    "Bless",
    null,
  ]);
  const linked = db
    .select()
    .from(combatant)
    .where(eq(combatant.concentrationEffectId, thorn?.id as string))
    .all();
  expect(linked.map((c) => [c.name, c.summoned])).toEqual([["Fire Elemental 3", true]]);
});
