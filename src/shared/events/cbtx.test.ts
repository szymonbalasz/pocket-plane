// combat-extras events (CBTX §9): registered, logged, not undoable; schemas round-trip; the
// HP events gain optional temp / death / card fields (FR-CBTX-21).
import { describe, expect, test } from "bun:test";
import { CharacterHpAdjusted } from "./character-sheet";
import {
  CombatantsAdded,
  ConcentrationRolled,
  ConcentrationSet,
  DeathSaveRolled,
  DeathSavesSet,
  EffectsAdded,
  EffectsEnded,
  EffectUpdated,
  TempHpSet,
} from "./combat-extras";
import { AttackApplied, HpApplied } from "./combat-tracker";
import { domainEvents } from "./index";

const CBTX_EVENTS = [
  "EffectsAdded",
  "EffectUpdated",
  "EffectsEnded",
  "ConcentrationSet",
  "TempHpSet",
  "ConcentrationRolled",
  "DeathSaveRolled",
  "DeathSavesSet",
  "CombatantsAdded",
];

const roundTrip = (s: { parse(v: unknown): unknown }, v: unknown) =>
  expect(s.parse(JSON.parse(JSON.stringify(v)))).toEqual(v);

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
  applied: 1,
  overkill: 0,
  hpBefore: 7,
  hpAfter: 6,
};

describe("CBTX domain events (§9)", () => {
  test("CBTX §9 all 9 events registered once, logged, none undoable", () => {
    const defs = domainEvents.filter((e) => CBTX_EVENTS.includes(e.type));
    expect(defs.map((e) => e.type).sort()).toEqual([...CBTX_EVENTS].sort());
    expect(defs.every((e) => e.logged && !e.undoable)).toBe(true);
    const types = domainEvents.map((e) => e.type);
    expect(new Set(types).size).toBe(types.length);
  });

  test("FR-CBTX-04/08/09 effect events round-trip; strict; reason from the ended-reason list", () => {
    roundTrip(EffectsAdded.payload, { effectIds: ["x1", "x2", "x3"] });
    roundTrip(EffectUpdated.payload, { effectId: "x1" });
    roundTrip(EffectsEnded.payload, { effectIds: ["x1", "x2"], reason: "removed" });
    roundTrip(ConcentrationSet.payload, { effectId: "x4" });
    roundTrip(ConcentrationSet.payload, { effectId: "x4", replacedId: "x1" });
    expect(EffectsAdded.payload.safeParse({ effectIds: [] }).success).toBe(false);
    expect(EffectsEnded.payload.safeParse({ effectIds: ["x"], reason: "gone" }).success).toBe(
      false,
    );
    expect(EffectUpdated.payload.safeParse({ effectId: "x", label: "Hex" }).success).toBe(false);
  });

  test("FR-CBTX-14 TempHpSet: combatant or character, 0–999", () => {
    const p = { targetKind: "combatant", targetId: "k", before: 0, after: 5 };
    roundTrip(TempHpSet.payload, p);
    roundTrip(TempHpSet.payload, { ...p, targetKind: "character" });
    expect(TempHpSet.payload.safeParse({ ...p, after: 1000 }).success).toBe(false);
    expect(TempHpSet.payload.safeParse({ ...p, targetKind: "token" }).success).toBe(false);
  });

  test("FR-CBTX-18/23/24 roll and death-save events round-trip; counters 0–3; natural 1–20", () => {
    roundTrip(ConcentrationRolled.payload, {
      notificationId: "n",
      effectId: "x",
      rollIds: ["r"],
      entryId: "g",
      total: 12,
      dc: 10,
      success: true,
    });
    const death = {
      characterId: "mira",
      rollIds: ["r"],
      entryId: "g",
      natural: 1,
      before: { successes: 1, failures: 0 },
      after: { successes: 1, failures: 2 },
    };
    roundTrip(DeathSaveRolled.payload, death);
    expect(DeathSaveRolled.payload.safeParse({ ...death, natural: 21 }).success).toBe(false);
    roundTrip(DeathSavesSet.payload, { characterId: "mira", successes: 3, failures: 0 });
    expect(
      DeathSavesSet.payload.safeParse({ characterId: "mira", successes: 4, failures: 0 }).success,
    ).toBe(false);
  });

  test("FR-CBTX-26 CombatantsAdded: 1–20 combatants", () => {
    roundTrip(CombatantsAdded.payload, { encounterId: "e", combatantIds: ["k1", "k2"] });
    expect(CombatantsAdded.payload.safeParse({ encounterId: "e", combatantIds: [] }).success).toBe(
      false,
    );
  });

  test("FR-CBTX-21 AttackApplied / HpApplied facts: old payloads parse; temp / death / noteIds round-trip", () => {
    expect(AttackApplied.payload.safeParse(facts).success).toBe(true);
    const cbtx = {
      ...facts,
      tempBefore: 3,
      tempAfter: 0,
      deathBefore: null,
      deathAfter: { successes: 0, failures: 1 },
      noteIds: ["n1"],
    };
    roundTrip(AttackApplied.payload, cbtx);
    roundTrip(HpApplied.payload, cbtx);
    expect(HpApplied.payload.safeParse({ ...cbtx, deathAfter: { failures: 1 } }).success).toBe(
      false,
    );
  });

  test("FR-CBTX-02/21 CharacterHpAdjusted gains optional temp / death / noteIds", () => {
    const base = { entityId: "mira", delta: -5, hpBefore: 3, hpAfter: 0 };
    roundTrip(CharacterHpAdjusted.payload, base);
    roundTrip(CharacterHpAdjusted.payload, {
      ...base,
      tempBefore: 2,
      tempAfter: 0,
      deathBefore: { successes: 0, failures: 0 },
      deathAfter: { successes: 0, failures: 1 },
      noteIds: [],
    });
    expect(CharacterHpAdjusted.payload.safeParse({ ...base, tempHp: 2 }).success).toBe(false);
  });
});
