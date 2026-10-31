// FR-CBT-178 (#427): the DM clears a card's damage and a new roll fills it. CBTX's ambush, round
// 1; `player-1` plays Mira; Brakka's Divine Fury for the offers.
import { describe, expect, test } from "bun:test";
import {
  CBT_INTENTS,
  critChanged,
  type HpChangesResult,
  partRollIdsOf,
  type RollDamageResult,
  type UseRollResult,
} from "@shared/combat-tracker/schemas";
import { armCrashHook } from "../../commands/crash";
import { rtSetup } from "../effect-modifiers/trigger-testing";
import { applyCard } from "./hp";
import { type S5Setup, s5Setup } from "./s5-testing";

const clear = (t: S5Setup, cardId: string, damageRollId?: string, actor = t.h.dm) =>
  t.run(
    CBT_INTENTS.clearDamage,
    { cardId, damageRollId: damageRollId ?? t.card(cardId).p.damage?.rollId },
    actor,
  );

/** Mira's to-hit 15, Apply hit on Goblin, then a wrong damage roll of 6. */
function ruledWithDamage() {
  const t = s5Setup();
  const { cardId } = t.toHit("Mira", 11);
  t.applyHit(cardId, 15, [t.target("Goblin", true)]);
  t.damage("Mira", 4);
  return { t, cardId };
}

