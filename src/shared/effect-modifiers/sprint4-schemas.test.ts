// Sprint-4 track R zod (S4-0, MOD §14.3): the weapon row (FR-CHARX-54), the card's extra damage
// parts (FR-CBT-81), the apply input per part (FR-CBT-82), the outcome line's parts (FR-CBT-84,
// FR-MOD-57), the feature-use floor (FR-CHARX-58) and the toggle's `overspend` (FR-MOD-59).
// Old rows parse unchanged.
import { describe, expect, test } from "bun:test";
import { CharPutRowIntent, FeatureRow } from "@shared/character-sheet/sheet";
import { AttackLogDmPayload, AttackLogPayload } from "@shared/combat-tracker/log-kinds";
import {
  ApplyCardTargetsInput,
  CardDamage,
  DamageCardPayload,
} from "@shared/combat-tracker/schemas";
import { Attack, Attacks } from "@shared/entities/schemas";
import { ToggleInput } from "./intents";

const greataxe = { id: "a1", name: "Greataxe", toHit: 7, damage: "1d12+4", damageType: "slashing" };
const flameTongue = {
  id: "a2",
  name: "Flame Tongue greatsword",
  toHit: 7,
  damage: "2d6+4",
  damageType: "slashing",
  bonus: 1,
  extraDamage: [{ damage: "2d6", type: "fire" }],
};

describe("FR-CHARX-54 weapon row", () => {
  test("FR-CHARX-54 weapon row schema: bonus 0–3, extraDamage 0–2 typed parts 1d4…6d12+10; old rows parse", () => {
    const ok = (row: unknown) => Attack.safeParse(row).success;
    expect(Attack.parse(greataxe) as unknown).toEqual(greataxe);
    expect(Attack.parse(flameTongue) as unknown).toEqual(flameTongue);
    for (const bonus of [0, 1, 2, 3]) expect(ok({ ...greataxe, bonus })).toBe(true);
    for (const bonus of [-1, 4, 1.5]) expect(ok({ ...greataxe, bonus })).toBe(false);
    const extra = (...damage: string[]) => ({
      ...greataxe,
      extraDamage: damage.map((d) => ({ damage: d, type: "fire" })),
    });
    for (const d of ["1d4", "1d6", "2d6", "6d12+10", "3d8+0", "4d10+7"]) {
      expect(ok(extra(d))).toBe(true);
    }
    for (const d of ["7d6", "0d6", "1d20", "1d100", "2d6+11", "2d6-1", "d6", "2d6+1d4", ""]) {
      expect(ok(extra(d))).toBe(false);
    }
    expect(ok(extra())).toBe(true);
    expect(ok(extra("1d6", "1d8"))).toBe(true);
    expect(ok(extra("1d6", "1d8", "1d4"))).toBe(false);
    // An extra part is typed (it exists to carry a second type).
    expect(ok({ ...greataxe, extraDamage: [{ damage: "2d6" }] })).toBe(false);
    expect(ok({ ...greataxe, extraDamage: [{ damage: "2d6", type: "holy" }] })).toBe(false);
    expect(ok({ ...greataxe, extraDamage: [{ damage: "2d6", type: "fire", x: 1 }] })).toBe(false);
    // Both kinds' lists and the sheet's row intent carry the fields.
    expect(Attacks.safeParse([greataxe, flameTongue]).success).toBe(true);
    expect(
      CharPutRowIntent.safeParse({ creatureId: "c", list: "attacks", row: flameTongue }).success,
    ).toBe(true);
  });
});

const roll = {
  rollId: "r1",
  dice: [
    [3, true],
    [5, true],
  ],
  constant: 5,
  total: 13,
  manual: false,
};
const fire = {
  type: "fire",
  rollId: "r2",
  dice: [
    [2, true],
    [6, true],
  ],
  constant: 0,
  total: 8,
  manual: false,
};

