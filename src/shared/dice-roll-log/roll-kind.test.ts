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

describe("FR-DICE-92 kept dice joined across dropped ones (BL-72)", () => {
  const d6 = (value: number, kept: boolean) => ({ faces: 6, value, kept });
  const d20 = (value: number, kept: boolean) => ({ faces: 20, value, kept });

  test("FR-DICE-92 keep-highest joins kept dice", () => {
    const kh3 = item({
      expression: "4d6kh3",
      dice: [d6(5, true), d6(3, false), d6(6, true), d6(6, true)],
      constant: 0,
      total: 17,
      natural: null,
    });
    expect(lineText(rollSegments(kh3))).toBe("4d6kh3: 5 ~3~ + 6 + 6 = 17");
    // A dropped die first or last: no "+" of its own, one space on each side.
    const kl2 = item({
      expression: "3d6kh2",
      dice: [d6(1, false), d6(4, true), d6(6, true)],
      constant: 0,
      total: 10,
      natural: null,
    });
    expect(lineText(rollSegments(kl2))).toBe("3d6kh2: ~1~ 4 + 6 = 10");
    const last = item({
      expression: "3d6kh2",
      dice: [d6(4, true), d6(6, true), d6(1, false)],
      constant: 0,
      total: 10,
      natural: null,
    });
    expect(lineText(rollSegments(last))).toBe("3d6kh2: 4 + 6 ~1~ = 10");
    // Adv / dis stay as built.
    const adv = item({
      expression: "2d20kh1+5",
      mode: "advantage",
      dice: [d20(13, true), d20(7, false)],
      constant: 5,
      total: 18,
      natural: 13,
    });
    expect(lineText(rollSegments(adv))).toBe("2d20kh1+5 (adv): 13 ~7~ + 5 = 18");
    const dis = item({
      expression: "2d20kl1+5",
      mode: "disadvantage",
      dice: [d20(13, false), d20(7, true)],
      constant: 5,
      total: 12,
      natural: 7,
    });
    expect(lineText(rollSegments(dis))).toBe("2d20kl1+5 (dis): ~13~ 7 + 5 = 12");
    // FR-DICE-78: no stray spaces.
    for (const l of [kh3, kl2, last, adv, dis].map((i) => lineText(rollSegments(i)))) {
      expect(l).not.toMatch(/ {2}|\( | \)|^ | $/);
    }
  });
});

describe("FR-DICE-95 purpose in the line", () => {
  const line = (payload: RollPayloadItem[]) =>
    lineText(formatEntry({ kind: "roll", actorName: "Player 1", payload }).segments);

  test("FR-DICE-95 purpose line: types follow the values, unlabelled items read attack / damage", () => {
    const d8 = item({
      rollId: "a",
      expression: "1d8",
      dice: [{ faces: 8, value: 5, kept: true }],
      constant: 0,
      total: 5,
      natural: null,
      purpose: "damage",
      part: { type: "slashing", extra: false },
    });
    const d6 = item({
      rollId: "b",
      expression: "1d6",
      dice: [{ faces: 6, value: 3, kept: true }],
      constant: 0,
      total: 3,
      natural: null,
      purpose: "damage",
      part: { type: "fire", extra: true },
    });
    expect(line([d8, d6])).toBe("Player 1 — damage: 1d8 (5) slashing + 1d6 (3) fire = 8");
    // A lone typed damage item: its type after its value.
    expect(line([d8])).toBe("Player 1 — damage: 5 slashing = 5");
    // An attack without a label.
    expect(line([item({ purpose: "attack" })])).toBe("Player 1 — attack: 12 + 4 = 16");
    // A sheet row's label already names the type: unchanged.
    expect(line([{ ...d8, label: "Dagger damage (slashing)" }])).toBe(
      "Player 1 — Dagger damage (slashing): 5 = 5",
    );
    // Old entries (no purpose) render as before.
    expect(line([item()])).toBe("Player 1 — 1d20+4: 12 + 4 = 16");
    const { purpose: _p, ...oldBase } = d8;
    const { purpose: _q, ...oldExtra } = d6;
    expect(line([oldBase, oldExtra])).toBe(
      "Player 1 — Damage: 1d8 (5) slashing + 1d6 (3) fire = 8",
    );
  });

  test("FR-DICE-95 edited mark: a muted 'edited' after the name, with its Tooltip", () => {
    const segs = formatEntry({
      kind: "roll",
      actorName: "Brakka",
      payload: [item({ label: "Flame Tongue attack", purpose: "attack", edited: true })],
    }).segments;
    expect(lineText(segs)).toBe("Brakka — Flame Tongue attack edited: 12 + 4 = 16");
    expect(segs.find((s) => s.text === "edited")).toEqual({
      text: "edited",
      style: "muted",
      tip: "Dice changed in the tray",
    });
    const run = formatEntry({
      kind: "roll",
      actorName: "Brakka",
      payload: [
        item({
          rollId: "a",
          label: "Flame Tongue damage (slashing)",
          expression: "2d6+5",
          dice: [
            { faces: 6, value: 2, kept: true },
            { faces: 6, value: 4, kept: true },
          ],
          constant: 5,
          total: 11,
          natural: null,
          purpose: "damage",
          part: { type: "slashing", extra: false },
        }),
        item({
          rollId: "b",
          label: "Flame Tongue damage (slashing)",
          expression: "3d6",
          dice: [
            { faces: 6, value: 1, kept: true },
            { faces: 6, value: 1, kept: true },
            { faces: 6, value: 1, kept: true },
          ],
          constant: 0,
          total: 3,
          natural: null,
          purpose: "damage",
          part: { type: "fire", extra: true },
          edited: true,
        }),
      ],
    }).segments;
    expect(lineText(run)).toBe(
      "Brakka — Flame Tongue damage edited: 2d6+5 (2 + 4) slashing + 3d6 (1 + 1 + 1) fire = 14",
    );
    // Unedited: no mark.
    expect(lineText(rollSegments(item({ purpose: "attack" })))).toBe("attack: 12 + 4 = 16");
  });
});

