import { expect, test } from "bun:test";
import { CharacterRolled } from "./character-sheet";
import { AttackApplied, CombatantRolled, DAMAGE_MULTIPLIERS } from "./combat-tracker";
import { ROLL_CATEGORIES } from "./dice-roll-log";
import { domainEvents } from "./index";

const COMBAT_EVENTS = [
  "DiceRolled",
  "PublicLogCategorySet",
  "CharacterHpAdjusted",
  "CharacterRolled",
  "NotificationCreated",
  "NotificationResolved",
  "NotificationDismissed",
  "NotificationReopened",
  "NotificationUpdated",
  "EncounterCreated",
  "EncounterUpdated",
  "EncounterDeleted",
  "EncounterStarted",
  "EncounterEnded",
  "InitiativeRolled",
  "InitiativeSet",
  "TurnChanged",
  "CombatantRemoved",
  "CombatantRestored",
  "AttackRolled",
  "DamageRolled",
  "AttackApplied",
  "HpApplied",
  "CombatEntryUndone",
  "CombatantRolled",
];

test("protocol §22: every Combat event registered once, all logged; undoable = AttackApplied, HpApplied only", () => {
  const types = domainEvents.map((e) => e.type);
  expect(new Set(types).size).toBe(types.length);
  const combat = domainEvents.filter((e) => COMBAT_EVENTS.includes(e.type));
  expect(combat.map((e) => e.type).sort()).toEqual([...COMBAT_EVENTS].sort());
  expect(combat.every((e) => e.logged)).toBe(true);
  expect(combat.filter((e) => e.undoable).map((e) => e.type)).toEqual([
    "AttackApplied",
    "HpApplied",
  ]);
});

test("protocol §22: payloads are strict zod (no link tokens or extras slip into the event log)", () => {
  const facts = {
    hpChangeId: "h",
    encounterId: "e",
    kind: "damage",
    source: "direct",
    cardId: null,
    rollIds: [],
    attackerId: null,
    attackerName: null,
    attackName: null,
    damageType: null,
    targetId: "k",
    targetEntityId: "g",
    targetName: "Goblin",
    targetAc: 15,
    toHitRolled: null,
    toHitTotal: null,
    natural: null,
    hitComputed: null,
    hit: null,
    damageRolled: null,
    damageTotal: 4,
    multiplier: null,
    raw: 4,
    applied: 4,
    overkill: 0,
    hpBefore: 7,
    hpAfter: 3,
  };
  expect(AttackApplied.payload.safeParse(facts).success).toBe(true);
  expect(AttackApplied.payload.safeParse({ ...facts, linkToken: "x" }).success).toBe(false);
  expect(ROLL_CATEGORIES).toHaveLength(9);
  expect(DAMAGE_MULTIPLIERS).toEqual(["normal", "half", "none", "double"]);
});

test("protocol §22 feedback: CharacterRolled kind + check / save, ability?; CombatantRolled", () => {
  const base = { characterId: "c", mode: "normal", manual: false, rollIds: ["r"], entryId: "e" };
  const ok = (p: object) => CharacterRolled.payload.safeParse({ ...base, ...p }).success;
  expect(ok({ kind: "attack", attackName: "Sword" })).toBe(true);
  expect(ok({ kind: "check", ability: "dex" })).toBe(true);
  expect(ok({ kind: "save", ability: "wis" })).toBe(true);
  expect(ok({ kind: "save", ability: "luck" })).toBe(false);
  expect(ok({ kind: "skill", ability: "dex" })).toBe(false);

  const rolled = {
    encounterId: "enc",
    combatantId: "k",
    kind: "save",
    ability: "dex",
    rollIds: ["r"],
    entryId: "e",
  };
  expect(CombatantRolled.payload.safeParse(rolled).success).toBe(true);
  expect(CombatantRolled.payload.safeParse({ ...rolled, kind: "attack" }).success).toBe(false);
  expect(CombatantRolled.payload.safeParse({ ...rolled, ability: undefined }).success).toBe(false);
  expect(CombatantRolled.payload.safeParse({ ...rolled, public: true }).success).toBe(false);
});
