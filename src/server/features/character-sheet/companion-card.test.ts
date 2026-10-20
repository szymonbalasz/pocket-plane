// Sprint 6 CP4 (CHARX §13, CBT §13.3): the companion card's server paths. FR-CHARX-69 (a pet's
// owner rolls its attacks out of a fight, DM + owner only), FR-CHARX-64 (the card's three buttons
// in a fight send combat's intents as the companion), FR-CHARX-67 (what reaches whom),
// FR-CHARX-63 / FR-ENT-38 (the owner edits a pet on the card; other players gain nothing).
import { describe, expect, test } from "bun:test";
import { GAME_LOG_ENTRY_TYPE } from "@shared/dice-roll-log/schemas";
import { cpSetup } from "../combat-tracker/cp-testing";

type Row = Record<string, unknown>;

/** The pet's attack row id by name (pets get row ids at creation, FR-ENT-32). */
function petRow(t: ReturnType<typeof cpSetup>, petId: string, name: string): string {
  const pet = t.entityRow(petId);
  const id = pet.statBlock.attacks.find((a) => a.name === name)?.id;
  if (!id) throw new Error(`no row ${name}`);
  return id;
}

const entriesOf = (t: ReturnType<typeof cpSetup>, v: Parameters<typeof t.snap>[0]) =>
  t.snap(v, GAME_LOG_ENTRY_TYPE) as Row[];

describe("FR-CHARX-69 owner rolls own pet", () => {
  test("FR-CHARX-69 owner rolls own pet: DM + owner only; another's pet or a monster not_found; other kinds invalid", () => {
    const t = cpSetup({ start: false });
    const claws = petRow(t, t.owlbear, "Claws");
    const n = t.events.length;
    const r = t.run<{ entryId: string; rollIds: string[] }>(
      "char.roll",
      { characterId: t.owlbear, kind: "toHit", attackId: claws },
      t.p1,
    );
    const entry = t.logRows().find((e) => e.id === r.entryId);
    expect(entry).toMatchObject({
      public: false,
      audiencePlayerId: t.h.p1.id,
      actorName: "Owlbear",
    });
    // The owner's frames carry the line with its dice; player-2's nothing of it.
    const p1 = t.framesSince(n, t.p1V);
    const p2 = t.framesSince(n, t.p2V);
    expect(p1).toContain(r.entryId);
    expect(p2).not.toContain(r.entryId);
    expect(p2).not.toContain("Owlbear");
    expect(entriesOf(t, t.p1V).some((e) => e.id === r.entryId)).toBe(true);
    expect(entriesOf(t, t.p2V).some((e) => e.id === r.entryId)).toBe(false);
    // Damage and Attack + damage too (the event names the row).
    t.run("char.roll", { characterId: t.owlbear, kind: "damage", attackId: claws }, t.p1);
    expect(t.lastEvent()).toMatchObject({
      type: "CharacterRolled",
      payload: { characterId: t.owlbear, kind: "damage", attackName: "Claws" },
    });
    t.run("char.roll", { characterId: t.owlbear, kind: "attack", attackId: claws }, t.p1);
    // Player-2 rolls its own pet (the Drake); never player-1's.
    t.run(
      "char.roll",
      { characterId: t.drake, kind: "toHit", attackId: petRow(t, t.drake, "Bite") },
      t.p2,
    );
    const roll = (characterId: string, kind: string, actor = t.p1) =>
      t.err(() => t.run("char.roll", { characterId, kind, attackId: claws }, actor)).code;
    expect(roll(t.owlbear, "toHit", t.p2)).toBe("not_found");
    expect(roll(t.drake, "toHit")).toBe("not_found");
    // Every other monster stays not_found for players (a definition, a non-pet custom).
    expect(roll(t.h.goblinId, "toHit")).toBe("not_found");
    expect(roll(t.base, "toHit")).toBe("not_found");
    // A non-attack kind on an own pet → invalid.
    expect(
      t.err(() =>
        t.run("char.roll", { characterId: t.owlbear, kind: "save", ability: "dex" } as Row, t.p1),
      ).code,
    ).toBe("invalid");
    expect(
      t.err(() =>
        t.run("char.roll", { characterId: t.owlbear, kind: "skill", skill: "stealth" }, t.p1),
      ).code,
    ).toBe("invalid");
    // The DM's roll for the pet stays DM-only (FR-CHARX-22).
    const dm = t.run<{ entryId: string }>("char.roll", {
      characterId: t.owlbear,
      kind: "toHit",
      attackId: claws,
    });
    expect(t.logRows().find((e) => e.id === dm.entryId)).toMatchObject({
      public: false,
      audiencePlayerId: null,
    });
    expect(entriesOf(t, t.p1V).some((e) => e.id === dm.entryId)).toBe(false);
  });
});