describe("BL-162 the line names the actor once", () => {
  const text = (actorName: string, payload: RollPayloadItem[], category?: "attack") =>
    lineText(formatEntry({ kind: "roll", actorName, payload, category }).segments);

  test("BL-162 a label opening with the actor: 'Goblin — Hooked Blade attack', not twice", () => {
    expect(text("Goblin", [item({ label: "Goblin — Hooked Blade attack" })])).toBe(
      "Goblin — Hooked Blade attack: 12 + 4 = 16",
    );
    // Stat block checks build their labels the same way.
    expect(text("Goblin", [item({ label: "goblin — Dexterity save" })])).toBe(
      "Goblin — Dexterity save: 12 + 4 = 16",
    );
  });

  test("BL-162 the actor stays its own styled segment; the stored payload is untouched", () => {
    const payload = [item({ label: "Goblin — Hooked Blade attack" })];
    const segs = formatEntry({ kind: "roll", actorName: "Goblin", payload }).segments;
    expect(segs[0]).toEqual({ text: "Goblin", style: "actor" });
    expect(payload[0]?.label).toBe("Goblin — Hooked Blade attack");
  });

  test("BL-162 an unrelated label and an actor named like a part of it keep the whole label", () => {
    expect(text("Mira", [item({ label: "Perception" })])).toBe("Mira — Perception: 12 + 4 = 16");
    expect(text("Mira", [item({ label: "Wolf — Bite attack" })])).toBe(
      "Mira — Wolf — Bite attack: 12 + 4 = 16",
    );
    expect(text("Goblin", [item({ label: "Goblin Boss — Bite" })])).toBe(
      "Goblin — Goblin Boss — Bite: 12 + 4 = 16",
    );
  });

  test("BL-162 no label: the purpose, else the expression, as before", () => {
    expect(text("Goblin", [item()])).toBe("Goblin — 1d20+4: 12 + 4 = 16");
    expect(text("Goblin", [item({ purpose: "attack" })])).toBe("Goblin — attack: 12 + 4 = 16");
  });

  test("BL-162 every run of the line and a typed damage run lose the name", () => {
    const d6 = (type: "slashing" | "fire", extra: boolean, rollId: string) =>
      item({
        rollId,
        label: `Goblin — Hooked Blade damage (${type})`,
        expression: "1d6",
        dice: [{ faces: 6, value: 3, kept: true }],
        constant: 0,
        total: 3,
        natural: null,
        purpose: "damage",
        part: { type, extra },
      });
    expect(
      text(
        "Goblin",
        [item({ label: "Goblin — Hooked Blade attack" }), d6("slashing", false, "r2")],
        "attack",
      ),
    ).toBe("Goblin — Hooked Blade attack: 12 + 4 = 16; Hooked Blade damage (slashing): 3 = 3");
    expect(text("Goblin", [d6("slashing", false, "r2"), d6("fire", true, "r3")])).toBe(
      "Goblin — Hooked Blade damage: 1d6 (3) slashing + 1d6 (3) fire = 6",
    );
  });
});
