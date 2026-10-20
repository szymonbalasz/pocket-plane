// Sprint 6 CP3 crash tests (CBT §13.3 "Crash", #163 seam) on `companions`: `cbt.summon` (tokens +
// combatants + line), `cbt.dismiss` (inactive + token delete or write-back + effects + line) and
// `cbt.end` (write-backs + summon token deletes) are one transaction each: before-commit →
// nothing written (state digest equal after a restart); after-commit → all of it, never half.
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
import { dismissCommand } from "./dismiss";
import { applyHp } from "./hp";
import { endCommand } from "./lifecycle";
import { summonCommand } from "./summon";

class Killed extends Error {}

const cleanup = (loaded: { cleanup(): void }) => {
  try {
    loaded.cleanup();
  } catch {
    // Windows may hold the temp dir a moment longer; the OS cleans it up.
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

const started = (db: Db) =>
  db
    .select()
    .from(encounter)
    .where(eq(encounter.status, "started"))
    .get() as typeof encounter.$inferSelect;
const dmOf = (db: Db) => ({ ...DM_ACTOR, campaignId: started(db).campaignId });
const named = (db: Db, name: string) =>
  db
    .select()
    .from(combatant)
    .where(and(eq(combatant.name, name), eq(combatant.active, true)))
    .get() as typeof combatant.$inferSelect;
const charNamed = (db: Db, name: string) =>
  db
    .select()
    .from(entity)
    .where(and(eq(entity.name, name), eq(entity.kind, "character")))
    .get() as typeof entity.$inferSelect;
const hasToken = (db: Db, id: string) =>
  db.select().from(token).where(eq(token.id, id)).get() !== undefined;

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
  // Restart again: identical (nothing half-written is repaired at boot).
  const after = stateDigest(b.db.$client).sha256;
  b.close();
  b = await boot(openDb);
  expect(stateDigest(b.db.$client).sha256).toBe(after);
  b.close();
}

describe("CP3 crash (PP_TEST_CRASH seams)", () => {
  test("FR-CBT-110 crash: cbt.summon is one transaction (tokens, combatants, line)", async () => {
    const loaded = await loadBundle("companions", { testMode: true });
    try {
      const b = await boot(loaded.openDb);
      const actor = dmOf(b.db);
      const enc = started(b.db);
      const fe = named(b.db, "Fire Elemental").entityId;
      const mira = charNamed(b.db, "Mira").id;
      const tokensBefore = b.db.select().from(token).all().length;
      b.close();
      await crashBoth(
        loaded.openDb,
        summonCommand.name,
        (x) =>
          x.s.commands.run(
            summonCommand.name,
            { encounterId: enc.id, definitionId: fe, count: 2, ownerCharacterId: mira },
            { actor },
          ),
        (db) => {
          const summons = db
            .select()
            .from(combatant)
            .all()
            .filter((c) => c.summoned && c.ownerCharacterId === mira);
          expect(summons).toHaveLength(3);
          expect(db.select().from(token).all().length).toBe(tokensBefore + 2);
          for (const c of summons) expect(hasToken(db, c.tokenId as string)).toBe(true);
        },
      );
    } finally {
      cleanup(loaded);
    }
  }, 90_000);

  test("FR-CBT-112 crash: cbt.dismiss is one transaction (inactive, token delete, line)", async () => {
    const loaded = await loadBundle("companions", { testMode: true });
    try {
      const b = await boot(loaded.openDb);
      const actor = dmOf(b.db);
      const fe = named(b.db, "Fire Elemental");
      b.close();
      await crashBoth(
        loaded.openDb,
        dismissCommand.name,
        (x) => x.s.commands.run(dismissCommand.name, { combatantId: fe.id }, { actor }),
        (db) => {
          const row = db.select().from(combatant).where(eq(combatant.id, fe.id)).get();
          expect(row?.active).toBe(false);
          expect(hasToken(db, fe.tokenId as string)).toBe(false);
        },
      );
    } finally {
      cleanup(loaded);
    }
  }, 90_000);

  test("FR-CBT-113 crash: cbt.end is one transaction (pet write-back, summon token deletes)", async () => {
    const loaded = await loadBundle("companions", { testMode: true });
    try {
      const b = await boot(loaded.openDb);
      const actor = dmOf(b.db);
      const enc = started(b.db);
      b.s.commands.run(
        applyHp.name,
        { combatantId: named(b.db, "Owlbear").id, kind: "damage", amount: 35 },
        { actor },
      );
      const summonTokens = ["Fire Elemental", "Fire Elemental 2", "Fire Elemental 3"].map(
        (n) => named(b.db, n).tokenId as string,
      );
      const petToken = named(b.db, "Owlbear").tokenId as string;
      b.close();
      await crashBoth(
        loaded.openDb,
        endCommand.name,
        (x) => x.s.commands.run(endCommand.name, { encounterId: enc.id }, { actor }),
        (db) => {
          const owlbear = db
            .select()
            .from(entity)
            .all()
            .find((e) => e.name === "Owlbear" && e.companionOf !== null);
          expect(owlbear?.hpCurrent).toBe(24);
          for (const t of summonTokens) expect(hasToken(db, t)).toBe(false);
          expect(hasToken(db, petToken)).toBe(true);
        },
      );
    } finally {
      cleanup(loaded);
    }
  }, 90_000);
});
