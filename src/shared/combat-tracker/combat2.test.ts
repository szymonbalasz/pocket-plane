// Sprint-2 P2a zod (fix/combat2-core): encounter options, Start options, split attack / damage
// intents, partial damage cards. Old payloads keep parsing (defaults).
import { describe, expect, test } from "bun:test";
import {
  ApplyCardTargetsInput,
  AttackInput,
  CBT_INTENTS,
  DamageCardPayload,
  EncounterBody,
  EncounterEntryRecord,
  EncounterRecord,
  isFullCard,
  parseFullCard,
  RollDamageInput,
  RollDamageResult,
  StartInput,
} from "./schemas";

const roll = { rollId: "r", dice: [[4, true]], constant: 3, total: 7, manual: false };
const card = {
  encounterId: "e",
  attackerId: "k",
  attackerName: "Mira",
  attackName: "Light crossbow",
  damageType: "piercing",
  mode: "normal",
  crit: false,
  toHit: { ...roll, natural: 4 },
  damage: roll,
};
const ok = (s: { safeParse(v: unknown): { success: boolean } }, v: unknown) =>
  s.safeParse(v).success;

describe("FR-CBT-62 encounter options", () => {
  test("REST body: createTokens / addHidden / entry hpMode optional; bad values invalid", () => {
    const body = {
      name: "Ambush",
      partyCharacterIds: null,
      entries: [{ definitionId: "g", quantity: 2 }],
    };
    expect(ok(EncounterBody, body)).toBe(true);
    expect(
      ok(EncounterBody, {
        ...body,
        createTokens: false,
        addHidden: true,
        entries: [{ definitionId: "g", quantity: 2, hpMode: "rolled" }],
      }),
    ).toBe(true);
    expect(
      ok(EncounterBody, { ...body, entries: [{ definitionId: "g", quantity: 1, hpMode: "max" }] }),
    ).toBe(false);
    expect(ok(EncounterBody, { ...body, createTokens: "yes" })).toBe(false);
  });

  test("records carry the DM-only fields", () => {
    expect(EncounterRecord.shape.createTokens).toBeDefined();
    expect(EncounterRecord.shape.addHidden).toBeDefined();
    expect(EncounterEntryRecord.shape.hpMode.options).toEqual(["average", "rolled"]);
  });
});

describe("FR-CBT-64 / -65 / -66 cbt.start options", () => {
  test("at {col,row} and excludeCharacterIds optional; old payload parses", () => {
    expect(ok(StartInput, { encounterId: "e", sceneId: "s" })).toBe(true);
    expect(
      ok(StartInput, {
        encounterId: "e",
        sceneId: "s",
        at: { col: 4, row: 7 },
        excludeCharacterIds: ["c"],
      }),
    ).toBe(true);
    expect(ok(StartInput, { encounterId: "e", sceneId: "s", at: { col: 1.5, row: 0 } })).toBe(
      false,
    );
    expect(ok(StartInput, { encounterId: "e", sceneId: "s", at: { col: 1 } })).toBe(false);
  });
});

describe("FR-CBT-70 / -71 split attack and damage", () => {
  test("cbt.attack rolls: both (default, 2 manual entries) | toHit (1 manual entry)", () => {
    expect(ok(AttackInput, { attackerId: "k" })).toBe(true);
    expect(ok(AttackInput, { attackerId: "k", rolls: "toHit" })).toBe(true);
    const two = [{ diceTotal: 15 }, { diceTotal: 6 }];
    expect(ok(AttackInput, { attackerId: "k", manual: two })).toBe(true);
    expect(ok(AttackInput, { attackerId: "k", rolls: "both", manual: two })).toBe(true);
    expect(ok(AttackInput, { attackerId: "k", manual: [{ diceTotal: 15 }] })).toBe(false);
    expect(ok(AttackInput, { attackerId: "k", rolls: "toHit", manual: [{ diceTotal: 15 }] })).toBe(
      true,
    );
    expect(ok(AttackInput, { attackerId: "k", rolls: "toHit", manual: two })).toBe(false);
    expect(ok(AttackInput, { attackerId: "k", rolls: "damage" })).toBe(false);
  });

  test("cbt.rollDamage {attackerId, manual?, attackId? | spellId?}; result {cardId, rollIds, attached}", () => {
    expect(CBT_INTENTS.rollDamage).toBe("cbt.rollDamage");
    expect(ok(RollDamageInput, { attackerId: "k" })).toBe(true);
    expect(ok(RollDamageInput, { attackerId: "k", attackId: "a", manual: { diceTotal: 6 } })).toBe(
      true,
    );
    expect(ok(RollDamageInput, { attackerId: "k", spellId: "s" })).toBe(true);
    expect(ok(RollDamageInput, { attackerId: "k", attackId: "a", spellId: "s" })).toBe(false);
    expect(ok(RollDamageInput, { attackerId: "k", mode: "advantage" })).toBe(false);
    expect(ok(RollDamageResult, { cardId: "n", rollIds: ["r"], attached: true })).toBe(true);
  });

  test("damage card: toHit / damage nullable, never both; attackId / spellId / saveDc optional; old rows parse", () => {
    expect(isFullCard(DamageCardPayload.parse(card))).toBe(true);
    expect(parseFullCard(card) as unknown).toEqual(DamageCardPayload.parse(card));
    const toHitOnly = DamageCardPayload.parse({ ...card, damage: null, attackId: "a" });
    expect(isFullCard(toHitOnly)).toBe(false);
    const damageOnly = { ...card, toHit: null, spellId: "s", saveDc: { dc: 13, ability: "dex" } };
    expect(ok(DamageCardPayload, damageOnly)).toBe(true);
    expect(() => parseFullCard(damageOnly)).toThrow();
    expect(ok(DamageCardPayload, { ...card, toHit: null, damage: null })).toBe(false);
    expect(ok(DamageCardPayload, { ...card, saveDc: { dc: 13 } })).toBe(false);
    expect(ok(DamageCardPayload, { ...card, extra: 1 })).toBe(false);
  });

  test("FR-CBT-72 cbt.applyCard totals optional on the wire (the server enforces the rule)", () => {
    const t = { targetId: "g", hit: false, multiplier: "normal" };
    // FR-CBT-94 (sprint 5): `damageRollId` (null = none yet) is required.
    const r = { damageRollId: null };
    expect(ok(ApplyCardTargetsInput, { cardId: "n", targets: [t], ...r })).toBe(true);
    expect(ok(ApplyCardTargetsInput, { cardId: "n", targets: [t] })).toBe(false);
    expect(
      ok(ApplyCardTargetsInput, {
        cardId: "n",
        toHitTotal: 15,
        damageTotal: 6,
        targets: [t],
        damageRollId: "r2",
      }),
    ).toBe(true);
    expect(ok(ApplyCardTargetsInput, { cardId: "n", damageTotal: 1000, targets: [t], ...r })).toBe(
      false,
    );
  });
});
