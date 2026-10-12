import { describe, expect, test } from "bun:test";
import { parseExpression, prepareExpression } from "@shared/dice-roll-log/grammar";
import {
  attackLine,
  characterRolls,
  clampHp,
  eligibleCharacters,
  hpState,
  initials,
  isDown,
  levelLine,
  parseHpAmount,
  selectCharacter,
  signed,
} from "./logic";
import { CharAdjustHpIntent, CharRollIntent } from "./schemas";

const mira = {
  initBonus: 2,
  attacks: [{ name: "Shortsword", toHit: 4, damage: "1d6+2", damageType: "piercing" as const }],
};

describe("FR-CHAR-05 characterRolls", () => {
  test("FR-CHAR-05 initiative = d20 + initBonus, category initiative", () => {
    expect(characterRolls(mira, "initiative")).toEqual([
      { expression: "1d20+2", category: "initiative", label: "Initiative", d20: true },
    ]);
    expect(characterRolls({ ...mira, initBonus: -1 }, "initiative")?.[0]?.expression).toBe(
      "1d20-1",
    );
    expect(characterRolls({ ...mira, initBonus: 0 }, "initiative")?.[0]?.expression).toBe("1d20");
  });

  test("FR-CHAR-05 attack = to-hit (attack) + damage (damage), labels per FR-CHAR-08", () => {
    expect(characterRolls(mira, "attack")).toEqual([
      { expression: "1d20+4", category: "attack", label: "Shortsword attack", d20: true },
      {
        expression: "1d6+2",
        category: "damage",
        label: "Shortsword damage (piercing)",
        d20: false,
      },
    ]);
    const weak = { initBonus: 0, attacks: [{ name: "Club", toHit: -2, damage: "1d4-1" }] };
    expect(characterRolls(weak, "attack")).toEqual([
      { expression: "1d20-2", category: "attack", label: "Club attack", d20: true },
      { expression: "1d4-1", category: "damage", label: "Club damage", d20: false },
    ]);
    expect(characterRolls({ initBonus: 2, attacks: [] }, "attack")).toBeNull();
  });

  test("FR-CHAR-06 every built expression parses; mode applies to the d20 only", () => {
    for (const s of [
      mira,
      { initBonus: -1, attacks: [{ name: "X", toHit: -3, damage: "1d4-1" }] },
    ]) {
      for (const kind of ["initiative", "attack"] as const) {
        for (const r of characterRolls(s, kind) ?? []) {
          expect(parseExpression(r.expression).ok).toBe(true);
          expect(prepareExpression(r.expression, "advantage").ok).toBe(r.d20);
        }
      }
    }
  });
});

describe("FR-CHAR-03 formatting", () => {
  test("FR-CHAR-03 signed bonuses, level line, attack row, Down, initials", () => {
    expect([signed(2), signed(-1), signed(0)]).toEqual(["+2", "\u22121", "+0"]);
    expect(levelLine(1, "Fighter")).toBe("Level 1 Fighter");
    expect(levelLine(3, "  ")).toBe("Level 3");
    expect(attackLine(mira.attacks[0] as (typeof mira.attacks)[0])).toBe(
      "Shortsword +4 \u00b7 1d6+2 piercing",
    );
    expect(attackLine({ name: "Club", toHit: -1, damage: "1d4" })).toBe("Club \u22121 \u00b7 1d4");
    expect([isDown(0), isDown(1)]).toEqual([true, false]);
    expect([hpState(12, 12), hpState(7, 12), hpState(6, 12), hpState(0, 12)]).toEqual([
      "full",
      "full",
      "bloodied",
      "down",
    ]);
    expect([initials("Mira"), initials("Pip the Bold"), initials("  ")]).toEqual(["M", "PB", ""]);
  });
});

