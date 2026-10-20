// Sprint 6 CP3 (OQ-CBT-84 a, seams S11): combat-extras' mid-fight Add takes pets — a pet token or
// the pet itself joins as itself (owner copies, its mode, its kept HP, `card`, side ally), per
// FR-CBT-109's rules; its owner PC must be in the fight.
import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { entity } from "../../db/schema";
import { cpSetup } from "../combat-tracker/cp-testing";

function setup() {
  const t = cpSetup({ start: false });
  t.start([]);
  t.step("next");
  return t;
}

describe("FR-CBTX-44 add with pets (OQ-CBT-84 a)", () => {
  test("FR-CBT-109 pets join through Add: a pet token binds, owner copies, kept HP, mode, card, ally; in-turn pet has no rank", () => {
    const t = setup();
    t.s.db.update(entity).set({ hpCurrent: 45 }).where(eq(entity.id, t.owlbear)).run();
    const n = t.events.length;
    const { combatantIds } = t.addCombatants([
      { tokenId: t.petTokens.owlbear },
      { definitionId: t.drake },
    ]);
    const [ob, dr] = combatantIds.map((id) => t.combatantRow(id));
    expect(ob).toMatchObject({
      pet: true,
      tokenId: t.petTokens.owlbear,
      ownerCharacterId: t.miraId,
      ownerPlayerId: t.h.p1.id,
      turnMode: "after-owner",
      hpCurrent: 45,
      hpMax: 59,
      side: "ally",
      publicSide: "ally",
      initiative: null,
      summoned: false,
    });
    expect(ob?.card?.attacks.map((a) => a.name)).toEqual(["Beak", "Claws"]);
    // The drake (by definition) binds its own placed token and acts inside Thorn's turn.
    expect(dr).toMatchObject({
      pet: true,
      tokenId: t.petTokens.drake,
      ownerCharacterId: t.thornId,
      turnMode: "in-owner-turn",
      position: null,
    });
    const order = t.ranked();
    expect(order.indexOf("Owlbear")).toBe(order.indexOf("Mira") + 1);
    // FR-ENT-37: both present now; the owner sees HP, the other player a band.
    expect(t.entityRow(t.owlbear)).toMatchObject({ petPresent: true });
    expect(t.playerCombatant(t.p1V, ob?.id as string)).toMatchObject({ hpCurrent: 45 });
    expect(t.playerCombatant(t.p2V, ob?.id as string)).not.toHaveProperty("hpCurrent");
    const p2Owlbear = t.events
      .slice(n)
      .flatMap((e) => t.wire(e.event.changes, t.p2V))
      .filter((w) => w.id === ob?.id);
    expect(JSON.stringify(p2Owlbear)).not.toContain('"card"');
    expect(JSON.stringify(p2Owlbear)).not.toContain('"hpCurrent"');
  });

  test("FR-CBT-109 Add pet guards: owner not in the fight, already in combat, quantity > 1", () => {
    const t = setup();
    t.addCombatants([{ definitionId: t.owlbear }]);
    expect(t.err(() => t.addCombatants([{ definitionId: t.owlbear }])).code).toBe("conflict");
    expect(t.err(() => t.addCombatants([{ definitionId: t.drake, quantity: 2 }])).code).toBe(
      "invalid",
    );
    t.run("cbt.setRemoved", { combatantId: t.id("Thorn"), removed: true });
    const e = t.err(() => t.addCombatants([{ definitionId: t.drake }]));
    expect([e.code, e.message]).toEqual(["conflict", "Thorn isn't in this fight"]);
  });
});
