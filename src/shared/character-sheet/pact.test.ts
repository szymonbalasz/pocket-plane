// Pact slots (class-resources FR-CRES-01–03), pure: the stat-block field's bounds, the counter's
// read / write / clamp, and both rests setting `pactUsed` to 0.
import { describe, expect, test } from "bun:test";
import { Spellcasting } from "@shared/entities/schemas";
import { clampCounters, counterOf, pactMax, withUsed } from "./counters";
import { REST_TEXT, type RestState, restOutcome } from "./rest";

const stats = {
  hpMax: 40,
  spellcasting: { ability: "cha" as const, slots: { "1": 4 }, pact: { level: 1, slots: 2 } },
  classes: [{ name: "Warlock", level: 2, hitDie: "d8" as const }],
};
const sheet = { slotsUsed: { "1": 3 }, hitDiceUsed: {}, features: [], pactUsed: 2 };

describe("FR-CRES-01 pact field", () => {
  test("FR-CRES-01 spellcasting.pact: level 1–5, 1–4 slots, optional", () => {
    const ok = (pact: unknown) =>
      Spellcasting.safeParse({ ability: "cha", slots: {}, ...(pact ? { pact } : {}) }).success;
    expect(ok(undefined)).toBe(true);
    expect(ok({ level: 5, slots: 4 })).toBe(true);
    expect(ok({ level: 6, slots: 1 })).toBe(false);
    expect(ok({ level: 1, slots: 0 })).toBe(false);
    expect(ok({ level: 1 })).toBe(false);
  });
});

describe("FR-CRES-02 pact counter", () => {
  test("FR-CRES-02 counterOf / withUsed / clamp", () => {
    expect(pactMax(stats)).toBe(2);
    expect(pactMax({})).toBe(0);
    expect(counterOf(sheet, stats, { pact: true })).toEqual({ used: 2, max: 2, cap: 2 });
    expect(withUsed(sheet, { pact: true }, 1).pactUsed).toBe(1);
    expect(withUsed(sheet, { pact: true }, 1).slotsUsed).toEqual({ "1": 3 });
    const one = { spellcasting: { ...stats.spellcasting, pact: { level: 1, slots: 1 } } };
    expect(clampCounters(sheet, one).pactUsed).toBe(1);
    expect(clampCounters(sheet, {}).pactUsed).toBe(0);
  });
});

describe("FR-CRES-03 rests", () => {
  const s: RestState = { hpCurrent: 10, tempHp: 0, deathSuccesses: 0, deathFailures: 0, sheet };

  test("FR-CRES-03 short rest: pact 0, slots kept; long rest: both 0", () => {
    const short = restOutcome("short", s, stats);
    expect(short.sheet.pactUsed).toBe(0);
    expect(short.sheet.slotsUsed).toEqual({ "1": 3 });
    const long = restOutcome("long", s, stats);
    expect(long.sheet.pactUsed).toBe(0);
    expect(long.sheet.slotsUsed).toEqual({});
  });

  test("FR-CRES-03 the short-rest confirm names pact slots", () => {
    expect(REST_TEXT.short).toContain("pact slots");
  });
});
