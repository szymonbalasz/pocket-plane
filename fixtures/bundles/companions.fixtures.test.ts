// Sprint 6 track CP bundles (CBT §13.3, FR-CBT-124, FR-ENT-40): `companions`, `companions-prep`,
// `companions-e2e`, `companions-start`, `companions-ally` load from empty and are deterministic;
// the CP units also load on top of `session-sim-9`'s running fight (seams S12: the fight is
// joined, not started), checked by relative order only (review 19).
import { afterAll, describe, expect, test } from "bun:test";
import { closeDb, type Db } from "@server/db/client";
import { combatant, encounter, entity, token } from "@server/db/schema";
import {
  defineBundle,
  type FixtureLibrary,
} from "@server/features/fixtures-adapters/fixture-types";
import { loadInProcess } from "@server/features/fixtures-adapters/loader";
import { asc, eq } from "drizzle-orm";
import { library, loadBundle } from "../index";

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

type Loaded = Awaited<ReturnType<typeof loadBundle>>;

function track(r: Loaded): { r: Loaded; db: Db } {
  cleanups.push(r.cleanup);
  const db = r.openDb();
  cleanups.unshift(() => closeDb(db));
  return { r, db };
}

const load = async (bundle: string) => track(await loadBundle(bundle, { testMode: true }));

/** The four session-sim-10 units on top of session-sim-9. */
const SIM9_CP = defineBundle({
  name: "test-sim9-cp",
  includes: ["session-sim-9"],
  fixtures: ["cp-srd", "pet-owlbear", "pet-drake", "cp-combat"],
});
const sim9Lib: FixtureLibrary = { ...library, bundles: [...library.bundles, SIM9_CP] };

const pets = (db: Db) =>
  db
    .select()
    .from(entity)
    .all()
    .filter((e) => e.companionOf !== null)
    .map((e) => ({ name: e.name, mode: e.turnMode, hp: e.hpCurrent, present: e.petPresent }));

/** Started encounter's combatants in rank order (position null = inside the owner's turn). */
const order = (db: Db) => {
  const enc = db.select().from(encounter).where(eq(encounter.status, "started")).get();
  return db
    .select()
    .from(combatant)
    .where(eq(combatant.encounterId, enc?.id ?? ""))
    .orderBy(asc(combatant.position))
    .all();
};

/**
 * CBT §13.3 `cp-combat`, relative order only (review 19): Brakka's row holds the drake and FE 2
 * (no ranks), Mira → Owlbear → Fire Elemental, FE 3 (Thorn's, own 9) between Thorn and Elite,
 * linked to Thorn's Conjure Elemental; summon tokens owned by their owner's player.
 */
function expectCpCombat(db: Db) {
  const rows = order(db);
  const by = (name: string) => rows.find((c) => c.name === name);
  const ranked = rows.filter((c) => c.active && c.position !== 0).map((c) => c.name);
  const at = (name: string) => ranked.indexOf(name);
  expect(at("Owlbear")).toBe(at("Mira") + 1);
  expect(at("Fire Elemental")).toBe(at("Owlbear") + 1);
  expect(at("Fire Elemental 3")).toBeGreaterThan(at("Thorn"));
  expect(at("Fire Elemental 3")).toBeLessThan(at("Elite Goblin Warrior"));
  expect(at("Brakka")).toBeLessThan(at("Mira"));
  for (const name of ["Drake Companion", "Fire Elemental 2"]) {
    expect(by(name)).toMatchObject({ position: 0, turnMode: "in-owner-turn" });
    expect(by(name)?.ownerCharacterId).toBe(by("Brakka")?.entityId as string);
  }
  expect(by("Fire Elemental 3")).toMatchObject({ initiative: 9, turnMode: "own", summoned: true });
  expect(by("Fire Elemental 3")?.concentrationEffectId).not.toBeNull();
  for (const name of ["Fire Elemental", "Fire Elemental 2", "Fire Elemental 3"]) {
    const c = by(name);
    const t = db
      .select()
      .from(token)
      .where(eq(token.id, c?.tokenId as string))
      .get();
    expect(t?.ownerPlayerId).toBe(c?.ownerPlayerId as string);
  }
  // Still round 1, the Wolf's turn.
  const enc = db.select().from(encounter).where(eq(encounter.status, "started")).get();
  expect(enc?.round).toBe(1);
  expect(rows.find((c) => c.id === enc?.turnCombatantId)?.name).toBe("Wolf");
}

