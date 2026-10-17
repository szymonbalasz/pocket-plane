// FR-CHARX-49 / -53 (sprint 3, V0 zod only): `statBlock.senses` on both creature kinds. Sprint 4
// (OQ-FOG-51): `visionFt` optional 0–995 (absent = Normal 999 ft, never stored); darkvision 0–120.
import { describe, expect, test } from "bun:test";
import { CharacterStatBlock, MonsterStatBlock, Senses } from "./schemas";

const goblin = {
  size: "small",
  ac: 15,
  hpMax: 7,
  initBonus: 2,
  attacks: [],
  cr: "1/4",
};

describe("FR-CHARX-49 senses zod", () => {
  test("FR-CHARX-49 ints step 5 (darkvision 0–120), bools; seesInvisible optional; strict", () => {
    const ok = { visionFt: 30, darkvisionFt: 60, seesMagicalDarkness: true };
    expect(Senses.parse(ok)).toEqual(ok);
    expect(Senses.parse({ ...ok, seesInvisible: true }).seesInvisible).toBe(true);
    for (const bad of [
      { ...ok, darkvisionFt: 125 },
      { ...ok, darkvisionFt: 7 },
      { ...ok, visionFt: -5 },
      { ...ok, visionFt: 2.5 },
      { ...ok, extra: 1 },
      { visionFt: 30, darkvisionFt: 0 },
    ]) {
      expect(Senses.safeParse(bad).success).toBe(false);
    }
  });

  test("FR-CHARX-49 vision default: visionFt optional (absent = Normal), 0–995; 999 / 1000 → invalid; stored 0 kept", () => {
    const base = { darkvisionFt: 0, seesMagicalDarkness: false };
    expect(Senses.parse(base)).toEqual(base);
    expect(Senses.parse({ ...base, visionFt: 995 }).visionFt).toBe(995);
    expect(Senses.parse({ ...base, visionFt: 0 }).visionFt).toBe(0);
    for (const visionFt of [999, 1000, 997, -5]) {
      expect(Senses.safeParse({ ...base, visionFt }).success).toBe(false);
    }
  });

  test("FR-CHARX-49 on the creature core (monster + character); absent stays absent", () => {
    const senses = { visionFt: 0, darkvisionFt: 60, seesMagicalDarkness: false };
    expect(MonsterStatBlock.parse({ ...goblin, senses }).senses).toEqual(senses);
    expect(MonsterStatBlock.parse(goblin).senses).toBeUndefined();
    const mira = { ...goblin, cr: undefined, size: "medium", level: 1, className: "Fighter" };
    const { cr: _cr, ...char } = mira;
    expect(CharacterStatBlock.parse({ ...char, senses }).senses).toEqual(senses);
  });
});
