// Sprint 7 FU-combat bundles (play-shell §13 sprint 7, seams S13): `fu-s7` (= session-sim-10 +
// `cp-ally` + `fu-hurt-goblins`), `fu-s7-e2e` and `session-sim-11` load from empty, on top of
// sim-10's running ambush (joined, not restarted; no turn change), deterministically.
import { afterAll, describe, expect, test } from "bun:test";
import { closeDb, type Db } from "@server/db/client";
import { combatant, encounter, entity, hpChange, token } from "@server/db/schema";
import { and, eq } from "drizzle-orm";
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

async function load(bundle: string) {
  const r = await loadBundle(bundle, { testMode: true });
  cleanups.push(r.cleanup);
  const db = r.openDb();
  cleanups.unshift(() => closeDb(db));
  return { r, db };
}

const fighting = (db: Db, name: string) =>
  db
    .select()
    .from(combatant)
    .where(and(eq(combatant.name, name), eq(combatant.active, true)))
    .get();

/** fu-hurt-goblins + cp-ally on sim-10's ambush: Goblin 0 / 7, Goblin 2 4 / 7 and Mira's. */
function expectFuS7(db: Db) {
  const mira = db.select().from(entity).where(eq(entity.name, "Mira")).get();
  expect(fighting(db, "Goblin")).toMatchObject({ hpCurrent: 0, hpMax: 7 });
  expect(fighting(db, "Goblin 2")).toMatchObject({
    hpCurrent: 4,
    hpMax: 7,
    ownerCharacterId: mira?.id as string,
    turnMode: "after-owner",
    summoned: false,
  });
  const started = db.select().from(encounter).where(eq(encounter.status, "started")).all();
  expect(started.map((e) => [e.name, e.round])).toEqual([["Ambush at the Ford", 1]]);
  expect(db.select().from(hpChange).all().length).toBeGreaterThanOrEqual(2);
  const g2Token = fighting(db, "Goblin 2")?.tokenId as string;
  expect(db.select().from(token).where(eq(token.id, g2Token)).get()?.ownerPlayerId).toBe(
    mira?.ownerPlayerId as string,
  );
}

describe("FU-combat bundles", () => {
  test("FR-CBT-141 fu-s7 loads from empty: Goblin 0 / 7, Goblin 2 4 / 7 (Mira's charmed), still round 1; deterministic", async () => {
    const a = await load("fu-s7");
    const b = await load("fu-s7");
    expect(a.r.manifest.status).toBe("complete");
    expect(a.r.manifest.fixtures.slice(-2)).toEqual(["cp-ally", "fu-hurt-goblins"]);
    expectFuS7(a.db);
    for (const t of [entity, token, combatant, encounter] as const) {
      expect(b.db.select().from(t).all()).toEqual(a.db.select().from(t).all());
    }
  }, 120_000);

  test("FR-CBT-141 fu-s7-e2e and session-sim-11 load from empty with the FU units", async () => {
    const e2e = await load("fu-s7-e2e");
    expect(e2e.r.manifest.status).toBe("complete");
    expectFuS7(e2e.db);
    const sim11 = await load("session-sim-11");
    expect(sim11.r.manifest.status).toBe("complete");
    expect(sim11.r.manifest.fixtures).toEqual(
      expect.arrayContaining(["cp-combat", "cp-ally", "fu-hurt-goblins"]),
    );
    expectFuS7(sim11.db);
  }, 120_000);
});
