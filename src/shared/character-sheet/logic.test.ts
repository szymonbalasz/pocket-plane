import { describe, expect, test } from "bun:test";
import { parseExpression, prepareExpression } from "@shared/dice-roll-log/grammar";
import { LABEL_MAX, RollLabel } from "@shared/dice-roll-log/schemas";
import {
  abilityBlock,
  attackLine,
  attackNumbers,
  attackRollSpecs,
  baseDamage,
  characterRolls,
  clampHp,
  eligibleCharacters,
  fitLabel,
  hpState,
  initials,
  isDown,
  levelLine,
  parseHpAmount,
  resolveSheetAttack,
  selectCharacter,
  signed,
  speedText,
  withDamageBonus,
} from "./logic";
import { CharAdjustHpIntent, SheetRollIntent } from "./schemas";
import type { SpellRow } from "./sheet";

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

  test("FR-CHAR-08 labels fit LABEL_MAX: 40-char attack name + bludgeoning is cut with …", () => {
    const name = "A".repeat(40);
    const club = {
      initBonus: 0,
      attacks: [{ name, toHit: 0, damage: "1d4", damageType: "bludgeoning" as const }],
    };
    const [hit, dmg] = characterRolls(club, "attack") ?? [];
    expect(hit?.label).toBe(`${name} attack`);
    expect(dmg?.label).toHaveLength(LABEL_MAX);
    expect(dmg?.label).toBe(`${name} damage (bludgeonin…`);
    expect(RollLabel.safeParse(dmg?.label).success).toBe(true);
    expect(fitLabel(`${"x".repeat(58)}\u{1F600}yy`)).toBe(`${"x".repeat(58)}…`);
    expect(fitLabel("Club damage")).toBe("Club damage");
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

describe("FR-CHAR-18 FR-CHAR-19 FR-CHAR-20 FR-CHAR-22 speed and abilities block", () => {
  test("FR-CHAR-18 speed: '30 ft'; absent → '—'", () => {
    expect(speedText(30)).toBe("30 ft");
    expect(speedText(0)).toBe("0 ft");
    expect(speedText(undefined)).toBe("—");
  });

  test("FR-CHAR-19 FR-CHAR-20 FR-CHAR-22 six cells STR…CHA with derived mod, check, save, proficiency", () => {
    const stats = {
      level: 1,
      abilities: { str: 14, dex: 14, con: 14, int: 10, wis: 12, cha: 10 },
      saveProficiencies: ["str", "con"] as const,
    };
    const b = abilityBlock(stats);
    expect(b?.proficiency).toBe(2);
    expect(b?.cells.map((c) => [c.abbr, c.score, c.mod, c.check, c.save, c.proficient])).toEqual([
      ["STR", 14, 2, 2, 4, true],
      ["DEX", 14, 2, 2, 2, false],
      ["CON", 14, 2, 2, 4, true],
      ["INT", 10, 0, 0, 0, false],
      ["WIS", 12, 1, 1, 1, false],
      ["CHA", 10, 0, 0, 0, false],
    ]);
    // Level 5 → PB +3; score 1 → −5, 30 → +10.
    const high = abilityBlock({
      level: 5,
      abilities: { str: 1, dex: 30, con: 10, int: 11, wis: 9, cha: 8 },
      saveProficiencies: ["dex"],
    });
    expect(high?.proficiency).toBe(3);
    expect(high?.cells.map((c) => [c.mod, c.save])).toEqual([
      [-5, -5],
      [10, 13],
      [0, 0],
      [0, 0],
      [-1, -1],
      [-1, -1],
    ]);
    expect(abilityBlock({ level: 1 })).toBeNull();
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
    SheetRollIntent.safeParse({ characterId: "c", ...v });
  test("FR-CHAR-05 FR-CHARX-20 strict: no expression / bonus; wrong kind + ref; mode defaults normal", () => {
    const p = parse({ kind: "initiative" });
    expect(p.success && p.data.mode).toBe("normal");
    for (const bad of [
      { kind: "initiative", expression: "1d20+30" },
      { kind: "attack", toHit: 20 },
      { kind: "damage", skill: "stealth" },
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

describe("FR-CHAR-21 checks and saves (feedback pass)", () => {
  const abilities = { str: 8, dex: 15, con: 12, int: 10, wis: 13, cha: 8 };
  const pc = { ...mira, level: 5, abilities, saveProficiencies: ["dex" as const] };

  test("FR-CHAR-21 check = d20 + mod, save = d20 + mod (+ PB if proficient); labels, categories", () => {
    expect(characterRolls(pc, "check", "dex")).toEqual([
      { expression: "1d20+2", category: "ability-check", label: "Dexterity check", d20: true },
    ]);
    expect(characterRolls(pc, "save", "dex")).toEqual([
      { expression: "1d20+5", category: "saving-throw", label: "Dexterity save", d20: true },
    ]);
    expect(characterRolls(pc, "save", "str")?.[0]?.expression).toBe("1d20-1");
    expect(characterRolls(pc, "check", "int")?.[0]?.expression).toBe("1d20");
    for (const kind of ["check", "save"] as const) {
      for (const r of characterRolls(pc, kind, "wis") ?? []) {
        expect(parseExpression(r.expression).ok).toBe(true);
        expect(prepareExpression(r.expression, "disadvantage").ok).toBe(true);
      }
    }
  });

  test("FR-CHAR-21 no ability scores → null (caller: conflict); monsters use the CR table", () => {
    expect(characterRolls({ ...mira, level: 1 }, "check", "dex")).toBeNull();
    const elite = { ...mira, cr: "1", abilities, saveProficiencies: ["dex" as const] };
    expect(characterRolls(elite, "save", "dex")?.[0]?.expression).toBe("1d20+4");
  });

  test("FR-CHAR-05 / FR-CHAR-21 SheetRollIntent: ability required for check / save, else invalid", () => {
    const ok = (v: object) => SheetRollIntent.safeParse({ characterId: "c", ...v }).success;
    expect(ok({ kind: "check", ability: "dex" })).toBe(true);
    expect(ok({ kind: "save", ability: "cha", mode: "advantage", public: true })).toBe(true);
    expect(ok({ kind: "save", ability: "dex", manual: [{ diceTotal: 12 }] })).toBe(true);
    expect(ok({ kind: "save", ability: "dex", manual: [{ diceTotal: 1 }, { diceTotal: 2 }] })).toBe(
      false,
    );
    expect(ok({ kind: "check" })).toBe(false);
    expect(ok({ kind: "save", ability: "luck" })).toBe(false);
    expect(ok({ kind: "attack", ability: "str" })).toBe(false);
    expect(ok({ kind: "initiative" })).toBe(true);
    expect(ok({ kind: "check", ability: "dex", bonus: 3 })).toBe(false);
  });
});

describe("FR-CHARX-24 resolveSheetAttack (combat's sheetAttack)", () => {
  const stats = {
    initBonus: 0,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10 },
    level: 1,
    spellcasting: { ability: "wis" as const, slots: {} },
    attacks: [
      { id: "a1", name: "Mace", toHit: 2, damage: "1d6" },
      {
        id: "a2",
        name: "Light crossbow",
        toHit: 4,
        damage: "1d8+2",
        damageType: "piercing" as const,
      },
    ],
  };
  const spell = (id: string, o: object) =>
    ({
      id,
      name: id,
      level: 1,
      prepared: true,
      concentration: false,
      ritual: false,
      roll: "attack",
      effect: "damage",
      notes: "",
      ...o,
    }) as SpellRow;
  const sheet = {
    spells: [
      spell("bolt", { damage: "4d6", damageType: "radiant" }),
      spell("touch", {}),
      spell("flame", { roll: "save", saveAbility: "dex", damage: "1d8" }),
    ],
  };

  const plain = { bonus: 0, extraDamage: [] };

  test("FR-CHARX-24 no ref = first attack; attackId = that row; spellId = spell attack bonus + damage", () => {
    expect(resolveSheetAttack(stats, sheet, {})).toEqual({
      ok: true,
      attack: { name: "Mace", toHit: 2, damage: "1d6", damageType: null, ...plain },
    });
    expect(resolveSheetAttack(stats, sheet, { attackId: "a2" })).toEqual({
      ok: true,
      attack: {
        name: "Light crossbow",
        toHit: 4,
        damage: "1d8+2",
        damageType: "piercing",
        ...plain,
      },
    });
    // WIS 16 (+3) + PB 2.
    expect(resolveSheetAttack(stats, sheet, { spellId: "bolt" })).toEqual({
      ok: true,
      attack: { name: "bolt", toHit: 5, damage: "4d6", damageType: "radiant", ...plain },
    });
  });

  test("FR-CHARX-24 a spell attack without damage is not combat's; save spells, unknown rows, no attack rejected", () => {
    const code = (ref: object, s: typeof sheet | null = sheet, st: typeof stats = stats) => {
      const r = resolveSheetAttack(st, s, ref);
      return r.ok ? "ok" : `${r.code}: ${r.message}`;
    };
    expect(code({ spellId: "touch" })).toBe("conflict: No damage roll for touch");
    expect(code({ spellId: "flame" })).toBe("conflict: No attack roll for flame");
    expect(code({ spellId: "bolt" }, null)).toBe("not_found: Spell was deleted");
    expect(code({ attackId: "gone" })).toBe("not_found: Attack was deleted");
    expect(code({}, sheet, { ...stats, attacks: [] })).toBe("conflict: No weapon attack");
    const { spellcasting: _, ...noCasting } = stats;
    expect(code({ spellId: "bolt" }, sheet, noCasting as typeof stats)).toBe(
      "conflict: No spellcasting",
    );
  });

  test("FR-CHAR-05 attackRollSpecs: to-hit (d20, attack) then damage, labels as char.roll's", () => {
    expect(
      attackRollSpecs({
        name: "Guiding Bolt",
        toHit: 5,
        damage: "4d6",
        damageType: "radiant",
        ...plain,
      }),
    ).toEqual([
      { expression: "1d20+5", category: "attack", label: "Guiding Bolt attack", d20: true },
      {
        expression: "4d6",
        category: "damage",
        label: "Guiding Bolt damage (radiant)",
        d20: false,
      },
    ]);
  });
});

describe("FR-CHARX-55 rolls with parts (magic weapon rows)", () => {
  const flame = {
    id: "ft",
    name: "Flame Tongue greatsword",
    toHit: 7,
    damage: "2d6+4",
    damageType: "slashing" as const,
    bonus: 1,
    extraDamage: [{ damage: "2d6", type: "fire" as const }],
  };
  const stats = {
    initBonus: 0,
    level: 1,
    attacks: [{ id: "ga", name: "Greataxe", toHit: 5, damage: "1d12+3" }, flame],
  };

  test("FR-CHARX-55 +1 to hit and damage: 1d20+8, 2d6+5 slashing + 2d6 fire, typed parts", () => {
    const r = characterRolls(stats, null, "attack", { attackId: "ft" });
    expect(r).toEqual({
      ok: true,
      specs: [
        {
          expression: "1d20+8",
          category: "attack",
          label: "Flame Tongue greatsword attack",
          d20: true,
        },
        {
          expression: "2d6+5",
          category: "damage",
          label: "Flame Tongue greatsword damage (slashing)",
          d20: false,
          part: { type: "slashing", extra: false },
        },
        {
          expression: "2d6",
          category: "damage",
          label: "Flame Tongue greatsword damage (fire)",
          d20: false,
          part: { type: "fire", extra: true },
        },
      ],
    });
    // Manual counts: Damage 1 + n, Attack + damage 2 + n, Attack 1.
    const n = (kind: "damage" | "toHit" | "attack") => {
      const x = characterRolls(stats, null, kind, { attackId: "ft" });
      return x.ok ? x.specs.map((s) => s.expression) : x;
    };
    expect(n("damage")).toEqual(["2d6+5", "2d6"]);
    expect(n("toHit")).toEqual(["1d20+8"]);
    expect(n("attack")).toHaveLength(3);
  });

  test("FR-CHARX-55 rows without the fields build the same specs as before (no part)", () => {
    const r = characterRolls(stats, null, "attack", { attackId: "ga" });
    expect(r.ok && r.specs.map((s) => [s.expression, "part" in s])).toEqual([
      ["1d20+5", false],
      ["1d12+3", false],
    ]);
    // bonus without extra parts: folded in, still one damage roll, no part marker.
    const plus2 = { ...flame, bonus: 2, extraDamage: [] };
    const specs = attackRollSpecs(plus2);
    expect(specs.map((s) => s.expression)).toEqual(["1d20+9", "2d6+6"]);
    expect(specs.some((s) => s.part)).toBe(false);
    // an untyped base keeps `type: null`; two extras in row order.
    const two = {
      ...flame,
      damageType: null,
      bonus: 0,
      extraDamage: [
        { damage: "1d4", type: "cold" as const },
        { damage: "6d12+10", type: "necrotic" as const },
      ],
    };
    expect(attackRollSpecs(two).map((s) => [s.label, s.part?.type, s.part?.extra])).toEqual([
      ["Flame Tongue greatsword attack", undefined, undefined],
      ["Flame Tongue greatsword damage", null, false],
      ["Flame Tongue greatsword damage (cold)", "cold", true],
      ["Flame Tongue greatsword damage (necrotic)", "necrotic", true],
    ]);
  });

  test("FR-CHARX-55 the bonus goes on the base part's constant; resolveSheetAttack carries the fields", () => {
    expect(withDamageBonus("2d6+4", 1)).toBe("2d6+5");
    expect(withDamageBonus("1d8", 3)).toBe("1d8+3");
    expect(withDamageBonus("1d6-1", 1)).toBe("1d6");
    expect(withDamageBonus("1d6-3", 1)).toBe("1d6-2");
    expect(withDamageBonus("1d6+2", 0)).toBe("1d6+2");
    const r = resolveSheetAttack(stats, null, { attackId: "ft" });
    expect(r).toEqual({
      ok: true,
      attack: {
        name: "Flame Tongue greatsword",
        toHit: 7,
        damage: "2d6+4",
        damageType: "slashing",
        bonus: 1,
        extraDamage: [{ damage: "2d6", type: "fire" }],
      },
    });
    expect(r.ok && baseDamage(r.attack)).toBe("2d6+5");
  });

  test("FR-CHARX-56 row numbers: bonus folded in, parts joined", () => {
    expect(attackNumbers(flame)).toBe("+8 · 2d6+5 slashing + 2d6 fire");
    expect(attackLine(flame)).toBe("Flame Tongue greatsword +8 · 2d6+5 slashing + 2d6 fire");
    expect(attackNumbers({ name: "Club", toHit: -1, damage: "1d4", bonus: 1 })).toBe("+0 · 1d4+1");
  });
});
