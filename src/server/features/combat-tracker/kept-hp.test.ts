// Sprint 7 FU-combat (FR-CBT-141, OQ-CBT-92 A): a monster bound into the next encounter keeps the
// HP it ended with (0 → Down, bound after the living ones), from the token's latest-ended
// combatant row; a definition edit in between follows FR-CBT-06 / -67; Add binds the same way;
// pets and PCs unchanged; no `hp_change` row or HP roll at bind (seams S8).
import { describe, expect, test } from "bun:test";
import { CBTX_INTENTS } from "@shared/combat-extras/intents";
import type { CombatantRecord, EncounterRecord } from "@shared/combat-tracker/schemas";
import { PET_ADJUST_HP } from "@shared/entities/pet-hp";
import { eq } from "drizzle-orm";
import { gameLogEntry, hpChange } from "../../db/schema";
import { UPDATE } from "../entities/commands";
import { cpSetup } from "./cp-testing";
import { createEncounter } from "./encounters";
import { applyHp } from "./hp";
import { endCommand, startCommand } from "./lifecycle";
import { combatSetup, eliteBlock } from "./testing";

type Setup = ReturnType<typeof combatSetup>;

/** The ambush started (no initiative needed for End), `hurt` applied, then ended. */
function foughtAmbush(t: Setup, hurt: Record<string, number>): EncounterRecord {
  const enc = t.createAmbush();
  t.run(startCommand.name, { encounterId: enc.id, sceneId: t.sceneId });
  for (const [name, amount] of Object.entries(hurt)) {
    const c = t.byName(enc.id)[name] as CombatantRecord;
    t.run(applyHp.name, { combatantId: c.id, kind: "damage", amount });
  }
  t.run(endCommand.name, { encounterId: enc.id });
  return enc;
}

const encounterOf = (t: Setup, name: string, entries: Record<string, unknown>[]) =>
  t.run<EncounterRecord>(createEncounter.name, {
    name,
    partyCharacterIds: [],
    entries,
    createTokens: false,
  });

const start = (t: Setup, enc: EncounterRecord) =>
  t.run(startCommand.name, { encounterId: enc.id, sceneId: t.sceneId });

const hpRows = (t: Setup) => t.s.db.select().from(hpChange).all().length;
const hpRolls = (t: Setup, encounterId: string) =>
  t.s.db
    .select()
    .from(gameLogEntry)
    .where(eq(gameLogEntry.encounterId, encounterId))
    .all()
    .filter((e) => JSON.stringify(e.payload).includes('"label":"HP ('));

