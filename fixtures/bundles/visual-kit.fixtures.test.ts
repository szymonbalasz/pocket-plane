// Bundle `visual-kit` (screenshot baselines, #368; Spell FX build): loads from empty with both
// auras on existing effects of characters whose tokens are on the shown scene.
import { afterAll, expect, test } from "bun:test";
import { closeDb } from "@server/db/client";
import { effect, entity, scene, token } from "@server/db/schema";
import { and, eq } from "drizzle-orm";
import { loadBundle } from "../index";

let cleanup: (() => void) | null = null;
afterAll(() => {
  try {
    cleanup?.();
  } catch {
    // Windows may hold the temp dir a moment longer; the OS cleans it up.
  }
});

test("VFX §13 visual-kit: Mira's Bless draws Spirit Guardians, Thorn's Marked Shadow of Moil, both tokens on the active scene", async () => {
  const r = await loadBundle("visual-kit");
  cleanup = r.cleanup;
  const db = r.openDb();
  try {
    const active = db.select().from(scene).where(eq(scene.active, true)).get();
    const fx = db
      .select()
      .from(effect)
      .all()
      .filter((e) => e.fx !== null && e.endedAt === null);
    const byName = (n: string) => db.select().from(entity).where(eq(entity.name, n)).get()?.id;
    const sg = fx.find((e) => e.fx?.preset === "spirit-guardians");
    const moil = fx.find((e) => e.fx?.preset === "shadow-of-moil");
    expect(sg).toMatchObject({
      kind: "concentration",
      label: "Bless",
      targetCharacterId: byName("Mira"),
    });
    expect(moil).toMatchObject({ label: "Marked", targetCharacterId: byName("Thorn") });
    for (const id of [byName("Mira"), byName("Thorn")]) {
      const t = db
        .select()
        .from(token)
        .where(and(eq(token.definitionId, id as string), eq(token.sceneId, active?.id as string)))
        .all();
      expect(t.length).toBeGreaterThan(0);
      expect(t.every((x) => !x.hidden)).toBe(true);
    }
  } finally {
    closeDb(db);
  }
}, 60_000);
