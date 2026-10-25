// Bundle `theme-gilt` (theme-system §13): `combat` + `combat-1` stepped to round 3 + `rolls-1`.
// Loads from empty: round 3, Wolf's turn, six combatants, Mira's full sheet, the four log lines;
// CON-44 ceilings with the measured figures printed.
import { afterAll, describe, expect, test } from "bun:test";
import { closeDb } from "@server/db/client";
import { combatant, encounter, entity, gameLogEntry } from "@server/db/schema";
import { SNAPSHOT_CEILING } from "@server/ws/hub";
import { servicesFromBundle, snapshotSizes } from "@server/ws/testing/snapshot-size";
import { asc, eq } from "drizzle-orm";
import { loadBundle } from "../index";

const BUNDLE = "theme-gilt";

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

describe("theme-gilt bundle (theme-system §13)", () => {
  test("FR-THEME-05 theme-gilt loads from empty: round 3, Wolf's turn, 6 combatants, Mira's full sheet, 4 log lines", async () => {
    const r = await loadBundle(BUNDLE, { testMode: true });
    cleanups.push(r.cleanup);
    const db = r.openDb();
    cleanups.unshift(() => closeDb(db));
    expect(r.manifest.status).toBe("complete");
    expect(r.manifest.fixtures.slice(-3)).toEqual(["combat-1", "theme-round-3", "rolls-1"]);
    for (const key of ["char-mira-full", "npc-elite-sheet", "enemy-1"]) {
      expect(r.manifest.fixtures).toContain(key);
    }
    const enc = db.select().from(encounter).where(eq(encounter.status, "started")).get();
    const rows = db
      .select()
      .from(combatant)
      .where(eq(combatant.encounterId, enc?.id as string))
      .orderBy(asc(combatant.position))
      .all();
    expect(rows.map((c) => c.name)).toEqual([
      "Wolf",
      "Mira",
      "Goblin",
      "Goblin 2",
      "Thorn",
      "Elite Goblin Warrior",
    ]);
    expect(enc).toMatchObject({ round: 3, turnCombatantId: rows[0]?.id as string });
    const lines = JSON.stringify(
      db
        .select()
        .from(gameLogEntry)
        .all()
        .map((e) => e.payload),
    );
    for (const l of ["Scimitar", "Perception", "DM-SECRET-ROLL"]) expect(lines).toContain(l);
    expect(db.select().from(entity).where(eq(entity.name, "Goblin")).get()).toBeTruthy();
  }, 60_000);

  test("CON-44 theme-gilt snapshots under the ceilings: DM ≤ 1.5 MiB, every player ≤ 512 KiB", async () => {
    const b = await servicesFromBundle(await loadBundle(BUNDLE, { testMode: true }));
    cleanups.push(b.cleanup);
    const sizes = snapshotSizes(b.s);
    console.log(`CON-44 theme-gilt: ${sizes.map((s) => `${s.label} ${s.bytes} B`).join("; ")}`);
    expect(sizes.map((s) => s.label)).toEqual(["DM", "P1", "P2"]);
    for (const s of sizes)
      expect([s.label, s.bytes <= SNAPSHOT_CEILING[s.role]]).toEqual([s.label, true]);
  }, 60_000);
});