describe("FR-CBT-124 companions bundles", () => {
  test("FR-CBT-124 companions loads from empty: the Owlbear (Mira) and Drake (Brakka) pets with tokens, joined with three Fire Elementals (cp-combat)", async () => {
    const { r, db } = await load("companions");
    expect(r.manifest.status).toBe("complete");
    expect(r.manifest.fixtures.slice(-4)).toEqual([
      "cp-srd",
      "pet-owlbear",
      "pet-drake",
      "cp-combat",
    ]);
    // FR-ENT-37: both pets are in the running fight now (cp-combat), so present.
    expect(pets(db)).toEqual([
      { name: "Owlbear", mode: "after-owner", hp: 59, present: true },
      { name: "Drake Companion", mode: "in-owner-turn", hp: 22, present: true },
    ]);
    // FR-MAP-74: the pet tokens are owned by the pet's player (Mira and Brakka: player-1).
    const mira = db.select().from(entity).where(eq(entity.name, "Mira")).get();
    for (const name of ["Owlbear", "Drake Companion"]) {
      const t = db.select().from(token).where(eq(token.name, name)).get();
      expect(t?.ownerPlayerId).toBe(mira?.ownerPlayerId as string);
    }
    expectCpCombat(db);
  }, 60_000);

  test("FR-CBT-124 companions deterministic: two loads give identical rows", async () => {
    const a = await load("companions");
    const b = await load("companions");
    for (const t of [entity, token, combatant] as const) {
      expect(b.db.select().from(t).all()).toEqual(a.db.select().from(t).all());
    }
  }, 60_000);

  test("FR-CBT-124 companions-prep, companions-e2e, companions-start, companions-ally load from empty", async () => {
    for (const name of ["companions-prep", "companions-e2e"]) {
      const { r, db } = await load(name);
      expect(r.manifest.status).toBe("complete");
      expect(r.manifest.fixtures.at(-1)).toBe("cp-srd");
      expect(pets(db)).toEqual([]);
    }
    const start = await load("companions-start");
    expect(start.r.manifest.status).toBe("complete");
    expect(pets(start.db)).toEqual([
      { name: "Owlbear", mode: "after-owner", hp: 59, present: false },
      { name: "Wolf", mode: "in-owner-turn", hp: 11, present: false },
    ]);
    // No running fight: "Ambush at the Ford" waits for the DM's Start (FR-CBT-109, S1).
    expect(start.db.select().from(encounter).where(eq(encounter.status, "started")).all()).toEqual(
      [],
    );
    const ally = await load("companions-ally");
    const g2 = order(ally.db).find((c) => c.name === "Goblin 2");
    expect(g2).toMatchObject({ turnMode: "after-owner", side: "ally", pet: false });
    const mira = ally.db.select().from(entity).where(eq(entity.name, "Mira")).get();
    expect(g2?.ownerCharacterId).toBe(mira?.id as string);
    // Relative order: Goblin 2 right after Mira (FR-CBT-107).
    const names = order(ally.db).map((c) => c.name);
    expect(names.indexOf("Goblin 2")).toBe(names.indexOf("Mira") + 1);
  }, 90_000);

  test("FR-CBT-124 cp units load on session-sim-9: the running fight is joined, not started; deterministic", async () => {
    const a = track(await loadInProcess(sim9Lib, "test-sim9-cp", { testMode: true }));
    const b = track(await loadInProcess(sim9Lib, "test-sim9-cp", { testMode: true }));
    expect(a.r.manifest.status).toBe("complete");
    expect(pets(a.db).map((p) => p.name)).toEqual(["Owlbear", "Drake Companion"]);
    // Still one started encounter (session-sim-9's), still round 1: joined, not started.
    const started = a.db.select().from(encounter).where(eq(encounter.status, "started")).all();
    expect(started.map((e) => e.round)).toEqual([1]);
    expectCpCombat(a.db);
    for (const t of [entity, token, combatant] as const) {
      expect(b.db.select().from(t).all()).toEqual(a.db.select().from(t).all());
    }
  }, 120_000);
});
