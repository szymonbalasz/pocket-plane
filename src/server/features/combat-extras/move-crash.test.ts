// Sprint 8 CB0 crash (FR-CBTX-69, #163 seam): `cbtx.moveCombatant` is one transaction: number ⇔
// tie order ⇔ ranks ⇔ event. before-commit → nothing written (digest equal after a restart);
// after-commit → all of it, never half.
import { expect, test } from "bun:test";
import { loadBundle } from "@fixtures/index";
import { and, eq } from "drizzle-orm";
import { armCrashHook } from "../../commands/crash";
import { closeDb, type Db } from "../../db/client";
import { stateDigest } from "../../db/digest";
import { combatant, encounter, eventLog } from "../../db/schema";
import { silentLogger } from "../../log";
import { createServices } from "../../services";
import { createTestServices, DM_ACTOR } from "../../testing/services";
import { moveCombatant } from "./move";

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
const row = (db: Db, name: string) =>
  db
    .select()
    .from(combatant)
    .where(and(eq(combatant.name, name), eq(combatant.active, true)))
    .get() as typeof combatant.$inferSelect;

test("FR-CBTX-69 crash keeps the order (before-commit: old order; after-commit: new order)", async () => {
  const loaded = await loadBundle("combat-polish", { testMode: true });
  try {
    const run = (b: Awaited<ReturnType<typeof boot>>) => {
      const enc = b.db.select().from(encounter).where(eq(encounter.status, "started")).get();
      return b.s.commands.run(
        moveCombatant.name,
        { encounterId: enc?.id, combatantId: row(b.db, "Thorn").id, afterId: null },
        { actor: { ...DM_ACTOR, campaignId: enc?.campaignId as string } },
      );
    };
    let b = await boot(loaded.openDb);
    const before = stateDigest(b.db.$client).sha256;
    armCrashHook({ point: "before-commit", target: moveCombatant.name }, kill);
    // Killed inside the transaction: the runner reports it as an internal error and rolls back.
    expect(() => run(b)).toThrow();
    armCrashHook(null);
    b.close();
    b = await boot(loaded.openDb);
    expect(stateDigest(b.db.$client).sha256).toBe(before);
    expect(row(b.db, "Thorn")).toMatchObject({ initiative: 12, tieOrder: null });
    armCrashHook({ point: "after-commit", target: moveCombatant.name }, kill);
    expect(() => run(b)).toThrow(Killed);
    armCrashHook(null);
    b.close();
    b = await boot(loaded.openDb);
    const after = stateDigest(b.db.$client).sha256;
    expect(after).not.toBe(before);
    // Thorn to the top: nearest visible PC below is Brakka 17; Wolf (18, hidden) rewritten to 17.
    expect(row(b.db, "Thorn")).toMatchObject({ initiative: 17, tieOrder: 1, position: 1 });
    expect(row(b.db, "Wolf")).toMatchObject({ initiative: 17, tieOrder: 2, position: 2 });
    expect(row(b.db, "Brakka")).toMatchObject({ initiative: 17, tieOrder: 3 });
    const moved = b.db.select().from(eventLog).where(eq(eventLog.type, "CombatantMoved")).all();
    expect(moved.length).toBe(1);
    b.close();
    // A second restart changes nothing.
    b = await boot(loaded.openDb);
    expect(stateDigest(b.db.$client).sha256).toBe(after);
    b.close();
  } finally {
    try {
      loaded.cleanup();
    } catch {
      // Windows may hold the temp dir a moment longer; the OS cleans it up.
    }
  }
});