describe("FR-CHAR-10 clamp", () => {
  test("FR-CHAR-10 clamp(before + delta, 0, hpMax)", () => {
    expect(clampHp(12, -5, 12)).toBe(7);
    expect(clampHp(7, 20, 12)).toBe(12);
    expect(clampHp(12, -15, 12)).toBe(0);
    expect(clampHp(0, -3, 12)).toBe(0);
  });

  test("FR-CHAR-11 HP input: integer 1–999 else null", () => {
    expect(["5", " 12 ", "999", "1"].map(parseHpAmount)).toEqual([5, 12, 999, 1]);
    expect(["", "0", "1000", "-3", "2.5", "abc", "1e2"].map(parseHpAmount)).toEqual(
      Array(7).fill(null),
    );
  });

  test("FR-CHAR-10 intent: int −999…999, ≠ 0, strict", () => {
    const ok = (delta: unknown) =>
      CharAdjustHpIntent.safeParse({ characterId: "c", delta }).success;
    expect([ok(-999), ok(-1), ok(1), ok(999)]).toEqual([true, true, true, true]);
    expect([ok(0), ok(1000), ok(-1000), ok(1.5), ok("3")]).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(CharAdjustHpIntent.safeParse({ characterId: "c", delta: 1, hp: 5 }).success).toBe(false);
  });
});

describe("FR-CHAR-07 char.roll intent", () => {
  const parse = (v: Record<string, unknown>) =>
    CharRollIntent.safeParse({ characterId: "c", ...v });
  test("FR-CHAR-05 strict: no expression / bonus / damage kind; mode defaults normal", () => {
    const p = parse({ kind: "initiative" });
    expect(p.success && p.data.mode).toBe("normal");
    for (const bad of [
      { kind: "initiative", expression: "1d20+30" },
      { kind: "attack", toHit: 20 },
      { kind: "damage" },
      { kind: "attack", mode: "super" },
    ]) {
      expect(parse(bad).success).toBe(false);
    }
  });

  test("FR-CHAR-07 manual count: initiative 1, attack 2", () => {
    const m = { diceTotal: 10 };
    expect(parse({ kind: "initiative", manual: [m] }).success).toBe(true);
    expect(parse({ kind: "attack", manual: [m, m] }).success).toBe(true);
    expect(parse({ kind: "initiative", manual: [m, m] }).success).toBe(false);
    expect(parse({ kind: "attack", manual: [m] }).success).toBe(false);
    expect(parse({ kind: "attack", manual: [] }).success).toBe(false);
  });
});

describe("FR-CHAR-02 eligibility", () => {
  const block = {};
  const ents = [
    { id: "b", kind: "character", name: "pip", ownerPlayerId: "p1", statBlock: block },
    { id: "a", kind: "character", name: "Mira", ownerPlayerId: "p1", statBlock: block },
    { id: "c", kind: "character", name: "Thorn", ownerPlayerId: "p2", statBlock: block },
    { id: "d", kind: "monster", name: "Ogre", ownerPlayerId: null, statBlock: block },
    { id: "a0", kind: "character", name: "Pip", ownerPlayerId: "p1", statBlock: block },
    // Redacted (another player's character as a player receives it): never eligible.
    { id: "e", kind: "character", name: "Zed", ownerPlayerId: "p1" },
  ];
  test("FR-CHAR-02 player: own only; DM: every character; name (ci) then id", () => {
    const ids = (v: { role: "dm" | "player"; playerId: string | null }) =>
      eligibleCharacters(ents, v).map((e) => e.id);
    expect(ids({ role: "player", playerId: "p1" })).toEqual(["a", "a0", "b"]);
    expect(ids({ role: "player", playerId: "p2" })).toEqual(["c"]);
    expect(ids({ role: "player", playerId: "p9" })).toEqual([]);
    expect(ids({ role: "dm", playerId: null })).toEqual(["a", "a0", "b", "c"]);
  });

  test("FR-CHAR-04 selection kept if eligible, else first, else null", () => {
    const list = [{ id: "a" }, { id: "b" }];
    expect(selectCharacter(list, "b")?.id).toBe("b");
    expect(selectCharacter(list, "gone")?.id).toBe("a");
    expect(selectCharacter(list, null)?.id).toBe("a");
    expect(selectCharacter([], "a")).toBeNull();
  });
});
