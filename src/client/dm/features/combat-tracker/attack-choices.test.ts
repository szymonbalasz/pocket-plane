import { describe, expect, test } from "bun:test";
import { attackChoices, attackRolls } from "./attack-choices";

const a = (name: string, id?: string) => ({
  name,
  toHit: 4,
  damage: "1d6+2",
  ...(id ? { id } : {}),
});

describe("FR-CHARX-24 OQ-CHARX-12 DM attack picker choices", () => {
  test("FR-CHARX-24 every attack row with an id; a legacy first row as 'the first attack'", () => {
    expect(attackChoices([a("Scimitar", "s"), a("Shortbow", "b")])).toEqual([
      { attack: a("Scimitar", "s"), attackId: "s" },
      { attack: a("Shortbow", "b"), attackId: "b" },
    ]);
    expect(attackChoices([a("Scimitar")])).toEqual([{ attack: a("Scimitar") }]);
    // A later row without id can't be named: left out.
    expect(attackChoices([a("Scimitar"), a("Shortbow")])).toEqual([{ attack: a("Scimitar") }]);
    expect(attackChoices([])).toEqual([]);
  });
});

describe("BL-19 DM Attack ▸ physical entries per part", () => {
  const flameTongue = {
    name: "Flame Tongue greatsword",
    toHit: 7,
    damage: "2d6+4",
    damageType: "slashing" as const,
    bonus: 1,
    extraDamage: [{ damage: "2d6", type: "fire" as const }],
  };

  test("FR-CBT-81 FR-CBT-83 Attack + damage: to-hit and base with the bonus, then each extra part; a crit doubles every part", () => {
    expect(attackRolls(flameTongue, "both")).toEqual({
      expressions: ["1d20+8", "2d6+5", "2d6"],
      critExpressions: ["4d6+5", "4d6"],
      extraParts: 1,
    });
    expect(attackRolls(flameTongue, "damage")).toEqual({
      expressions: ["2d6+5", "2d6"],
      critExpressions: ["4d6+5", "4d6"],
      extraParts: 1,
    });
    expect(attackRolls(flameTongue, "toHit")).toEqual({ expressions: ["1d20+8"], extraParts: 0 });
  });

  test("FR-CBT-74 a plain monster row rolls as before (no bonus, no parts)", () => {
    expect(attackRolls(a("Scimitar", "s"), "both")).toEqual({
      expressions: ["1d20+4", "1d6+2"],
      critExpressions: ["2d6+2"],
      extraParts: 0,
    });
  });
});
