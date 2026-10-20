// Sprint 6 CP0 crash tests (CBT §13.3 "Crash", #163 seam): `cbt.setCompanion`, `POST /api/pets`
// (`entities.createPet`) and `cbt.end` with pets and a summon token are one transaction each:
// before-commit → nothing written (state digest equal after a restart); after-commit → all of it
// (the pet's HP written back, the summon's token gone), never half.
import { describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import { and, eq } from "drizzle-orm";
import { armCrashHook } from "../../commands/crash";
import { closeDb, type Db } from "../../db/client";
import { stateDigest } from "../../db/digest";
import { combatant, encounter, entity, token } from "../../db/schema";
import { silentLogger } from "../../log";
import { createServices } from "../../services";
import { createTestServices, DM_ACTOR } from "../../testing/services";
import { CREATE_PET } from "../entities/pets";
import { setCompanionCommand } from "./companions";
import { applyHp } from "./hp";
import { setInitiative } from "./initiative";
import { endCommand, startCommand } from "./lifecycle";

class Killed extends Error {}

/** Windows may hold the temp dir a moment longer; the OS cleans it up. */
const cleanup = (loaded: { cleanup(): void }) => {
  try {
    loaded.cleanup();
  } catch {
    // ignore
  }
};
const kill = () => {
  throw new Killed();
};

/** A "server boot" on the bundle's file: start hooks as `startServer`. */
async function boot(openDb: () => Db) {
  const db = openDb();
  const s = createServices({ config: createTestServices().config, db, log: silentLogger });
  for (const h of s.startHooks) await h.fn(s);
  return { s, db, close: () => closeDb(db) };
}

const dmOf = (db: Db) => {
  const enc = db.select().from(encounter).get();
  return { ...DM_ACTOR, campaignId: enc?.campaignId as string };
};
const byName = (db: Db, name: string) =>
  db.select().from(entity).where(eq(entity.name, name)).get() as typeof entity.$inferSelect;
/** A campaign pet by name (the imported SRD row shares it). */
const petNamed = (db: Db, name: string) =>
  db
    .select()
    .from(entity)
    .where(eq(entity.name, name))
    .all()
    .find((e) => e.companionOf !== null) as typeof entity.$inferSelect;
const combatantNamed = (db: Db, name: string) =>
  db
    .select()
    .from(combatant)
    .where(and(eq(combatant.name, name), eq(combatant.active, true)))
    .get() as typeof combatant.$inferSelect;

/** before-commit → digest unchanged after restart; after-commit → `check` holds after restart. */
async function crashBoth(
  openDb: () => Db,
  target: string,
  run: (b: Awaited<ReturnType<typeof boot>>) => unknown,
  check: (db: Db) => void,
) {
  let b = await boot(openDb);
  const before = stateDigest(b.db.$client).sha256;
  armCrashHook({ point: "before-commit", target }, kill);
  expect(() => run(b)).toThrow();
  armCrashHook(null);
  b.close();
  b = await boot(openDb);
  expect(stateDigest(b.db.$client).sha256).toBe(before);
  armCrashHook({ point: "after-commit", target }, kill);
  expect(() => run(b)).toThrow(Killed);
  armCrashHook(null);
  b.close();
  b = await boot(openDb);
  expect(stateDigest(b.db.$client).sha256).not.toBe(before);
  check(b.db);
  b.close();
}

describe("CP0 crash (PP_TEST_CRASH seams)", () => {
  test("FR-CBT-111 crash: cbt.setCompanion is one transaction (combatant, token owner, line)", async () => {
    const loaded = await loadBundle("late-damage", { testMode: true });
    try {
      const raw = loaded.openDb();
      const mira = byName(raw, "Mira");
      const g2 = combatantNamed(raw, "Goblin 2");
      closeDb(raw);
      await crashBoth(
        loaded.openDb,
        setCompanionCommand.name,
        (b) =>
          b.s.commands.run(
            setCompanionCommand.name,
            { combatantId: g2.id, owner: { characterId: mira.id } },
            { actor: dmOf(b.db) },
          ),
        (db) => {
          const now = combatantNamed(db, "Goblin 2");
          expect(now.ownerCharacterId).toBe(mira.id);
          const t = db
            .select()
            .from(token)
            .where(eq(token.id, now.tokenId as string))
            .get();
          expect(t?.ownerPlayerId).toBe(mira.ownerPlayerId as string);
        },
      );
    } finally {
      cleanup(loaded);
    }
  }, 60_000);

  test("FR-ENT-32 crash: POST /api/pets (entities.createPet) is one transaction", async () => {
    const loaded = await loadBundle("companions-prep", { testMode: true });
    try {
      const raw = loaded.openDb();
      const mira = byName(raw, "Mira");
      const base = raw.select().from(entity).where(eq(entity.sourceKey, "owlbear")).get();
      closeDb(raw);
      await crashBoth(
        loaded.openDb,
        CREATE_PET,
        (b) =>
          b.s.commands.run(
            CREATE_PET,
            { baseDefinitionId: base?.id, companionOf: mira.id },
            { actor: dmOf(b.db) },
          ),
        (db) =>
          expect(petNamed(db, "Owlbear")).toMatchObject({ companionOf: mira.id, hpCurrent: 59 }),
      );
    } finally {
      cleanup(loaded);
    }
  }, 60_000);

  test("FR-CBT-113 crash: cbt.end with a pet and a summon is one transaction (write-back, token delete)", async () => {
    const loaded = await loadBundle("companions-start", { testMode: true });
    try {
      // Start with both pets, make Goblin 2 Mira's companion, hurt the Owlbear.
      const b = await boot(loaded.openDb);
      const actor = dmOf(b.db);
      const enc = b.db
        .select()
        .from(encounter)
        .where(eq(encounter.name, "Ambush at the Ford"))
        .get();
      const ambush = b.db.select().from(token).where(eq(token.name, "Owlbear")).get();
      const run = (name: string, input: unknown) => b.s.commands.run(name, input, { actor });
      run(startCommand.name, {
        encounterId: enc?.id,
        sceneId: ambush?.sceneId,
        petIds: [petNamed(b.db, "Owlbear").id, petNamed(b.db, "Wolf").id],
      });
      for (const c of b.db.select().from(combatant).all()) {
        if (c.initiative === null && c.turnMode === null) {
          run(setInitiative.name, { combatantId: c.id, value: 10 });
        }
      }
      const mira = byName(b.db, "Mira");
      run(setCompanionCommand.name, {
        combatantId: combatantNamed(b.db, "Goblin 2").id,
        owner: { characterId: mira.id },
      });
      run(applyHp.name, {
        combatantId: combatantNamed(b.db, "Owlbear").id,
        kind: "damage",
        // The fixture leaves the Owlbear at 45 / 59 (`pet.adjustHp −14`, CP1): 45 − 25 = 20.
        amount: 25,
      });
      const summonToken = combatantNamed(b.db, "Goblin 2").tokenId as string;
      b.close();
      await crashBoth(
        loaded.openDb,
        endCommand.name,
        (x) => x.s.commands.run(endCommand.name, { encounterId: enc?.id }, { actor }),
        (db) => {
          expect(petNamed(db, "Owlbear").hpCurrent).toBe(20);
          expect(db.select().from(token).where(eq(token.id, summonToken)).get()).toBeUndefined();
          expect(
            db
              .select()
              .from(encounter)
              .where(eq(encounter.id, enc?.id as string))
              .get()?.status,
          ).toBe("ended");
        },
      );
    } finally {
      cleanup(loaded);
    }
  }, 90_000);
});
