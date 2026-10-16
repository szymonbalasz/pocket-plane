import { describe, expect, test } from "bun:test";
import { CONDITION_INFO, CONDITIONS, INCAPACITATING_CONDITIONS } from "./conditions";
import { deathStateOf } from "./rules";
import {
  DeathCounters,
  type EffectRecord,
  EffectRecord as EffectSchema,
  effectVisibleToPlayers,
  PlayerEffectRecord,
  redactEffect,
} from "./schemas";

const bless: EffectRecord = {
  id: "fx-1",
  campaignId: "c1",
  seq: 1,
  kind: "custom",
  condition: null,
  level: null,
  label: "Bless",
  targetCombatantId: null,
  targetCharacterId: "mira",
  encounterId: "enc-1",
  sourceCombatantId: "k-mira",
  sourceName: "Mira",
  concentrationId: "fx-0",
  durationRounds: 10,
  endsRound: 11,
  anchorCombatantId: "k-mira",
  secret: false,
  hidden: false,
  endedAt: null,
  endedReason: null,
  endedRound: null,
  endedTurnId: null,
  endedByHpChangeId: null,
  modifiers: [],
  presetKey: null,
  createdAt: "t",
  updatedAt: "t",
};

/** The same effect on a monster's combatant. */
const onGoblin: EffectRecord = { ...bless, targetCharacterId: null, targetCombatantId: "k-gob" };
const blessDie = { kind: "dice", on: { roll: "attack" }, dice: "1d4", sign: 1 } as const;

const WHITELIST = [
  "id",
  "kind",
  "condition",
  "level",
  "label",
  "targetCombatantId",
  "targetCharacterId",
  "encounterId",
  "endsRound",
];

const roundTrip = (s: { parse(v: unknown): unknown }, v: unknown) =>
  expect(s.parse(JSON.parse(JSON.stringify(v)))).toEqual(v);

