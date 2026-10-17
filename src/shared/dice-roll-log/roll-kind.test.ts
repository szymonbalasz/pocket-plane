// FR-DICE-35 / FR-DICE-36 (sprint 4, D5): `die` segments from `rollSegments` /
// `rollBreakdownSegments`. Line text is unchanged (`line.test.ts`, `kind-contract.test.ts`).
import { describe, expect, test } from "bun:test";
import { type LineSegment, lineText } from "./kind-types";
import { formatEntry } from "./line";
import { rollBreakdownSegments, rollSegments } from "./roll-kind";
import type { RollPayloadItem } from "./schemas";

const item = (p: Partial<RollPayloadItem> = {}): RollPayloadItem => ({
  rollId: "r1",
  expression: "1d20+4",
  mode: "normal",
  manual: false,
  dice: [{ faces: 20, value: 12, kept: true }],
  constant: 4,
  total: 16,
  natural: 12,
  label: null,
  ...p,
});
const dice = (segs: readonly LineSegment[]) => segs.filter((s) => s.die).map((s) => s.die);

describe("FR-DICE-35 log die chips", () => {
  test("FR-DICE-35 log die chips: one die segment per base die, text unchanged", () => {
    const segs = rollSegments(
      item({
        expression: "1d8+2d6+3",
        dice: [
          { faces: 8, value: 5, kept: true },
          { faces: 6, value: 2, kept: true },
          { faces: 6, value: 6, kept: true },
        ],
        constant: 3,
        total: 16,
        natural: null,
      }),
    );
    expect(dice(segs)).toEqual([
      { faces: 8, value: 5, kept: true },
      { faces: 6, value: 2, kept: true },
      { faces: 6, value: 6, kept: true },
    ]);
    // The die's own text is its number: lineText reads as in sprint 3.
    expect(segs.filter((s) => s.die).map((s) => s.text)).toEqual(["5", "2", "6"]);
    expect(lineText(segs)).toBe("1d8+2d6+3: 5 + 2 + 6 + 3 = 16");
  });

  test("FR-DICE-35 log die chips: adv keeps the dropped d20 as kept false, struck in text", () => {
    const segs = rollSegments(
      item({
        expression: "2d20kh1+4",
        mode: "advantage",
        dice: [
          { faces: 20, value: 5, kept: false },
          { faces: 20, value: 12, kept: true },
        ],
      }),
    );
    expect(dice(segs)).toEqual([
      { faces: 20, value: 5, kept: false },
      { faces: 20, value: 12, kept: true },
    ]);
    expect(segs.find((s) => s.die?.kept === false)?.style).toBe("dropped");
    expect(lineText(segs)).toBe("2d20kh1+4 (adv): ~5~ 12 + 4 = 16");
  });

  test("FR-DICE-35 log die chips: manual with per-die values → chips + physical; total only → one round chip", () => {
    const perDie = rollSegments(
      item({
        expression: "2d6+2",
        manual: true,
        dice: [
          { faces: 6, value: 3, kept: true },
          { faces: 6, value: 4, kept: true },
        ],
        constant: 2,
        total: 9,
        natural: null,
      }),
    );
    expect(dice(perDie)).toEqual([
      { faces: 6, value: 3, kept: true },
      { faces: 6, value: 4, kept: true },
    ]);
    expect(perDie.some((s) => s.style === "badge" && s.text === "physical")).toBe(true);
    const total = rollSegments(
      item({
        expression: "2d6+2",
        manual: true,
        dice: [
          { faces: 6, value: null, kept: true },
          { faces: 6, value: null, kept: true },
        ],
        constant: 2,
        total: 9,
        natural: null,
      }),
    );
    expect(dice(total)).toEqual([{ faces: null, value: 7, kept: true }]);
    expect(lineText(total)).toBe("2d6+2: 7 + 2 = 9 (physical)");
    // A single die's physical total is that die's value: its own shape (DICE §13 e4).
    const one = rollSegments(
      item({ manual: true, dice: [{ faces: 20, value: null, kept: true }], total: 19 }),
    );
    expect(dice(one)).toEqual([{ faces: 20, value: 15, kept: true }]);
  });

  test("FR-DICE-35 log die chips: a whole roll line carries the chips, actor and total stay text", () => {
    const segs = formatEntry({
      kind: "roll",
      actorName: "Mira",
      payload: [item({ label: "Athletics" })],
    }).segments;
    expect(dice(segs)).toEqual([{ faces: 20, value: 12, kept: true }]);
    expect(segs.find((s) => s.style === "actor")?.die).toBeUndefined();
    expect(segs.find((s) => s.style === "total")?.die).toBeUndefined();
    expect(lineText(segs)).toBe("Mira — Athletics: 12 + 4 = 16");
  });
});