describe("FR-CHARX-64 card rolls", () => {
  test("FR-CHARX-64 card rolls: in a fight the three buttons send combat's intents as the companion with the card row id", () => {
    const t = cpSetup();
    const ob = t.id("Owlbear");
    const card = t.combatantRow(ob).card;
    const clawsRow = card?.attacks.find((a) => a.name === "Claws");
    if (!clawsRow) throw new Error("no card row");
    // The card row id is the pet's own row id (stable, FR-CBT-117).
    expect(clawsRow.id).toBe(petRow(t, t.owlbear, "Claws"));
    const toHit = t.run<{ cardId: string }>(
      "cbt.attack",
      { attackerId: ob, attackId: clawsRow.id, rolls: "toHit", mode: "normal" },
      t.p1,
    );
    const damage = t.run<{ cardId: string }>(
      "cbt.rollDamage",
      { attackerId: ob, attackId: clawsRow.id },
      t.p1,
    );
    // FR-CBT-74: the Damage completes the row's pending to-hit-only card.
    expect(damage.cardId).toBe(toHit.cardId);
    const both = t.run<{ cardId: string }>(
      "cbt.attack",
      { attackerId: ob, attackId: clawsRow.id, mode: "normal" },
      t.p1,
    );
    expect(both.cardId).not.toBe(toHit.cardId);
    // Player-2 can't attack as the Owlbear; an attackId outside the card → not_found.
    expect(
      t.err(() =>
        t.run("cbt.attack", { attackerId: ob, attackId: clawsRow.id, mode: "normal" }, t.p2),
      ).code,
    ).toBe("forbidden");
    expect(
      t.err(() => t.run("cbt.attack", { attackerId: ob, attackId: "nope", mode: "normal" }, t.p1))
        .code,
    ).toBe("not_found");
  });
});

describe("FR-CHARX-67 card visibility", () => {
  test("FR-CHARX-67 card visibility: the owner has its pet rows and companion cards; player-2 none of it (leak scan)", () => {
    const t = cpSetup();
    const ob = t.id("Owlbear");
    // The owner: full pet row (no derivedFromId) and the combatant's card + HP.
    expect(t.playerEntity(t.p1V, t.owlbear)).toMatchObject({ statBlock: { ac: 13 } });
    expect(t.playerEntity(t.p1V, t.owlbear)).not.toHaveProperty("derivedFromId");
    expect(t.playerCombatant(t.p1V, ob)).toMatchObject({ card: { ac: 13 }, hpMax: 59 });
    // Player-2: the band only, no card, no stat block (snapshot + frames of an edit and a roll).
    const n = t.events.length;
    t.run("char.edit", { creatureId: t.owlbear, set: { ac: 14 } }, t.p1);
    t.run(
      "char.roll",
      { characterId: t.owlbear, kind: "attack", attackId: petRow(t, t.owlbear, "Beak") },
      t.p1,
    );
    // Player-2 owns the Drake (its own card is fine): scan the Owlbear's rows and its values.
    const p2Rows = JSON.stringify([
      t.playerCombatant(t.p2V, ob),
      t.playerEntity(t.p2V, t.owlbear),
      t.snap(t.p2V, GAME_LOG_ENTRY_TYPE),
    ]);
    const p2Frames = t.framesSince(n, t.p2V);
    for (const leak of ['"card"', '"statBlock"', '"ac"', '"hpMax"', '"hpCurrent"']) {
      expect(p2Rows).not.toContain(leak);
    }
    for (const leak of ["Claws", "Beak", "1d10+5", "2d8+5", '"ac":14']) {
      expect(p2Rows).not.toContain(leak);
      expect(p2Frames).not.toContain(leak);
    }
    expect(t.playerCombatant(t.p2V, ob)).toMatchObject({ band: expect.any(String) });
  });
});

