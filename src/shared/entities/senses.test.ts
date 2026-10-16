// FR-CHARX-49 / -53 (sprint 3, V0 zod only): `statBlock.senses` on both creature kinds; absent =
// no vision (every existing creature unchanged).
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
  test("FR-CHARX-49 ints 0–120 step 5, bools; seesInvisible optional; strict", () => {
    const ok = { visionFt: 30, darkvisionFt: 60, seesMagicalDarkness: true };
    expect(Senses.parse(ok)).toEqual(ok);
    expect(Senses.parse({ ...ok, seesInvisible: true }).seesInvisible).toBe(true);
    for (const bad of [
      { ...ok, visionFt: 125 },
      { ...ok, darkvisionFt: 7 },
      { ...ok, visionFt: -5 },
      { ...ok, visionFt: 2.5 },
      { ...ok, extra: 1 },
      { visionFt: 30, darkvisionFt: 0 },
    ]) {
      expect(Senses.safeParse(bad).success).toBe(false);
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