describe("FR-DICE-36 faces from expression", () => {
  test("FR-DICE-36 faces from expression: 1d8+1d6+3 → d8 then d6", () => {
    const segs = rollBreakdownSegments({
      expression: "1d8+1d6+3",
      dice: [
        [5, true],
        [2, true],
      ],
      constant: 3,
    });
    expect(dice(segs)).toEqual([
      { faces: 8, value: 5, kept: true },
      { faces: 6, value: 2, kept: true },
    ]);
    expect(lineText(segs)).toBe(" (1d8+1d6+3: 5 + 2 + 3)");
  });

  test("FR-DICE-36 faces from expression: 2d20kh1+4 → two d20, one dropped", () => {
    const segs = rollBreakdownSegments({
      expression: "2d20kh1+4",
      mode: "advantage",
      dice: [
        [15, true],
        [7, false],
      ],
      constant: 4,
    });
    expect(dice(segs)).toEqual([
      { faces: 20, value: 15, kept: true },
      { faces: 20, value: 7, kept: false },
    ]);
    expect(lineText(segs)).toBe(" (2d20kh1+4 adv: 15 ~7~ + 4)");
  });

  test("FR-DICE-36 faces from expression: unparsable or a count mismatch → round chips", () => {
    const bad = rollBreakdownSegments({
      expression: "fireball",
      dice: [
        [4, true],
        [2, true],
      ],
      constant: 1,
    });
    expect(dice(bad)).toEqual([
      { faces: null, value: 4, kept: true },
      { faces: null, value: 2, kept: true },
    ]);
    const mismatch = rollBreakdownSegments({
      expression: "1d8+2",
      dice: [
        [5, true],
        [3, true],
      ],
      constant: 2,
    });
    expect(dice(mismatch).map((d) => d?.faces)).toEqual([null, null]);
    expect(lineText(mismatch)).toBe(" (1d8+2: 5 + 3 + 2)");
    // Dice without values (a physical total) still show nothing.
    expect(rollBreakdownSegments({ expression: "2d6", dice: [[null, true]], constant: 0 })).toEqual(
      [],
    );
  });
});

describe("FR-DICE-36 segment format (S8 / B5)", () => {
  test("FR-DICE-36 segment format (S8 / B5): every die segment carries exactly one die", () => {
    const segs = [
      ...rollSegments(
        item({
          expression: "2d20kl1+1d4",
          mode: "disadvantage",
          dice: [
            { faces: 20, value: 9, kept: true },
            { faces: 20, value: 17, kept: false },
            { faces: 4, value: 3, kept: true },
          ],
          constant: 0,
          total: 12,
        }),
      ),
      ...rollBreakdownSegments({ expression: "1d6+2", dice: [[4, true]], constant: 2 }),
    ];
    for (const s of segs.filter((x) => x.die)) {
      const d = s.die as NonNullable<LineSegment["die"]>;
      expect(
        Object.keys(d).every((k) => ["faces", "value", "kept", "offered", "label"].includes(k)),
      ).toBe(true);
      expect(typeof d.value).toBe("number");
      expect(s.text).toBe(String(d.value));
    }
    // A dropped adv / dis die → kept false, never offered (B5: offered is a trigger die only).
    const dropped = segs.filter((s) => s.die?.kept === false);
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.die?.offered).toBeUndefined();
  });
});

describe("FR-DICE-36 sources", () => {
  const attack = {
    payload: {
      targetName: "Mira",
      attackName: "Scimitar",
      damageType: "slashing",
      toHit: { dice: 9, constant: 4, total: 13, natural: 9 },
      hit: true,
      damage: 6,
      multiplier: "normal",
      crit: false,
    },
    dmPayload: {
      targetAc: 15,
      hitComputed: true,
      toHitRolled: 13,
      damageRolled: 6,
      damageTotal: 6,
      applied: 6,
      overkill: 0,
      overrides: { toHit: false, hit: false, damage: false },
      rolls: {
        toHit: {
          expression: "2d20kh1+4",
          mode: "advantage",
          dice: [
            [9, true],
            [3, false],
          ],
          constant: 4,
        },
        damage: { expression: "1d6+2", dice: [[4, true]], constant: 2, crit: false },
      },
    },
  };

  test("FR-DICE-36 sources: the DM's cbt.attack breakdown yields chips; players' line has none", () => {
    const dm = formatEntry({ kind: "cbt.attack", actorName: "Goblin", ...attack }).segments;
    expect(dice(dm)).toEqual([
      { faces: 20, value: 9, kept: true },
      { faces: 20, value: 3, kept: false },
      { faces: 6, value: 4, kept: true },
    ]);
    // Players: the public "9 + 4" sum stays text, no die segment.
    const player = formatEntry({
      kind: "cbt.attack",
      actorName: "Goblin",
      payload: attack.payload,
    }).segments;
    expect(dice(player)).toEqual([]);
    expect(lineText(player)).toContain("9 + 4 = 13");
  });

  test("FR-DICE-36 sources: segments come only from payload / dmPayload, never from rollIds", () => {
    const base = { kind: "cbt.attack", actorName: "Goblin", payload: attack.payload };
    const withIds = formatEntry({ ...base, rollIds: ["r1", "r2", "r3"] } as never).segments;
    expect(dice(withIds)).toEqual([]);
  });

  test("FR-DICE-36 sources: FR-DICE-28 kind contract with die segments (sentinel never in a player line)", () => {
    const N = 7777;
    const sentinel = {
      ...attack.dmPayload,
      rolls: {
        toHit: {
          expression: "2d20kh1+4",
          mode: "advantage",
          dice: [
            [N, true],
            [N, false],
          ],
          constant: 4,
        },
        damage: { expression: "1d6+2", dice: [[N, true]], constant: N, crit: false },
      },
    };
    const player = formatEntry({
      kind: "cbt.attack",
      actorName: "Goblin",
      payload: attack.payload,
    });
    expect(player.segments.some((s) => s.die?.value === N)).toBe(false);
    expect(lineText(player.segments)).not.toContain(String(N));
    const dm = formatEntry({
      kind: "cbt.attack",
      actorName: "Goblin",
      payload: attack.payload,
      dmPayload: sentinel,
    });
    expect(dm.segments.filter((s) => s.die?.value === N)).toHaveLength(3);
    // A hidden roll's dmPayload names (FR-MOD-20) never become a die for players either.
    const roll = formatEntry({
      kind: "roll",
      actorName: "Goblin",
      payload: [item({ mods: [{ label: null, value: -3, expression: "1d4", rollId: "r2" }] })],
    });
    expect(dice(roll.segments)).toEqual([{ faces: 20, value: 12, kept: true }]);
  });
});