describe("FR-CHARX-63 / FR-ENT-38 card edits", () => {
  test("FR-CHARX-63 owner edits a pet on the card: AC, HP max, speed and attack rows reach the card; summons and other fields refused", () => {
    const t = cpSetup();
    const ob = t.id("Owlbear");
    const claws = t.entityRow(t.owlbear).statBlock.attacks.find((a) => a.name === "Claws");
    const n = t.events.length;
    t.run("char.edit", { creatureId: t.owlbear, set: { ac: 14, speed: 30 } }, t.p1);
    t.run(
      "char.putRow",
      { creatureId: t.owlbear, list: "attacks", row: { ...(claws as Row), toHit: 8 } },
      t.p1,
    );
    const added = t.run<{ rowId: string }>(
      "char.putRow",
      { creatureId: t.owlbear, list: "attacks", row: { name: "Hug", toHit: 7, damage: "2d6" } },
      t.p1,
    );
    expect(t.combatantRow(ob).card?.attacks.map((a) => a.name)).toEqual(["Beak", "Claws", "Hug"]);
    t.run("char.deleteRow", { creatureId: t.owlbear, list: "attacks", rowId: added.rowId }, t.p1);
    const card = t.combatantRow(ob).card;
    expect(card).toMatchObject({ ac: 14, speed: 30 });
    // The card row keeps its id after a definition edit (FR-CHARX-60).
    expect(card?.attacks.find((a) => a.name === "Claws")).toMatchObject({
      id: claws?.id,
      toHit: 8,
    });
    // The owner's frames have the card; player-2's no AC or attack value.
    expect(t.framesSince(n, t.p1V)).toContain('"toHit":8');
    const p2 = t.framesSince(n, t.p2V);
    for (const leak of ['"ac"', '"toHit"', "Claws", "Hug", '"speed"']) {
      expect(p2).not.toContain(leak);
    }
    // A non-pet definition isn't player-editable (not_found); fields beyond the card's →
    // forbidden (FR-ENT-38).
    expect(t.err(() => t.run("char.edit", { creatureId: t.base, set: { ac: 9 } }, t.p1)).code).toBe(
      "not_found",
    );
    expect(
      t.err(() => t.run("char.edit", { creatureId: t.owlbear, set: { size: "huge" } }, t.p1)).code,
    ).toBe("forbidden");
  });
});

describe("FR-CHARX-61 owner view names its pet", () => {
  test("FR-CHARX-61 owner view names its pet: a pet combatant's entityId reaches its owner only; a summon's never", () => {
    const t = cpSetup();
    const ob = t.id("Owlbear");
    const drake = t.id("Drake");
    // The owner's view of its pet names the pet row; the DM's has it as always.
    expect(t.playerCombatant(t.p1V, ob)).toMatchObject({ entityId: t.owlbear, pet: true });
    expect(t.playerCombatant(t.p2V, drake)).toMatchObject({ entityId: t.drake, pet: true });
    // Other players never get it (snapshot and frames).
    expect(t.playerCombatant(t.p2V, ob)).not.toHaveProperty("entityId");
    expect(t.playerCombatant(t.p1V, drake)).not.toHaveProperty("entityId");
    // A summon (Goblin 2 made Mira's): its owner gets no definition id.
    const g2 = t.combatantNamed("Goblin 2");
    const n = t.events.length;
    t.setCompanion({ combatantId: g2.id, owner: t.owner(t.miraId) });
    expect(t.playerCombatant(t.p1V, g2.id)).toMatchObject({ ownerPlayerId: t.h.p1.id });
    expect(t.playerCombatant(t.p1V, g2.id)).not.toHaveProperty("entityId");
    t.run("char.edit", { creatureId: t.owlbear, set: { ac: 15 } }, t.p1);
    expect(t.framesSince(n, t.p2V)).not.toContain(`"entityId":"${t.owlbear}"`);
    expect(t.framesSince(n, t.p1V)).toContain(`"entityId":"${t.owlbear}"`);
    expect(t.framesSince(n, t.p1V)).not.toContain(`"entityId":"${g2.entityId}"`);
  });
});
