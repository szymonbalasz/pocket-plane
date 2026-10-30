// FR-OVW-48 (OVW §13, #163 seam) on `overview-scenes`: a Show and a group move are one transaction
// each: before-commit → nothing written (state digest equal after a restart); after-commit → all
// of it, never half. The cache rebuilds from the DB at boot.
import { describe, expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import { OVW_INTENTS } from "@shared/overview-scenes/schemas";
import { eq } from "drizzle-orm";
import { armCrashHook } from "../../commands/crash";
import { closeDb, type Db } from "../../db/client";
import { stateDigest } from "../../db/digest";
import { overview, overviewItem, scene } from "../../db/schema";
import { silentLogger } from "../../log";
import { createServices } from "../../services";
import { createTestServices, DM_ACTOR } from "../../testing/services";

class Killed extends Error {}

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

const named = (db: Db, name: string) =>
  db.select().from(overview).where(eq(overview.name, name)).get() as typeof overview.$inferSelect;
const actorOf = (db: Db) => ({ ...DM_ACTOR, campaignId: named(db, "Sword Coast").campaignId });
const shownCount = (db: Db) =>
  db.select().from(overview).where(eq(overview.active, true)).all().length +
  db.select().from(scene).where(eq(scene.active, true)).all().length;

async function crashBoth(
  openDb: () => Db,
  target: string,
  run: (b: Awaited<ReturnType<typeof boot>>) => unknown,
  check: (b: Awaited<ReturnType<typeof boot>>) => void,
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
  check(b);
  // Restart again: identical (nothing half-written is repaired at boot).
  const after = stateDigest(b.db.$client).sha256;
  b.close();
  b = await boot(openDb);
  expect(stateDigest(b.db.$client).sha256).toBe(after);
  b.close();
}

describe("FR-OVW-48 crash (PP_TEST_CRASH seams)", () => {
  test("FR-OVW-48 crash at ovw.show:before-commit and after-commit: nothing or everything; the cache rebuilds", async () => {
    const loaded = await loadBundle("overview-scenes", { testMode: true });
    try {
      const b = await boot(loaded.openDb);
      const actor = actorOf(b.db);
      const target = named(b.db, "Phandalin").id;
      const coast = named(b.db, "Sword Coast").id;
      expect(b.s.records.activeSceneOf(actor.campaignId)).toBe(coast);
      b.close();
      await crashBoth(
        loaded.openDb,
        OVW_INTENTS.show,
        (x) => x.s.commands.run(OVW_INTENTS.show, { overviewId: target }, { actor }),
        (x) => {
          expect(named(x.db, "Phandalin").active).toBe(true);
          expect(named(x.db, "Sword Coast").active).toBe(false);
          expect(shownCount(x.db)).toBe(1);
          expect(x.s.records.activeSceneOf(actor.campaignId)).toBe(target);
        },
      );
    } finally {
      try {
        loaded.cleanup();
      } catch {
        // Windows may hold the temp dir a moment longer; the OS cleans it up.
      }
    }
  }, 60_000);

  test("FR-OVW-48 crash on a Show taking a battle scene off: the scene is on or off with it", async () => {
    const loaded = await loadBundle("overview-scenes", { testMode: true });
    try {
      let b = await boot(loaded.openDb);
      const actor = actorOf(b.db);
      const town = b.db.select().from(scene).where(eq(scene.name, "Town")).get()?.id as string;
      const coast = named(b.db, "Sword Coast").id;
      b.s.commands.run("map.activateScene", { sceneId: town }, { actor });
      b.close();
      b = await boot(loaded.openDb);
      expect(b.s.records.activeSceneOf(actor.campaignId)).toBe(town);
      b.close();
      await crashBoth(
        loaded.openDb,
        OVW_INTENTS.show,
        (x) => x.s.commands.run(OVW_INTENTS.show, { overviewId: coast }, { actor }),
        (x) => {
          expect(named(x.db, "Sword Coast").active).toBe(true);
          expect(x.db.select().from(scene).where(eq(scene.id, town)).get()?.active).toBe(false);
          expect(shownCount(x.db)).toBe(1);
          expect(x.s.records.activeSceneOf(actor.campaignId)).toBe(coast);
        },
      );
    } finally {
      try {
        loaded.cleanup();
      } catch {
        // Windows may hold the temp dir a moment longer; the OS cleans it up.
      }
    }
  }, 60_000);

  test("FR-OVW-48 crash on a group move: every item moved or none", async () => {
    const loaded = await loadBundle("overview-crowd", { testMode: true });
    try {
      const b = await boot(loaded.openDb);
      const actor = actorOf(b.db);
      const crowd = named(b.db, "Crowded Coast").id;
      const rows = b.db
        .select()
        .from(overviewItem)
        .where(eq(overviewItem.overviewId, crowd))
        .all()
        .slice(0, 50);
      b.close();
      const moves = rows.map((r) => ({ itemId: r.id, x: 777, y: 888 }));
      // `OverviewItemsMoved` isn't logged, but its rows are state: the digest sees them.
      await crashBoth(
        loaded.openDb,
        OVW_INTENTS.moveItems,
        (x) => x.s.commands.run(OVW_INTENTS.moveItems, { overviewId: crowd, moves }, { actor }),
        (x) => {
          const moved = x.db
            .select()
            .from(overviewItem)
            .where(eq(overviewItem.x, 777))
            .all()
            .filter((r) => r.overviewId === crowd);
          expect(moved.length).toBe(50);
        },
      );
    } finally {
      try {
        loaded.cleanup();
      } catch {
        // Windows may hold the temp dir a moment longer; the OS cleans it up.
      }
    }
  }, 60_000);
});
