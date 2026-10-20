// Sprint 7 FU-combat crash tests on `fu-s7` (#163 seam): `cbt.end` with a hostile summon is one
// transaction (before-commit → nothing written; after-commit → every summon token gone, the
// charmed Goblin 2's owner cleared, pets' owners kept), and `cbt.start`'s kept HP commits with it
// (after-commit → the kept values survive a restart).
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
import { setCompanionCommand } from "./companions";
import { endCommand, startCommand } from "./lifecycle";

class Killed extends Error {}

const kill = () => {
  throw new Killed();
};

async function boot(openDb: () => Db) {
  const db = openDb();
  const s = createServices({ config: createTestServices().config, db, log: silentLogger });
  for (const h of s.startHooks) await h.fn(s);
  return { s, db, close: () => closeDb(db) };
}
type Booted = Awaited<ReturnType<typeof boot>>;

const dmOf = (db: Db) => {
  const enc = db.select().from(encounter).get();
  return { ...DM_ACTOR, campaignId: enc?.campaignId as string };
};
const activeNamed = (db: Db, name: string) =>
  db
    .select()
    .from(combatant)
    .where(and(eq(combatant.name, name), eq(combatant.active, true)))
    .get() as typeof combatant.$inferSelect;
const tokenOf = (db: Db, id: string) => db.select().from(token).where(eq(token.id, id)).get();
const running = (db: Db) =>
  db.select().from(encounter).where(eq(encounter.status, "started")).get();

/** before-commit → digest unchanged after restart; after-commit → `check` holds after restart. */
async function crashBoth(
  openDb: () => Db,
  target: string,
  run: (b: Booted) => unknown,
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
  check(b.db);
  b.close();
}

const cleanup = (loaded: { cleanup(): void }) => {
  try {
    loaded.cleanup();
  } catch {
    // Windows may hold the temp dir a moment longer; the OS cleans it up.
  }
};

describe("FU-combat crash (PP_TEST_CRASH seams)", () => {
  test("FR-CBT-145 End removes hostile summon tokens: crash cbt.end → all or nothing", async () => {
    const loaded = await loadBundle("fu-s7", { testMode: true });
    try {
      const b = await boot(loaded.openDb);
      const fe3 = activeNamed(b.db, "Fire Elemental 3");
      b.s.commands.run(
        setCompanionCommand.name,
        { combatantId: fe3.id, owner: null, side: "enemy" },
        { actor: dmOf(b.db) },
      );
      const summons = ["Fire Elemental", "Fire Elemental 2", "Fire Elemental 3"].map(
        (n) => activeNamed(b.db, n).tokenId as string,
      );
      const g2Token = activeNamed(b.db, "Goblin 2").tokenId as string;
      const drakeToken = activeNamed(b.db, "Drake Companion").tokenId as string;
      const drakeOwner = tokenOf(b.db, drakeToken)?.ownerPlayerId;
      const encId = running(b.db)?.id;
      b.close();
      await crashBoth(
        loaded.openDb,
        endCommand.name,
        (x) => x.s.commands.run(endCommand.name, { encounterId: encId }, { actor: dmOf(x.db) }),
        (db) => {
          for (const id of summons) expect(tokenOf(db, id)).toBeUndefined();
          expect(tokenOf(db, g2Token)?.ownerPlayerId).toBeNull();
          expect(tokenOf(db, drakeToken)?.ownerPlayerId).toBe(drakeOwner as string);
        },
      );
    } finally {
      cleanup(loaded);
    }
  }, 90_000);

  test("FR-CBT-141 kept HP at Start: crash cbt.start → all or nothing", async () => {
    const loaded = await loadBundle("fu-s7", { testMode: true });
    try {
      const b = await boot(loaded.openDb);
      const ambush = running(b.db);
      b.s.commands.run(endCommand.name, { encounterId: ambush?.id }, { actor: dmOf(b.db) });
      const escort = b.db
        .select()
        .from(encounter)
        .where(eq(encounter.name, "Escort to the Ford"))
        .get();
      const pets = b.db
        .select()
        .from(entity)
        .all()
        .filter((e) => e.companionOf !== null && e.kind === "monster")
        .map((e) => e.id);
      b.close();
      await crashBoth(
        loaded.openDb,
        startCommand.name,
        (x) =>
          x.s.commands.run(
            startCommand.name,
            { encounterId: escort?.id, sceneId: ambush?.sceneId, petIds: pets },
            { actor: dmOf(x.db) },
          ),
        (db) => {
          expect(running(db)?.id).toBe(escort?.id as string);
          expect(activeNamed(db, "Goblin 2")).toMatchObject({ hpCurrent: 4, hpMax: 7 });
        },
      );
    } finally {
      cleanup(loaded);
    }
  }, 90_000);
});