describe("FR-CBT-178 clear damage", () => {
  test("FR-CBT-178 clear on a ruled card: back to waiting, ruling and roll lines kept; the next roll fills it and applies", () => {
    const { t, cardId } = ruledWithDamage();
    const rulings = t.rulings();
    const lines = t.entries().length;
    const text = t.card(cardId).text;
    expect(text).toContain("6 piercing");

    expect(clear(t, cardId)).toEqual({ cardId });
    const cleared = t.card(cardId);
    expect(cleared.p.damage).toBeNull();
    expect(cleared.p.damageCleared).toBe(true);
    expect(cleared.state).toBe("pending");
    expect(cleared.text).toBe("Mira: 15 to hit (Shortsword)");
    expect(t.rulings()).toEqual(rulings);
    expect(t.entries()).toHaveLength(lines);

    const r = t.damage("Mira", 2);
    expect(r).toMatchObject({ cardId, attached: true });
    expect(r.unused).toBeUndefined();
    const filled = t.card(cardId).p;
    expect(filled.damage?.total).toBe(4);
    expect(filled.damageCleared).toBeUndefined();

    const goblin = t.combatant("Goblin").hpCurrent as number;
    t.run<HpChangesResult>(applyCard.name, {
      cardId,
      damageTotal: filled.damage?.total,
      damageRollId: filled.damage?.rollId,
      partRollIds: partRollIdsOf(filled),
      targets: [t.target("Goblin", true)],
    });
    expect(t.combatant("Goblin").hpCurrent).toBe(goblin - 4);
    expect(t.card(cardId).state).toBe("resolved");
  });

  test("FR-CBT-178 clear on an unruled card works too; the DM's own roll fills a player's card", () => {
    const t = s5Setup();
    const { cardId } = t.toHit("Mira", 11);
    t.damage("Mira", 4);
    clear(t, cardId);
    expect(t.damage("Mira", 5, t.h.dm)).toMatchObject({ cardId, attached: true });
    expect(t.card(cardId).p.damage?.total).toBe(7);
  });

  test("FR-CBT-178 a logged roll used as damage fills the cleared card; the cleared crit doubles again", () => {
    const { t, cardId } = ruledWithDamage();
    clear(t, cardId);
    const free = t.run<{ entryId: string }>("dice.roll", { expression: "1d6+2" }, t.p1);
    const rolled = t.entries().find((e) => e.id === free.entryId)?.payload as { total: number }[];
    const used = t.run<UseRollResult>(CBT_INTENTS.useRoll, {
      entryId: free.entryId,
      as: "damage",
      attackerId: t.id("Mira"),
    });
    expect(used).toEqual({ cardId, attached: true });
    expect(t.card(cardId).p.damage?.total).toBe(rolled[0]?.total as number);
    expect(t.card(cardId).p.damageCleared).toBeUndefined();

    const crit = s5Setup();
    const { cardId: critCard } = crit.toHit("Mira", 20);
    crit.run<RollDamageResult>(CBT_INTENTS.rollDamage, { attackerId: crit.id("Mira") }, crit.p1);
    expect(crit.card(critCard).p.damage?.dice).toHaveLength(2);
    clear(crit, critCard);
    crit.run<RollDamageResult>(CBT_INTENTS.rollDamage, { attackerId: crit.id("Mira") }, crit.p1);
    expect(crit.card(critCard).p.damage?.dice).toHaveLength(2);
  });

  test("FR-CBT-178 the unused rolls go with the damage and the card never reads as a crit flip", () => {
    const { t, cardId } = ruledWithDamage();
    t.damage("Mira", 5);
    expect(t.card(cardId).p.unusedRolls).toHaveLength(1);
    clear(t, cardId);
    const { p } = t.card(cardId);
    expect(p.unusedRolls).toBeUndefined();
    expect(critChanged(p)).toBe(false);
    // Back to one roll fills, the next is unused: FR-CBT-92 as before.
    expect(t.damage("Mira", 2).attached).toBe(true);
    expect(t.damage("Mira", 3).unused).toBe(true);
  });

  test("FR-CBT-178 the cleared card takes the next roll before a newer to-hit-only card", () => {
    const { t, cardId } = ruledWithDamage();
    const newer = t.toHit("Mira", 12).cardId;
    clear(t, cardId);
    expect(t.damage("Mira", 2)).toMatchObject({ cardId, attached: true });
    expect(t.card(newer).p.damage).toBeNull();
    // The next roll goes to the newer card, as ever.
    expect(t.damage("Mira", 3)).toMatchObject({ cardId: newer, attached: true });
  });

  test("FR-CBT-178 refusals: no damage, stale roll, damage-only, resolved, player; nothing written", () => {
    const { t, cardId } = ruledWithDamage();
    const rollId = t.card(cardId).p.damage?.rollId as string;
    const before = t.events.length;
    const stale = t.err(() => clear(t, cardId, "other-roll"));
    expect(stale.code).toBe("conflict");
    expect(t.card(cardId).p.damage?.rollId).toBe(rollId);
    const player = t.err(() => clear(t, cardId, rollId, t.p1));
    expect(player.code).toBe("forbidden");
    expect(t.events.length).toBe(before);

    clear(t, cardId);
    expect(t.err(() => clear(t, cardId, rollId)).code).toBe("conflict");

    const only = t.damage("Thorn", 3, t.player(t.h.p2));
    const onlyRoll = t.card(only.cardId).p.damage?.rollId as string;
    expect(t.err(() => clear(t, only.cardId, onlyRoll)).code).toBe("invalid");

    t.damage("Mira", 2);
    const p = t.card(cardId).p;
    t.run(applyCard.name, {
      cardId,
      damageTotal: p.damage?.total,
      damageRollId: p.damage?.rollId,
      partRollIds: partRollIdsOf(p),
      targets: [t.target("Goblin", true)],
    });
    expect(t.err(() => clear(t, cardId)).code).toBe("conflict");
  });

  test("FR-CBT-178 one frame: the owner and the DM get the card, another player nothing", () => {
    const { t, cardId } = ruledWithDamage();
    const n = t.events.length;
    clear(t, cardId);
    const events = t.events.slice(n);
    expect(events.map((e) => e.event.type)).toEqual(["DamageCleared"]);
    const frame = (v: S5Setup["p1V"]) =>
      JSON.stringify(events.flatMap((e) => t.wire(e.event.changes, v)));
    expect(frame(t.p1V)).toContain("damageCleared");
    expect(frame(t.dmV)).toContain("damageCleared");
    expect(frame(t.p2V)).toBe("[]");
  });

  test("FR-CBT-178 crash: card and event commit together or not at all", () => {
    class Killed extends Error {}
    const { t, cardId } = ruledWithDamage();
    const name = CBT_INTENTS.clearDamage;
    try {
      armCrashHook({ point: "before-commit", target: name }, () => {
        throw new Killed();
      });
      expect(() => clear(t, cardId)).toThrow();
      expect(t.card(cardId).p.damage?.total).toBe(6);
    } finally {
      armCrashHook(null);
    }
  });

  test("FR-CBT-178 FR-MOD-63 offers leave with the cleared roll; the new roll offers them again", () => {
    const t = rtSetup();
    t.nextTo("Brakka", 1);
    t.rage(true);
    const { cardId } = t.attack("Brakka", { rolls: "toHit", toHit: 15 });
    t.rollDamage("Brakka", 8);
    expect(t.uses().map((u) => u.state)).toEqual(["offered"]);
    t.run(CBT_INTENTS.clearDamage, { cardId, damageRollId: t.card(cardId).damage?.rollId });
    expect(t.uses()).toEqual([]);
    expect(t.card(cardId).damage).toBeNull();
    t.rollDamage("Brakka", 5);
    expect(t.card(cardId).damage?.triggers?.[0]).toMatchObject({ label: "Divine Fury" });
    expect(t.uses().map((u) => u.state)).toEqual(["offered"]);
  });
});