describe("combat-extras shared schemas", () => {
  test("FR-CBTX-03 15 conditions incl. exhaustion, each with a name and a one-line reminder", () => {
    expect(CONDITIONS).toHaveLength(15);
    expect(CONDITIONS).toContain("exhaustion");
    for (const k of CONDITIONS) {
      expect(CONDITION_INFO[k].name.length).toBeGreaterThan(0);
      expect(CONDITION_INFO[k].reminder).not.toContain("\n");
    }
    expect([...INCAPACITATING_CONDITIONS].sort()).toEqual([
      "incapacitated",
      "paralysed",
      "petrified",
      "stunned",
      "unconscious",
    ]);
  });

  test("FR-CBTX-03 effect record round-trips; kind / condition / level / label / target rules", () => {
    roundTrip(EffectSchema, bless);
    const ok = (p: Partial<EffectRecord>) => EffectSchema.safeParse({ ...bless, ...p }).success;
    const cond = { kind: "condition" as const, label: null };
    expect(ok({ ...cond, condition: "prone" })).toBe(true);
    expect(ok({ ...cond, condition: "exhaustion", level: 6 })).toBe(true);
    expect(ok({ ...cond, condition: "exhaustion", level: 7 })).toBe(false);
    expect(ok({ ...cond, condition: "exhaustion", level: null })).toBe(false);
    expect(ok({ ...cond, condition: "prone", level: 2 })).toBe(false);
    expect(ok({ ...cond, condition: null })).toBe(false);
    expect(ok({ ...cond, condition: "dazed" as never })).toBe(false);
    expect(ok({ condition: "prone" })).toBe(false);
    expect(ok({ label: null })).toBe(false);
    expect(ok({ label: "x".repeat(41) })).toBe(false);
    expect(ok({ kind: "concentration", label: "Bless", concentrationId: null })).toBe(true);
    expect(ok({ targetCombatantId: "k1" })).toBe(false);
    expect(ok({ targetCharacterId: null })).toBe(false);
    expect(ok({ targetCharacterId: null, targetCombatantId: "k1" })).toBe(true);
    expect(ok({ durationRounds: 101 })).toBe(false);
    expect(ok({ endedAt: "t" })).toBe(false);
    expect(ok({ endedAt: "t", endedReason: "expired", endedRound: 11, endedTurnId: "k" })).toBe(
      true,
    );
    expect(ok({ endedReason: "fizzled" as never, endedAt: "t" })).toBe(false);
  });

  test("FR-CBTX-31 player redaction: whitelisted fields only; secret, hidden, ended never sent", () => {
    const red = redactEffect(bless);
    expect(Object.keys(red).sort()).toEqual([...WHITELIST, "modifiers", "presetKey"].sort());
    expect(Object.keys(redactEffect(onGoblin)).sort()).toEqual([...WHITELIST].sort());
    roundTrip(PlayerEffectRecord, red);
    const json = JSON.stringify(red);
    for (const leak of ["sourceCombatantId", "anchorCombatantId", "concentrationId", "k-mira"]) {
      expect(json).not.toContain(leak);
    }
    expect(effectVisibleToPlayers(bless)).toBe(true);
    expect(effectVisibleToPlayers({ ...bless, secret: true })).toBe(false);
    expect(effectVisibleToPlayers({ ...bless, hidden: true })).toBe(false);
    expect(effectVisibleToPlayers({ ...bless, endedAt: "t", endedReason: "removed" })).toBe(false);
  });

  test("FR-MOD-03 modifiers and presetKey on custom effects only; bounds per FR-MOD-01", () => {
    const ok = (p: Partial<EffectRecord>) => EffectSchema.safeParse({ ...bless, ...p }).success;
    expect(ok({ modifiers: [blessDie], presetKey: "bless" })).toBe(true);
    expect(ok({ modifiers: Array(6).fill(blessDie) })).toBe(true);
    expect(ok({ modifiers: Array(7).fill(blessDie) })).toBe(false);
    expect(ok({ presetKey: "x".repeat(41) })).toBe(false);
    expect(ok({ presetKey: "" })).toBe(false);
    // Tier 2 kinds are built (FR-MOD-01, R1); an AC part is still bounded.
    expect(ok({ modifiers: [{ kind: "flat", on: { roll: "ac" }, value: 2 }] as never })).toBe(true);
    expect(ok({ modifiers: [{ kind: "flat", on: { roll: "ac" }, value: 11 }] as never })).toBe(
      false,
    );
    const cond = { kind: "condition" as const, label: null, condition: "prone" as const };
    expect(ok(cond)).toBe(true);
    expect(ok({ ...cond, modifiers: [blessDie] })).toBe(false);
    expect(ok({ ...cond, presetKey: "bless" })).toBe(false);
    expect(ok({ kind: "concentration", modifiers: [blessDie] })).toBe(false);
    expect(ok({ kind: "concentration", presetKey: "bless" })).toBe(false);
  });

  test("FR-MOD-21 PC effects carry modifiers + built-in presetKey to players; monster effects neither; ids → null", () => {
    const pc = { ...bless, modifiers: [blessDie], presetKey: "bless" };
    expect(redactEffect(pc)).toMatchObject({ modifiers: [blessDie], presetKey: "bless" });
    const fromCampaign = redactEffect({ ...pc, presetKey: "0d2c-campaign-preset-id" });
    expect(fromCampaign.presetKey).toBeNull();
    expect(JSON.stringify(fromCampaign)).not.toContain("0d2c-campaign-preset-id");
    const bane = { ...onGoblin, label: "Bane", modifiers: [{ ...blessDie, sign: -1 as const }] };
    const monster = redactEffect({ ...bane, presetKey: "bane" });
    expect("modifiers" in monster).toBe(false);
    expect("presetKey" in monster).toBe(false);
    expect(JSON.stringify(monster)).not.toContain("1d4");
    roundTrip(PlayerEffectRecord, redactEffect(pc));
    roundTrip(PlayerEffectRecord, monster);
    // A player record never carries a preset id.
    expect(PlayerEffectRecord.safeParse({ ...redactEffect(pc), presetKey: "pr-1" }).success).toBe(
      false,
    );
  });

  test("FR-CBTX-19 deathState: dead at 3 failures, stable at 0 HP + 3 successes, dying at 0 HP", () => {
    expect(deathStateOf(5, 0, 0)).toBeNull();
    expect(deathStateOf(0, 0, 0)).toBe("dying");
    expect(deathStateOf(0, 2, 2)).toBe("dying");
    expect(deathStateOf(0, 3, 0)).toBe("stable");
    expect(deathStateOf(0, 3, 3)).toBe("dead");
    expect(deathStateOf(0, 0, 3)).toBe("dead");
    expect(deathStateOf(4, 0, 3)).toBe("dead");
  });

  test("FR-CBTX-21 death counters: 0–3 each, strict", () => {
    roundTrip(DeathCounters, { successes: 1, failures: 2 });
    expect(DeathCounters.safeParse({ successes: 4, failures: 0 }).success).toBe(false);
    expect(DeathCounters.safeParse({ successes: 0, failures: 0, hp: 1 }).success).toBe(false);
  });
});
