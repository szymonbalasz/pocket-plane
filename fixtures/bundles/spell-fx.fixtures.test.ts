// VFX §13 bundle `spell-fx`: loads from empty; Goblin Ambush live with the "Spell FX" fight in
// round 1 (Mira, Goblin Sneak, Thorn, each bound to their token), the FX spell rows and the
// pending Fire Bolt card.
import { afterAll, expect, test } from "bun:test";
import { closeDb } from "@server/db/client";
import {
  combatant,
  creatureSheet,
  encounter,
  entity,
  notification,
  scene,
  token,
} from "@server/db/schema";
import type { SpellRow } from "@shared/character-sheet/sheet";
import { asc, eq } from "drizzle-orm";
import { loadBundle } from "../index";
import { fireBoltRowId } from "../units/spell-fx/fire-card";

let cleanup: (() => void) | null = null;
afterAll(() => {
  try {
    cleanup?.();
  } catch {
    // Windows may hold the temp dir a moment longer; the OS cleans it up.
  }
});

test("VFX §13 bundle `spell-fx` loads from empty: fight, FX rows, the fire card", async () => {
  const r = await loadBundle("spell-fx");
  cleanup = r.cleanup;
  const db = r.openDb();
  try {
    expect(r.manifest.fixtures).toEqual(
      expect.arrayContaining(["mt-crowd", "vfx-fight", "sg-row", "moil-row", "fire-card"]),
    );
    const ambush = db.select().from(scene).where(eq(scene.name, "Goblin Ambush")).get();
    expect(ambush?.active).toBe(true);
    const enc = db.select().from(encounter).where(eq(encounter.status, "started")).get();
    expect(enc).toMatchObject({ name: "Spell FX", round: 1, sceneId: ambush?.id });
    const fighters = db
      .select()
      .from(combatant)
      .where(eq(combatant.encounterId, enc?.id as string))
      .orderBy(asc(combatant.seq))
      .all();
    expect(fighters.map((c) => c.name)).toEqual(["Mira", "Thorn", "Goblin Sneak"]);
    expect(enc?.turnCombatantId).toBe(fighters[0]?.id);
    for (const c of fighters) {
      const t = db
        .select()
        .from(token)
        .where(eq(token.id, c.tokenId as string))
        .get();
      expect(t?.sceneId).toBe(ambush?.id);
      expect(t?.name).toBe(c.name);
    }
    const sheetOf = (name: string) => {
      const e = db.select().from(entity).where(eq(entity.name, name)).get();
      return db
        .select()
        .from(creatureSheet)
        .where(eq(creatureSheet.entityId, e?.id as string))
        .get();
    };
    const mira = (sheetOf("Mira")?.spells as SpellRow[] | undefined) ?? [];
    expect(mira.map((s) => s.name)).toEqual(["Spirit Guardians", "Fire Bolt"]);
    expect(mira[0]?.fx).toEqual({
      preset: "spirit-guardians",
      params: { variant: "radiant", radiusFt: 15 },
    });
    // The fixture predicts the Fire Bolt row id from its seeded stream.
    expect(mira[1]?.id).toBe(fireBoltRowId());
    expect(((sheetOf("Thorn")?.spells ?? []) as SpellRow[]).map((s) => [s.name, s.fx])).toEqual([
      ["Shadow of Moil", { preset: "shadow-of-moil", params: { radiusFt: 10 } }],
    ]);
    const cards = db
      .select()
      .from(notification)
      .where(eq(notification.kind, "damage-card"))
      .all()
      .filter((n) => n.state === "pending");
    expect(cards).toHaveLength(1);
    expect(cards[0]?.payload).toMatchObject({ attackerName: "Mira", damageType: "fire" });
  } finally {
    closeDb(db);
  }
});