describe("FR-CHARX-55 weapon damage parts on the roll line", () => {
  const base = item({
    rollId: "b",
    expression: "2d6+5",
    dice: [
      { faces: 6, value: 3, kept: true },
      { faces: 6, value: 5, kept: true },
    ],
    constant: 5,
    total: 13,
    natural: null,
    label: "Flame Tongue greatsword damage (slashing)",
  });
  const fire = item({
    rollId: "f",
    expression: "2d6",
    dice: [
      { faces: 6, value: 2, kept: true },
      { faces: 6, value: 6, kept: true },
    ],
    constant: 0,
    total: 8,
    natural: null,
    label: "Flame Tongue greatsword damage (fire)",
  });
  const line = (payload: RollPayloadItem[], dmPayload: unknown = null) =>
    lineText(
      formatEntry({ kind: "roll", actorName: "Brakka", category: "damage", payload, dmPayload })
        .segments,
    );
  const parted = [
    { ...base, part: { type: "slashing" as const, extra: false } },
    { ...fire, part: { type: "fire" as const, extra: true } },
  ];

  test("FR-CHARX-55 +1 to hit and damage: parts merge into one run with one total", () => {
    expect(line(parted)).toBe(
      "Brakka — Flame Tongue greatsword damage: 2d6+5 (3 + 5) slashing + 2d6 (2 + 6) fire = 21",
    );
    const segs = formatEntry({
      kind: "roll",
      actorName: "Brakka",
      category: "damage",
      payload: parted,
      dmPayload: null,
    }).segments;
    // One die segment per die of every part (seams S8).
    expect(dice(segs).map((d) => d?.value)).toEqual([3, 5, 2, 6]);
  });

  test("FR-CHARX-55 to-hit stays its own run; mods sit on the base part; physical marks the run", () => {
    const hit = item({
      label: "Flame Tongue greatsword attack",
      expression: "1d20+8",
      constant: 8,
      total: 20,
    });
    const rage = {
      ...parted[0],
      mods: [{ label: "Rage", value: 2 }],
      total: 15,
      manual: true,
    } as RollPayloadItem;
    expect(line([hit, rage, parted[1] as RollPayloadItem])).toBe(
      "Brakka — Flame Tongue greatsword attack: 12 + 8 = 20; Flame Tongue greatsword damage: " +
        "2d6+5 (3 + 5) + 2 Rage slashing + 2d6 (2 + 6) fire = 23 (physical)",
    );
  });

  test("FR-CHARX-55 rows without `part` render exactly as before", () => {
    expect(line([base, fire])).toBe(
      "Brakka — Flame Tongue greatsword damage (slashing): 3 + 5 + 5 = 13; " +
        "Flame Tongue greatsword damage (fire): 2 + 6 = 8",
    );
    // A lone base part, or an extra part with no base before it, renders as a plain roll.
    expect(line([parted[0] as RollPayloadItem])).toBe(line([base]));
    expect(line([parted[1] as RollPayloadItem])).toBe(line([fire]));
    // An untyped base keeps its label; a cut label ("…") stays as is.
    const untyped = { ...parted[0], label: "Club damage", part: { type: null, extra: false } };
    expect(line([untyped as RollPayloadItem, parted[1] as RollPayloadItem])).toBe(
      "Brakka — Club damage: 2d6+5 (3 + 5) + 2d6 (2 + 6) fire = 21",
    );
  });
});
