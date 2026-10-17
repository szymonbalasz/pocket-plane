import { describe, expect, test } from "bun:test";
import { type ThrowEntry, throwDice } from "./throw";

let seq = 0;
function item(o: Record<string, unknown> = {}) {
  seq += 1;
  return {
    rollId: `r${seq}`,
    expression: "1d20+4",
    mode: "normal",
    manual: false,
    dice: [{ faces: 20, value: 12, kept: true }],
    constant: 4,
    total: 16,
    natural: 12,
    label: null,
    ...o,
  };
}

function entry(n: number, payload: unknown[], o: Partial<ThrowEntry> = {}): ThrowEntry {
  return {
    id: `e${n}`,
    n,
    kind: "roll",
    public: true,
    rollerRole: "player",
    rollerPlayerId: "p1",
    actorName: "Mira",
    payload,
    ...o,
  };
}

const one = (payload: unknown[]) => {
  const t = throwDice([entry(1, payload)]);
  if (!t) throw new Error("no throw");
  return t;
};

describe("FR-DICEX-13 throwDice", () => {
  test("kept + dropped dice (adv), with server values", () => {
    const t = one([
      item({
        expression: "2d20kh1+4",
        mode: "advantage",
        dice: [
          { faces: 20, value: 7, kept: false },
          { faces: 20, value: 15, kept: true },
        ],
        total: 19,
      }),
    ]);
    expect(t.dice.map((d) => [d.shape, d.value, d.kept, d.flat])).toEqual([
      ["d20", 7, false, false],
      ["d20", 15, true, false],
    ]);
    expect(t.totals).toEqual([19]);
    expect(t.label).toBe("2d20kh1+4");
    expect(t.roller).toEqual({ role: "player", playerId: "p1", name: "Mira" });
  });

  test("MOD 1d4 part with dice → labelled die; -1d4 → value 3 signed −", () => {
    const t = one([
      item({
        mods: [
          { label: "Bless", value: 2, expression: "1d4", dice: [2] },
          { label: "Bane", value: -3, expression: "-1d4", dice: [3] },
        ],
      }),
    ]);
    const mods = t.dice.slice(1);
    expect(mods.map((d) => [d.label, d.faces, d.value, d.sign, d.shape])).toEqual([
      ["Bless", 4, 2, 1, "d4"],
      ["Bane", 4, 3, -1, "d4"],
    ]);
  });

  test("3d6 part with dice [2, 5, 6] → three labelled dice", () => {
    const t = one([
      item({ mods: [{ label: "Smite", value: 13, expression: "3d6", dice: [2, 5, 6] }] }),
    ]);
    expect(t.dice.slice(1).map((d) => [d.label, d.faces, d.value])).toEqual([
      ["Smite", 6, 2],
      ["Smite", 6, 5],
      ["Smite", 6, 6],
    ]);
  });

  test("FR-DICEX-13 #220 mixed dice in one part: '2d6+1d8' → d6, d6, d8 (each die its own type)", () => {
    const t = one([
      item({
        mods: [{ label: "Smite", value: 12, expression: "2d6+1d8", dice: [2, 4, 6] }],
        offered: [{ label: "Fury", value: 5, expression: "1d6+1d4", dice: [3, 2] }],
      }),
    ]);
    expect(t.dice.slice(1).map((d) => [d.label, d.faces, d.value, d.shape, d.offered])).toEqual([
      ["Smite", 6, 2, "d6", undefined],
      ["Smite", 6, 4, "d6", undefined],
      ["Smite", 8, 6, "d8", undefined],
      ["Fury", 6, 3, "d6", true],
      ["Fury", 4, 2, "d4", true],
    ]);
    // A subtracted term's dice carry the minus.
    const sub = one([
      item({ mods: [{ label: "X", value: 3, expression: "1d6-1d4", dice: [5, 2] }] }),
    ]);
    expect(sub.dice.slice(1).map((d) => [d.faces, d.sign])).toEqual([
      [6, 1],
      [4, -1],
    ]);
  });

  test("a part without dice: 1d4 → one die; 2d6 → chip with the sum; null label → DM; flat bonus → chip", () => {
    const t = one([
      item({
        mods: [
          { label: null, value: 3, expression: "1d4" },
          { label: "Hex", value: 9, expression: "2d6" },
          { label: "Rage", value: 2 },
        ],
      }),
    ]);
    expect(t.dice.slice(1).map((d) => [d.label, d.faces, d.value, d.shape, d.flat])).toEqual([
      ["DM", 4, 3, "d4", false],
      ["Hex", 6, 9, null, true],
      ["Rage", 0, 2, null, true],
    ]);
  });

  test("an offered 1d6 (Divine Fury) → one die tagged on a hit, outside the totals", () => {
    const t = one([
      item({
        expression: "1d8+3",
        dice: [{ faces: 8, value: 5, kept: true }],
        constant: 3,
        total: 8,
        offered: [{ label: "Divine Fury", value: 4, expression: "1d6", dice: [4] }],
      }),
    ]);
    const off = t.dice.find((d) => d.offered);
    expect(off).toMatchObject({ faces: 6, value: 4, label: "Divine Fury", shape: "d6" });
    expect(t.totals).toEqual([8]);
  });

  test("FR-DICEX-13 manual with per-die values → flat physical dice; without → one chip (sum) with the dice total", () => {
    const withDice = one([
      item({
        expression: "2d6-1",
        manual: true,
        dice: [
          { faces: 6, value: 4, kept: true },
          { faces: 6, value: 5, kept: true },
        ],
        constant: -1,
        total: 8,
      }),
    ]);
    expect(withDice.dice.map((d) => [d.value, d.flat, d.physical, d.shape, d.sum])).toEqual([
      [4, true, true, null, undefined],
      [5, true, true, null, undefined],
    ]);
    const total = one([
      item({
        expression: "2d6-1",
        manual: true,
        dice: [
          { faces: 6, value: null, kept: true },
          { faces: 6, value: null, kept: true },
        ],
        constant: -1,
        total: 8,
      }),
    ]);
    expect(total.dice.map((d) => [d.faces, d.value, d.flat, d.physical, d.sum])).toEqual([
      [6, 9, true, true, true],
    ]);
  });

  test("FR-DICEX-13 a manual roll's entered bonus die (Bless) → flat physical die; a server-rolled (auto) part still tumbles", () => {
    const t = one([
      item({
        manual: true,
        total: 21,
        mods: [
          { label: "Bless", value: 3, expression: "1d4", dice: [3] },
          { label: "Bane", value: -2, expression: "-1d4", dice: [2], auto: true },
          { label: null, value: 2 },
        ],
      }),
    ]);
    expect(t.dice.map((d) => [d.label, d.faces, d.value, d.flat, d.physical, d.shape])).toEqual([
      [undefined, 20, 12, true, true, null],
      ["Bless", 4, 3, true, true, null],
      ["Bane", 4, 2, false, undefined, "d4"],
      ["DM", 0, 2, true, undefined, null],
    ]);
    // An entered offered trigger die too (FR-MOD-18 `t:` group); a server roll's parts tumble.
    const off = one([
      item({
        manual: true,
        offered: [{ label: "Divine Fury", value: 4, expression: "1d6", dice: [4] }],
      }),
    ]);
    expect(off.dice[1]).toMatchObject({ offered: true, flat: true, physical: true, shape: null });
    const rolled = one([
      item({ mods: [{ label: "Bless", value: 3, expression: "1d4", dice: [3] }] }),
    ]);
    expect(rolled.dice[1]).toMatchObject({ flat: false, shape: "d4" });
    expect(rolled.dice[1]?.physical).toBeUndefined();
  });

  test("FR-DICEX-13 a physical roll's server-rolled d20 (FR-MOD-17 auto) tumbles; the entered one stays flat", () => {
    const t = one([
      item({
        expression: "2d20kh1+4",
        mode: "advantage",
        manual: true,
        dice: [
          { faces: 20, value: 11, kept: true },
          { faces: 20, value: 7, kept: false, auto: true },
        ],
        total: 15,
      }),
    ]);
    expect(t.dice.map((d) => [d.value, d.kept, d.flat, d.physical, d.shape])).toEqual([
      [11, true, true, true, null],
      [7, false, false, undefined, "d20"],
    ]);
  });

  test("FR-DICEX-14 51 dice → 20 + '+31 more'", () => {
    const dice = Array.from({ length: 50 }, (_, i) => ({
      faces: 6,
      value: (i % 6) + 1,
      kept: true,
    }));
    const t = one([
      item({ expression: "50d6+1d4", dice: [...dice, { faces: 4, value: 1, kept: true }] }),
    ]);
    expect(t.dice).toHaveLength(20);
    expect(t.more).toBe(31);
  });

  test("FR-DICEX-14 d3 / d1000 → flat chips; d100 → tens + units (100 → 00 + 0)", () => {
    const t = one([
      item({
        expression: "1d3+1d1000+1d100+1d100",
        dice: [
          { faces: 3, value: 2, kept: true },
          { faces: 1000, value: 777, kept: true },
          { faces: 100, value: 100, kept: true },
          { faces: 100, value: 47, kept: true },
        ],
      }),
    ]);
    expect(t.dice.map((d) => [d.faces, d.shape, d.face, d.value, d.d100 ?? null])).toEqual([
      [3, null, "2", 2, null],
      [1000, null, "777", 777, null],
      [100, "d10", "00", 0, "tens"],
      [100, "d10", "0", 0, "units"],
      [100, "d10", "40", 40, "tens"],
      [100, "d10", "7", 7, "units"],
    ]);
    expect(t.dice.slice(0, 2).every((d) => d.flat)).toBe(true);
  });

  test("FR-DICEX-11 entries coalesce in n order; kinds other than roll never throw", () => {
    const t = throwDice([
      entry(5, [item({ dice: [{ faces: 20, value: 5, kept: true }] })], { id: "late" }),
      entry(3, [item({ dice: [{ faces: 20, value: 3, kept: true }] })], {
        id: "early",
        actorName: "Goblin",
        rollerRole: "dm",
        rollerPlayerId: null,
      }),
      entry(4, [{ anything: true }], { kind: "cbt.hp" }),
    ]);
    expect(t?.id).toBe("early");
    expect(t?.count).toBe(2);
    expect(t?.roller.name).toBe("Goblin");
    expect(t?.dice.map((d) => d.value)).toEqual([3, 5]);
    expect(throwDice([entry(1, [], { kind: "cbt.hp" })])).toBeNull();
    expect(throwDice([])).toBeNull();
  });

  test("FR-DICEX-11 one frame with 3 roll entries, 30 dice → one throw, 20 + '+10 more'", () => {
    const ten = Array.from({ length: 10 }, () => ({ faces: 6, value: 6, kept: true }));
    const t = throwDice([1, 2, 3].map((n) => entry(n, [item({ expression: "10d6", dice: ten })])));
    expect(t?.count).toBe(3);
    expect(t?.dice).toHaveLength(20);
    expect(t?.more).toBe(10);
    expect(t?.dice.slice(0, 10).every((d) => d.entryId === "e1")).toBe(true);
  });

  test("FR-DICEX-12 payload only: a dmPayload sentinel never reaches the throw", () => {
    const e = {
      ...entry(1, [item()]),
      dmPayload: { items: [{ mods: [{ effectId: "x", label: "DM-SECRET-SENTINEL" }] }] },
    };
    const t = throwDice([e]);
    expect(JSON.stringify(t)).not.toContain("DM-SECRET-SENTINEL");
    expect(throwDice([entry(1, [item()], { public: false, rollerRole: "dm" })])?.hidden).toBe(true);
  });

  test("an item that doesn't parse is skipped, not fatal", () => {
    const t = one([{ junk: 1 }, item()]);
    expect(t.dice).toHaveLength(1);
  });

  test("FR-DICEX-15 seed from first public entry: a DM frame [DM-only, public] seeds from the public id, as the players' frame", () => {
    const hidden = entry(1, [item()], { public: false, rollerRole: "dm", rollerPlayerId: null });
    const shown = entry(2, [item()], { rollerRole: "dm", rollerPlayerId: null });
    const dm = throwDice([hidden, shown]);
    const players = throwDice([shown]);
    expect(dm?.id).toBe("e1");
    expect(dm?.seedId).toBe("e2");
    expect(players?.seedId).toBe("e2");
    // No public entry: the first entry seeds.
    expect(throwDice([hidden])?.seedId).toBe("e1");
  });
});