describe("FR-CBT-81 / -82 / -84 combat parts", () => {
  test("FR-CBT-81 card damage.extra: ≤ 2 typed parts, ≤ 12 dice each (6 doubled); old cards parse", () => {
    expect(CardDamage.parse(roll) as unknown).toEqual(roll);
    expect(CardDamage.parse({ ...roll, extra: [fire] }) as unknown).toEqual({
      ...roll,
      extra: [fire],
    });
    expect(CardDamage.safeParse({ ...roll, extra: [fire, fire] }).success).toBe(true);
    expect(CardDamage.safeParse({ ...roll, extra: [fire, fire, fire] }).success).toBe(false);
    expect(CardDamage.safeParse({ ...roll, extra: [] }).success).toBe(false);
    expect(CardDamage.safeParse({ ...roll, extra: [{ ...fire, type: null }] }).success).toBe(false);
    const dice = (n: number) => Array.from({ length: n }, () => [6, true]);
    expect(CardDamage.safeParse({ ...roll, extra: [{ ...fire, dice: dice(12) }] }).success).toBe(
      true,
    );
    expect(CardDamage.safeParse({ ...roll, extra: [{ ...fire, dice: dice(13) }] }).success).toBe(
      false,
    );
    const card = {
      encounterId: "e",
      attackerId: "k",
      attackerName: "Brakka",
      attackName: "Flame Tongue greatsword",
      damageType: "slashing",
      mode: "normal",
      crit: false,
      toHit: null,
      damage: { ...roll, extra: [fire] },
    };
    expect(DamageCardPayload.safeParse(card).success).toBe(true);
  });

  test("FR-CBT-82 apply input: extraTotals 0–999 and per-target extraMultipliers, ≤ 2 each; absent as before", () => {
    const base = { cardId: "n", targets: [{ targetId: "g", hit: true, multiplier: "normal" }] };
    const ok = (v: unknown) => ApplyCardTargetsInput.safeParse(v).success;
    expect(ok(base)).toBe(true);
    expect(ok({ ...base, extraTotals: [8] })).toBe(true);
    expect(ok({ ...base, extraTotals: [8, 0] })).toBe(true);
    expect(ok({ ...base, extraTotals: [1000] })).toBe(false);
    expect(ok({ ...base, extraTotals: [-1] })).toBe(false);
    expect(ok({ ...base, extraTotals: [1, 2, 3] })).toBe(false);
    const target = (extraMultipliers: unknown) => ({
      ...base,
      targets: [{ targetId: "g", hit: true, multiplier: "normal", extraMultipliers }],
    });
    expect(ok(target(["half"]))).toBe(true);
    expect(ok(target(["half", "double"]))).toBe(true);
    expect(ok(target(["half", "double", "none"]))).toBe(false);
    expect(ok(target(["quarter"]))).toBe(false);
    expect(ok(target([]))).toBe(false);
  });

  test("FR-CBT-84 / FR-MOD-57 line: damageParts ≤ 2 typed; a part's expression ≤ 20 and dice ≤ 20 (public and DM); old lines parse", () => {
    const line = {
      targetName: "Goblin",
      attackName: "Flame Tongue greatsword",
      damageType: "slashing",
      toHit: null,
      hit: true,
      damage: 25,
      multiplier: "normal",
      crit: false,
    };
    expect(AttackLogPayload.parse(line) as unknown).toEqual(line);
    const ok = (v: object) => AttackLogPayload.safeParse({ ...line, ...v }).success;
    expect(ok({ damageParts: [{ type: "fire", value: 4, multiplier: "half" }] })).toBe(true);
    expect(ok({ damageParts: [{ type: "fire", value: 4, multiplier: "normal" }] })).toBe(false);
    expect(ok({ damageParts: [{ type: null, value: 4 }] })).toBe(false);
    const fp = { type: "fire", value: 4 };
    expect(ok({ damageParts: [fp, fp, fp] })).toBe(false);
    const part = { label: "Divine Fury", value: 6, type: "radiant" };
    expect(ok({ parts: [{ ...part, expression: "1d6+2", dice: [4] }] })).toBe(true);
    expect(ok({ parts: [{ ...part, expression: "x".repeat(21) }] })).toBe(false);
    expect(ok({ parts: [{ ...part, dice: Array(21).fill(1) }] })).toBe(false);
    expect(ok({ parts: [{ ...part, dice: [0] }] })).toBe(false);
    const dm = {
      targetAc: 15,
      hitComputed: true,
      toHitRolled: 14,
      damageRolled: 21,
      damageTotal: 21,
      applied: 25,
      overkill: 0,
      overrides: { toHit: false, hit: false, damage: false },
    };
    const dmPart = { triggerId: "t", label: "Martial Advantage", rolled: 9 };
    expect(AttackLogDmPayload.safeParse({ ...dm, parts: [dmPart] }).success).toBe(true);
    expect(
      AttackLogDmPayload.safeParse({
        ...dm,
        parts: [{ ...dmPart, expression: "2d6", dice: [4, 5] }],
      }).success,
    ).toBe(true);
  });
});

describe("FR-CHARX-58 / FR-MOD-59 uses below zero", () => {
  test("FR-CHARX-58 feature row used ≤ usesMax + 9 (uses left down to −9); no usesMax → 0", () => {
    const ok = (v: object) => FeatureRow.safeParse({ id: "f", name: "Rage", ...v }).success;
    expect(ok({ usesMax: 3, used: 3 })).toBe(true);
    expect(ok({ usesMax: 3, used: 4 })).toBe(true);
    expect(ok({ usesMax: 3, used: 12 })).toBe(true);
    expect(ok({ usesMax: 3, used: 13 })).toBe(false);
    expect(ok({ usesMax: 20, used: 29 })).toBe(true);
    expect(ok({ usesMax: 20, used: 30 })).toBe(false);
    expect(ok({ used: 1 })).toBe(false);
    expect(ok({})).toBe(true);
  });

  test("FR-MOD-59 mod.toggle accepts overspend: true only; absent as before", () => {
    const base = { characterId: "c", presetId: "p", on: true };
    expect(ToggleInput.safeParse(base).success).toBe(true);
    expect(ToggleInput.safeParse({ ...base, overspend: true }).success).toBe(true);
    expect(ToggleInput.safeParse({ ...base, overspend: false }).success).toBe(false);
  });
});
