// Session-sim-17: `session-sim-17` loads from empty on top of session-sim-13: the running ambush
// stays, Mira and Thorn get their map-effect spell rows, Sword Coast is shown.
import { afterAll, expect, test } from "bun:test";
import { closeDb } from "@server/db/client";
import { creatureSheet, encounter, entity, overview, scene } from "@server/db/schema";
import type { SpellRow } from "@shared/character-sheet/sheet";
import { eq } from "drizzle-orm";
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

test("FR-FIX-03 session-sim-17 loads from empty: session-sim-13 + spell rows + overview scenes", async () => {
  const r = await loadBundle("session-sim-17", { testMode: true });
  cleanups.push(r.cleanup);
  const db = r.openDb();
  cleanups.unshift(() => closeDb(db));
  expect(r.manifest.status).toBe("complete");
  expect(r.manifest.fixtures).toEqual(
    expect.arrayContaining(["hold-greystone", "fx-mira-bless", "sg-row", "moil-row"]),
  );

  const sheetOf = (name: string) => {
    const e = db.select().from(entity).where(eq(entity.name, name)).get();
    if (!e) throw new Error(`no ${name}`);
    return db.select().from(creatureSheet).where(eq(creatureSheet.entityId, e.id)).get();
  };
  const spells = (name: string) => (sheetOf(name)?.spells ?? []) as SpellRow[];
  expect(spells("Mira").find((s) => s.name === "Spirit Guardians")?.fx?.preset).toBe(
    "spirit-guardians",
  );
  expect(spells("Mira").some((s) => s.name === "Hunter's Mark")).toBe(true);
  expect(spells("Thorn").find((s) => s.name === "Shadow of Moil")?.fx?.preset).toBe(
    "shadow-of-moil",
  );

  // The ambush keeps running under the shown overview.
  const fights = db.select().from(encounter).where(eq(encounter.status, "started")).all();
  expect(fights).toHaveLength(1);
  const names = db
    .select()
    .from(overview)
    .all()
    .map((o) => o.name)
    .sort();
  expect(names).toEqual(["Phandalin", "Sword Coast"]);
  expect(db.select().from(scene).where(eq(scene.name, "Goblin Ambush")).get()).toBeDefined();
});
