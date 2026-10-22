// SHELL §13 sprint 5 (track W): `win-layout` stacked on `session-sim-8` as bundle `windows-s5`.
import { afterAll, describe, expect, test } from "bun:test";
import { closeDb } from "@server/db/client";
import {
  combatant,
  creatureSheet,
  effect,
  effectPreset,
  encounter,
  encounterEntry,
  entity,
  scene,
  token,
} from "@server/db/schema";
import { CreatureSheetRecord } from "@shared/character-sheet/sheet";
import { asc, eq } from "drizzle-orm";
import { loadBundle } from "../../index";

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

describe("win-layout fixture (SHELL §13 sprint 5)", () => {
  test("FIX win-layout windows-s5 loads from empty: Rage on for Brakka, planned Crypt with 2 visible tokens, combat-1 untouched", async () => {
    const r = await loadBundle("windows-s5");
    cleanups.push(r.cleanup);
    expect(r.manifest.status).toBe("complete");
    expect(r.manifest.fixtures.at(-1)).toBe("win-layout");
    const db = r.openDb();
    cleanups.unshift(() => closeDb(db));

    // Brakka: Rage on (10 rounds), the linked use overspent to −1 / 3.
    const brakka = db.select().from(entity).where(eq(entity.name, "Brakka")).get();
    const row = db
      .select()
      .from(creatureSheet)
      .where(eq(creatureSheet.entityId, brakka?.id ?? ""))
      .get();
    const sheet = CreatureSheetRecord.parse({ id: row?.entityId, ...row });
    const rageRow = sheet.features.find((f) => f.name === "Rage");
    expect([rageRow?.usesMax, rageRow?.used]).toEqual([3, 4]);
    const preset = db
      .select()
      .from(effectPreset)
      .where(eq(effectPreset.characterId, brakka?.id ?? ""))
      .all()
      .find((p) => p.name === "Rage");
    expect(preset?.activeEffectId).not.toBeNull();
    const rage = db
      .select()
      .from(effect)
      .where(eq(effect.id, preset?.activeEffectId ?? ""))
      .get();
    expect(rage).toMatchObject({
      kind: "custom",
      label: "Rage",
      durationRounds: 10,
      endedAt: null,
    });
    const ks = db.select().from(combatant).all();
    const onBrakka =
      rage?.targetCharacterId === brakka?.id ||
      ks.find((k) => k.id === rage?.targetCombatantId)?.entityId === brakka?.id;
    expect(onBrakka).toBe(true);

    // "Crypt": planned, not started, Crypt Ogre + SRD Goblin, each with a visible token.
    const ambush = db.select().from(scene).where(eq(scene.name, "Goblin Ambush")).get();
    const crypt = db.select().from(encounter).where(eq(encounter.name, "Crypt")).get();
    expect(crypt).toMatchObject({ status: "planned", round: 0, startedAt: null });
    const entries = db
      .select()
      .from(encounterEntry)
      .where(eq(encounterEntry.encounterId, crypt?.id ?? ""))
      .orderBy(asc(encounterEntry.seq))
      .all();
    expect(entries.map((e) => e.quantity)).toEqual([1, 1]);
    const ogre = db
      .select()
      .from(entity)
      .where(eq(entity.id, entries[0]?.definitionId ?? ""))
      .get();
    expect(ogre?.name).toBe("Crypt Ogre");
    expect(ogre?.derivedFromId).not.toBeNull();
    expect((ogre?.statBlock as { size: string } | undefined)?.size).toBe("large");
    const tokens = db
      .select()
      .from(token)
      .where(eq(token.sceneId, ambush?.id ?? ""))
      .all();
    const at = (definitionId: string | undefined) =>
      tokens
        .filter((t) => t.definitionId === definitionId)
        .map((t) => ({ name: t.name, col: t.col, row: t.row, size: t.size, hidden: t.hidden }));
    expect(at(entries[0]?.definitionId)).toEqual([
      { name: "Crypt Ogre", col: 18, row: 6, size: "large", hidden: false },
    ]);
    expect(at(entries[1]?.definitionId)).toEqual([
      { name: "Goblin 3", col: 8, row: 2, size: "small", hidden: false },
    ]);

    // combat-1 untouched: round 1, the hidden Wolf's turn.
    const ford = db.select().from(encounter).where(eq(encounter.name, "Ambush at the Ford")).get();
    expect(ford).toMatchObject({ status: "started", round: 1 });
    const turn = ks.find((k) => k.id === ford?.turnCombatantId);
    expect(turn).toMatchObject({ name: "Wolf", hidden: true });
  }, 30_000);
});

describe("wf-frame bundles (SHELL §13 sprint 8)", () => {
  test("FIX wf-frame wf-frame-e2e load from empty: session-sim-11 under their own names (no new unit)", async () => {
    for (const name of ["wf-frame", "wf-frame-e2e"]) {
      const r = await loadBundle(name);
      cleanups.push(r.cleanup);
      expect(r.manifest.status).toBe("complete");
      expect(r.manifest.fixtures).toContain("cp-ally");
      const db = r.openDb();
      cleanups.unshift(() => closeDb(db));
      const started = db.select().from(encounter).where(eq(encounter.status, "started")).all();
      expect(started.map((e) => e.name)).toEqual(["Ambush at the Ford"]);
    }
  }, 60_000);
});
