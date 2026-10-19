// Ally side, R4 (sprint 5, #252): a mid-fight add starts at its kind's default (FR-CBT-98), the
// rating reads the entries, which `cbt.setSide` never edits (FR-CBT-102), and everything keyed off
// kind stays on kind (FR-CBT-103). R0's tests cover `cbt.setSide` itself (s5-core.test.ts).
import { describe, expect, test } from "bun:test";
import { CBTX_INTENTS } from "@shared/combat-extras/intents";
import { compareOrder, sideOf, unrolledMonsters } from "@shared/combat-tracker/rules";
import { COMBATANT_TYPE, ENCOUNTER_ENTRY_TYPE } from "@shared/combat-tracker/schemas";
import { TOKEN_TYPE } from "@shared/scenes-map/schemas";
import { rtSetup } from "../effect-modifiers/trigger-testing";
import { s5Setup } from "./s5-testing";
import { setSideCommand } from "./sides";

describe("FR-CBT-98 side defaults (R4)", () => {
  test("FR-CBT-98 side defaults and Start copy: a CBTX mid-fight add starts at its kind's default", () => {
    const t = s5Setup();
    const { combatantIds } = t.run<{ combatantIds: string[] }>(CBTX_INTENTS.addCombatants, {
      encounterId: t.enc.id,
      items: [{ definitionId: t.h.goblinId }],
    });
    const added = t.combatants(t.enc.id).find((c) => c.id === combatantIds[0]);
    expect(added).toMatchObject({ kind: "monster", side: null, publicSide: null });
    expect(sideOf(added as { kind: "monster"; side: null })).toBe("enemy");
    const p = t.snap(t.p1V, COMBATANT_TYPE) as { id: string; side: string }[];
    expect(p.find((c) => c.id === combatantIds[0])?.side).toBe("enemy");
  });
});

describe("FR-CBT-102 difficulty is planning-only (R4)", () => {
  test("FR-CBT-102 difficulty enemies only: cbt.setSide on a started encounter leaves its entries (the rating's input) unchanged", () => {
    const t = s5Setup();
    const entries = () => t.snap(t.dmV, ENCOUNTER_ENTRY_TYPE);
    const before = entries();
    const n = t.events.length;
    t.setSide("Goblin 2", "ally");
    t.setSide("Mira", "enemy", true);
    expect(entries()).toEqual(before);
    // No entry change rides on the side events.
    const changed = t.events.slice(n).flatMap((e) => e.event.changes.map((c) => c.type));
    expect(changed).not.toContain(ENCOUNTER_ENTRY_TYPE);
    expect((before as { side: string }[]).map((e) => e.side)).toEqual(["enemy", "enemy", "enemy"]);
  });
});

describe("FR-CBT-103 kind rules unchanged (R4)", () => {
  test("FR-CBT-103 kind rules unchanged: ties PC before monster; Roll monsters includes a friendly monster", () => {
    const row = (id: string, kind: "pc" | "monster", seq: number) => ({
      id,
      seq,
      kind,
      initiative: 12,
      initBonus: 2,
      active: true,
      removed: false,
      hidden: false,
    });
    // Ally Goblin 2 (seq 1) and enemy Mira (seq 2) tie: the PC still goes first.
    expect(compareOrder(row("goblin2", "monster", 1), row("mira", "pc", 2))).toBeGreaterThan(0);
    const friendly = { kind: "monster" as const, side: "ally" as const, initiative: null };
    expect(unrolledMonsters([friendly, { kind: "pc" as const, initiative: null }])).toEqual([
      friendly,
    ]);
  });

  test("FR-CBT-103 kind rules unchanged: ally Goblin 2 at 0 HP skipped; players see its band, never HP; its trail DM-only", () => {
    const t = s5Setup();
    t.setSide("Goblin 2", "ally");
    // Players: a band on either side (#138, OQ-CBT-73 A).
    const g2 = () =>
      (t.snap(t.p1V, COMBATANT_TYPE) as Record<string, unknown>[]).find(
        (c) => c.name === "Goblin 2",
      );
    expect(g2()).toMatchObject({ kind: "monster", side: "ally", band: "healthy" });
    expect(g2()).not.toHaveProperty("hpCurrent");
    expect(g2()).not.toHaveProperty("hpMax");
    // Drag path / trail: token ownership, not side — the DM's move of the ally's token stays DM-only.
    t.move(t.tokens.goblin2, 13, 8);
    const ev = t.events.at(-1)?.event;
    expect(t.tokenRow(t.tokens.goblin2).trail?.cells.length).toBe(2);
    for (const v of [t.p1V, t.p2V]) {
      const tok = t.wire(ev?.changes ?? [], v).find((w) => w.type === TOKEN_TYPE);
      expect(JSON.stringify(tok ?? {})).not.toContain('"trail"');
    }
    // At 0 HP the ally is skipped like any monster (FR-CBT-14, -50).
    t.hp("Goblin 2", "damage", 99);
    expect(g2()).toMatchObject({ band: "down" });
    const turns = new Set<string | undefined>();
    for (let i = 0; i < 8; i++) {
      t.step("next");
      turns.add(t.turnName());
    }
    expect(turns.has("Goblin 2")).toBe(false);
    expect(turns.has("Goblin")).toBe(true);
  });

  test("FR-CBT-103 kind rules unchanged: Martial Advantage on an ally Elite is still an `ask` the DM confirms", () => {
    const t = rtSetup();
    const ma = t.trig({
      definitionId: t.eliteId,
      name: "Martial Advantage",
      rule: {
        on: "hit",
        when: [{ if: "ask", note: "an ally within 5 ft of the target" }],
        every: "turn",
        // biome-ignore lint/suspicious/noThenProperty: `then` is the rule's effect field (MOD §8.4), data.
        then: { do: "damage", formula: "2d6", type: null },
      },
    });
    t.run(setSideCommand.name, { combatantId: t.id("Elite Goblin Warrior"), side: "ally" });
    t.nextTo("Elite Goblin Warrior", 1);
    const { cardId } = t.attack("Elite Goblin Warrior", { damage: 5 });
    const offered = t.card(cardId).damage?.triggers ?? [];
    expect(offered.map((p) => [p.triggerId, p.ask])).toEqual([
      [ma, "an ally within 5 ft of the target"],
    ]);
  });
});