describe("FR-CBT-141 kept HP at Start", () => {
  test("FR-CBT-141 kept HP at Start: Goblin 0 / 7 stays Down, Goblin 2 4 / 7, no hp_change or roll at bind", () => {
    const t = combatSetup();
    foughtAmbush(t, { Goblin: 7, "Goblin 2": 3 });
    const before = hpRows(t);
    const next = encounterOf(t, "Escort", [{ definitionId: t.h.goblinId, quantity: 2 }]);
    start(t, next);
    const by = t.byName(next.id);
    expect(by.Goblin).toMatchObject({ tokenId: t.tokens.goblin, hpCurrent: 0, hpMax: 7 });
    expect(by["Goblin 2"]).toMatchObject({ tokenId: t.tokens.goblin2, hpCurrent: 4, hpMax: 7 });
    expect(hpRows(t)).toBe(before);
  });

  test("FR-CBT-141 kept HP at Start: a token kept at 0 binds after a living one", () => {
    const t = combatSetup();
    foughtAmbush(t, { Goblin: 7 });
    const one = encounterOf(t, "One", [{ definitionId: t.h.goblinId, quantity: 1 }]);
    start(t, one);
    const rows = t.combatants(one.id);
    expect(rows.map((c) => [c.tokenId, c.hpCurrent])).toEqual([[t.tokens.goblin2, 7]]);
  });

  test("FR-CBT-141 kept HP at Start: tokens never in a fight and created tokens get today's HP", () => {
    const t = combatSetup();
    const enc = t.run<EncounterRecord>(createEncounter.name, {
      name: "Fresh",
      partyCharacterIds: [],
      entries: [{ definitionId: t.h.goblinId, quantity: 3 }],
    });
    start(t, enc);
    expect(t.combatants(enc.id).map((c) => c.hpCurrent)).toEqual([7, 7, 7]);
  });

  test("FR-CBT-141 kept HP at Start: the latest-ended fight wins; a rolled max is kept without a new roll", () => {
    const t = combatSetup();
    // Fight 1: Elite rolled (its HP roll logged), then hurt.
    t.s.db.$client.run(
      "update entity set stat_block = json_set(stat_block, '$.hpFormula', '2d8+6') where id = ?",
      [t.eliteId],
    );
    const f1 = encounterOf(t, "F1", [{ definitionId: t.eliteId, quantity: 1, hpMode: "rolled" }]);
    start(t, f1);
    // A rolled max well above the average (15), so a carried max must not be taken for an edit.
    const first = t.combatants(f1.id)[0] as CombatantRecord;
    t.s.db.$client.run("update combatant set hp_max = 21, hp_current = 21 where id = ?", [
      first.id,
    ]);
    const rolled = t.combatants(f1.id)[0] as CombatantRecord;
    t.run(applyHp.name, { combatantId: rolled.id, kind: "damage", amount: 2 });
    t.run(endCommand.name, { encounterId: f1.id });
    const f2 = encounterOf(t, "F2", [{ definitionId: t.eliteId, quantity: 1, hpMode: "rolled" }]);
    start(t, f2);
    const again = t.combatants(f2.id)[0];
    expect(again).toMatchObject({
      hpMax: rolled.hpMax,
      hpCurrent: (rolled.hpCurrent ?? 0) - 2,
    });
    expect(hpRolls(t, f2.id)).toEqual([]);
    // Fight 3 after fight 2 ended at another value: fight 2's row wins.
    t.run(applyHp.name, { combatantId: again?.id as string, kind: "damage", amount: 1 });
    t.run(endCommand.name, { encounterId: f2.id });
    const f3 = encounterOf(t, "F3", [{ definitionId: t.eliteId, quantity: 1 }]);
    start(t, f3);
    expect(t.combatants(f3.id)[0]).toMatchObject({ hpMax: 21, hpCurrent: 18 });
  });

  test("FR-CBT-141 kept HP at Start: a definition max edited between fights follows FR-CBT-06 (full → new max, else clamped)", () => {
    const t = combatSetup();
    // Elite (average 15) ends hurt at 12 / 15; a second Elite token ends full.
    const enc = t.createAmbush();
    start(t, enc);
    const elite = t.byName(enc.id)["Elite Goblin Warrior"] as CombatantRecord;
    t.run(applyHp.name, { combatantId: elite.id, kind: "damage", amount: 3 });
    t.run(endCommand.name, { encounterId: enc.id });
    t.run(UPDATE, {
      id: t.eliteId,
      name: "Elite Goblin Warrior",
      statBlock: { ...eliteBlock, hpMax: 10 },
    });
    const next = encounterOf(t, "After edit", [{ definitionId: t.eliteId, quantity: 1 }]);
    start(t, next);
    expect(t.combatants(next.id)[0]).toMatchObject({ hpMax: 10, hpCurrent: 10 });
    t.run(endCommand.name, { encounterId: next.id });
    t.run(UPDATE, {
      id: t.eliteId,
      name: "Elite Goblin Warrior",
      statBlock: { ...eliteBlock, hpMax: 20 },
    });
    const third = encounterOf(t, "Grown", [{ definitionId: t.eliteId, quantity: 1 }]);
    start(t, third);
    // 10 / 10 was full → the new max.
    expect(t.combatants(third.id)[0]).toMatchObject({ hpMax: 20, hpCurrent: 20 });
  });

  test("FR-CBT-141 kept HP at Start: a hurt average row clamps to a lowered max", () => {
    const t = combatSetup();
    const enc = t.createAmbush();
    start(t, enc);
    const elite = t.byName(enc.id)["Elite Goblin Warrior"] as CombatantRecord;
    t.run(applyHp.name, { combatantId: elite.id, kind: "damage", amount: 2 });
    t.run(endCommand.name, { encounterId: enc.id });
    t.run(UPDATE, {
      id: t.eliteId,
      name: "Elite Goblin Warrior",
      statBlock: { ...eliteBlock, hpMax: 9 },
    });
    const next = encounterOf(t, "Lowered", [{ definitionId: t.eliteId, quantity: 1 }]);
    start(t, next);
    expect(t.combatants(next.id)[0]).toMatchObject({ hpMax: 9, hpCurrent: 9 });
  });

  test("FR-CBT-141 kept HP at Start: Add (combat-extras) binding an old token keeps its HP; picker items take the living token first", () => {
    const t = combatSetup();
    foughtAmbush(t, { Goblin: 7, "Goblin 2": 3 });
    const next = encounterOf(t, "Wolves", [{ definitionId: t.h.wolfId, quantity: 1 }]);
    start(t, next);
    const before = hpRows(t);
    t.run(CBTX_INTENTS.addCombatants, {
      encounterId: next.id,
      items: [{ definitionId: t.h.goblinId, quantity: 1 }],
    });
    const added = t.combatants(next.id).find((c) => c.entityId === t.h.goblinId);
    expect(added).toMatchObject({ tokenId: t.tokens.goblin2, hpCurrent: 4, hpMax: 7 });
    t.run(CBTX_INTENTS.addCombatants, {
      encounterId: next.id,
      items: [{ tokenId: t.tokens.goblin }],
    });
    const down = t.combatants(next.id).find((c) => c.tokenId === t.tokens.goblin);
    expect(down).toMatchObject({ hpCurrent: 0, hpMax: 7 });
    expect(hpRows(t)).toBe(before);
  });
});

describe("FR-CBT-141 pets and PCs unchanged", () => {
  test("FR-CBT-141 kept HP at Start: pets keep the pet's HP (FR-CBT-109), PCs carry none", () => {
    const t = cpSetup();
    t.run(applyHp.name, { combatantId: t.id("Owlbear"), kind: "damage", amount: 9 });
    t.endEncounter();
    const owlbearHp = t.entityRow(t.owlbear).hpCurrent;
    // The pet heals between fights; its row must not win over the pet.
    t.run(PET_ADJUST_HP, { petId: t.owlbear, delta: 4 });
    const pet = t.entityRow(t.owlbear).hpCurrent;
    const next = t.run<EncounterRecord>(createEncounter.name, {
      name: "Again",
      partyCharacterIds: null,
      entries: [],
    });
    t.run(startCommand.name, {
      encounterId: next.id,
      sceneId: t.sceneId,
      petIds: [t.owlbear],
    });
    const by = t.byName(next.id);
    expect(owlbearHp).toBe(50);
    expect(by.Owlbear?.hpCurrent).toBe(pet);
    expect(by.Mira?.hpCurrent ?? null).toBeNull();
  });
});
