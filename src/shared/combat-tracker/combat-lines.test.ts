// Sprint 5 R2 (track R, BL-24 / BL-27 / BL-23): combat log wording, pure. The ruling's full stop
// (FR-CBT-95), the DM's line counting each number once (FR-CBT-96), trigger parts naming their
// damage type (FR-MOD-62). Built from `payload` / `dmPayload` alone, so old rows read the same.
import { describe, expect, test } from "bun:test";
import { type LineSegment, lineText } from "@shared/dice-roll-log/kind-types";
import { formatEntry } from "@shared/dice-roll-log/line";
import { linePartSegments } from "@shared/effect-modifiers/combat-parts";

const segments = (e: { payload: unknown; dmPayload?: unknown }, actorName = "Mira") =>
  formatEntry({ kind: "cbt.attack", actorName, ...e }).segments;
const line = (e: { payload: unknown; dmPayload?: unknown }, actorName?: string) =>
  lineText(segments(e, actorName));
/** The line as read without its muted runs (DM-only detail). */
const outsideMuted = (s: readonly LineSegment[]) => lineText(s.filter((x) => x.style !== "muted"));

const shortsword = {
  targetName: "Goblin",
  attackName: "Shortsword",
  damageType: "piercing",
  toHit: { dice: 9, constant: 4, total: 13, natural: 9 },
  hit: true,
  damage: 10,
  multiplier: "normal" as const,
  crit: false,
};
const ruledDm = (hit: boolean) => ({
  targetAc: 16,
  hitComputed: !hit,
  toHitRolled: 13,
  damageRolled: hit ? 10 : null,
  damageTotal: hit ? 10 : 0,
  applied: hit ? 10 : 0,
  overkill: 0,
  overrides: { toHit: false, hit: true, damage: false },
});

describe("FR-CBT-95 ruling punctuation", () => {
  test("FR-CBT-95 ruling punctuation: 'DM ruled hit.' before the damage (DM, natural for players); a hit line without damage ends at '.'; miss unchanged", () => {
    expect(line({ payload: shortsword, dmPayload: ruledDm(true) })).toBe(
      "Mira attacks Goblin: 9 + 4 = 13 vs AC 16 — DM ruled hit. 10 piercing damage",
    );
    // A non-natural ruling stays DM-only (#178 G8): players read "— DM: hit." either way.
    expect(line({ payload: shortsword })).toBe(
      "Mira attacks Goblin: 9 + 4 = 13 — DM: hit. 10 piercing damage",
    );
    // A natural ruling is public (FR-CBT-58): the same full stop for players.
    const natural1 = { ...shortsword, toHit: { dice: 1, constant: 4, total: 5, natural: 1 } };
    expect(line({ payload: { ...natural1, damage: 6 } })).toBe(
      "Mira attacks Goblin: 1 + 4 = 5 (natural 1) — DM ruled hit. 6 piercing damage",
    );
    // FR-CBT-88: an Apply hit line ends at the full stop.
    const awaiting = { ...shortsword, damage: 0, awaitingDamage: true as const };
    expect(line({ payload: awaiting, dmPayload: ruledDm(true) })).toBe(
      "Mira attacks Goblin: 9 + 4 = 13 vs AC 16 — DM ruled hit.",
    );
    expect(line({ payload: { ...natural1, damage: 0, awaitingDamage: true as const } })).toBe(
      "Mira attacks Goblin: 1 + 4 = 5 (natural 1) — DM ruled hit.",
    );
    // "— DM ruled miss" unchanged.
    const miss = { ...shortsword, hit: false, damage: 0 };
    expect(line({ payload: miss, dmPayload: ruledDm(false) })).toBe(
      "Mira attacks Goblin: 9 + 4 = 13 vs AC 16 — DM ruled miss",
    );
  });
});

// Brakka's Flame Tongue greatsword with Rage: base 2d6+5 (4 + 3 + 5) + Rage 2 = 14 slashing, extra
// 2d6 fire (2 + 4) = 6.
const flameTongue = {
  targetName: "Goblin",
  attackName: "Flame Tongue",
  damageType: "slashing",
  toHit: { dice: 14, constant: 8, total: 22, natural: 14 },
  hit: true,
  damage: 20,
  multiplier: "normal" as const,
  crit: false,
  damageParts: [{ type: "fire" as const, value: 6 }],
};
const rageDm = {
  targetAc: 13,
  hitComputed: true,
  toHitRolled: 22,
  damageRolled: 14,
  damageTotal: 14,
  applied: 20,
  overkill: 0,
  overrides: { toHit: false, hit: false, damage: false },
  rolls: {
    damage: {
      expression: "2d6+5",
      dice: [
        [4, true],
        [3, true],
      ] as [number, boolean][],
      constant: 5,
      crit: false,
    },
    extra: [
      {
        type: "fire" as const,
        expression: "2d6",
        dice: [
          [2, true],
          [4, true],
        ] as [number, boolean][],
        constant: 0,
        rolled: 6,
      },
    ],
  },
  mods: { damage: [{ label: "Rage", value: 2 }] },
};

/** The damage numbers of a line's text (after its outcome), summed. */
const damageSum = (text: string) =>
  (text.split(/ — [^0-9]*/)[1] ?? "").match(/\d+/g)?.reduce((s, n) => s + Number(n), 0) ?? 0;

describe("FR-CBT-96 Rage once in the DM line", () => {
  test("FR-CBT-96 Rage once in the DM line: 'incl. + 2 Rage' inside the base run; text outside muted runs sums to the damage; players unchanged", () => {
    const dm = segments({ payload: flameTongue, dmPayload: rageDm }, "Brakka");
    expect(lineText(dm)).toBe(
      "Brakka attacks Goblin: 14 + 8 = 22 vs AC 13 — hit! 14 slashing (2d6+5: 4 + 3 + 5, incl. + 2 Rage) + 6 fire (2d6: 2 + 4) damage",
    );
    expect(outsideMuted(dm)).toBe(
      "Brakka attacks Goblin: 14 + 8 = 22 vs AC 13 — hit! 14 slashing + 6 fire damage",
    );
    expect(damageSum(outsideMuted(dm))).toBe(flameTongue.damage);
    // Never a "+ 2 Rage" between parts.
    expect(outsideMuted(dm)).not.toContain("Rage");
    // Players: unchanged, no DM detail.
    expect(line({ payload: flameTongue }, "Brakka")).toBe(
      "Brakka attacks Goblin: 14 + 8 = 22 — DM: hit. 14 slashing + 6 fire damage",
    );
  });

  test("FR-CBT-96 no extra parts: the same; with a trigger part and no dice (DM set) the run still holds Rage", () => {
    const plain = { ...flameTongue, damage: 14, damageParts: undefined };
    const dmPlain = { ...rageDm, rolls: { damage: rageDm.rolls.damage } };
    const dm = segments({ payload: plain, dmPayload: dmPlain }, "Brakka");
    expect(lineText(dm)).toBe(
      "Brakka attacks Goblin: 14 + 8 = 22 vs AC 13 — hit! 14 slashing damage (2d6+5: 4 + 3 + 5, incl. + 2 Rage)",
    );
    expect(damageSum(outsideMuted(dm))).toBe(14);

    // A DM-set total (no dice run) + Divine Fury: "(DM set; rolled 14) (incl. + 2 Rage)".
    const fury = {
      ...plain,
      damage: 22,
      parts: [{ label: "Divine Fury", value: 6, type: "radiant" as const }],
    };
    const dmSet = {
      ...rageDm,
      rolls: undefined,
      damageTotal: 16,
      overrides: { toHit: false, hit: false, damage: true },
    };
    const set = segments({ payload: { ...fury, damage: 22 }, dmPayload: dmSet }, "Brakka");
    expect(lineText(set)).toBe(
      "Brakka attacks Goblin: 14 + 8 = 22 vs AC 13 — hit! 16 slashing damage (DM set; rolled 14) (incl. + 2 Rage) + 6 radiant (Divine Fury)",
    );
    expect(damageSum(outsideMuted(set))).toBe(22);
    // To-hit parts unchanged: "12 + 4 + 2 Bless = 18" adds up.
    const bless = {
      ...shortsword,
      toHit: {
        dice: 12,
        constant: 4,
        mods: [{ label: "Bless", value: 2 }],
        total: 18,
        natural: 12,
      },
    };
    expect(line({ payload: bless })).toContain("12 + 4 + 2 Bless = 18");
  });
});

describe("FR-MOD-62 damage types on trigger parts", () => {
  test("FR-MOD-62 damage types on trigger parts: the part's type, else the card's; '(DM)' typed for players; neither typed → untyped; DM and players alike", () => {
    const sneak = { label: "Sneak Attack", value: 10, type: null };
    expect(lineText(linePartSegments([sneak], null, "piercing"))).toBe(
      " + 10 piercing (Sneak Attack)",
    );
    // Typed as the card: named too (was "+ 10 Sneak Attack").
    expect(lineText(linePartSegments([{ ...sneak, type: "piercing" }], null, "piercing"))).toBe(
      " + 10 piercing (Sneak Attack)",
    );
    const fury = { label: "Divine Fury", value: 6, type: "radiant" };
    expect(lineText(linePartSegments([fury], null, "slashing"))).toBe(" + 6 radiant (Divine Fury)");
    expect(
      lineText(linePartSegments([{ label: null, value: 9, type: null }], null, "slashing")),
    ).toBe(" + 9 slashing (DM)");
    expect(lineText(linePartSegments([sneak], null, null))).toBe(" + 10 Sneak Attack");
    // The DM's line names the part with the same type word.
    const dm = [{ label: "Sneak Attack", rolled: 10 }];
    expect(lineText(linePartSegments([{ ...sneak, label: null }], dm, "piercing"))).toBe(
      " + 10 piercing (Sneak Attack)",
    );

    // On Thorn's outcome line, players and DM alike; the dice segments are unchanged.
    const thorn = {
      ...shortsword,
      damage: 16,
      parts: [{ ...sneak, expression: "3d6", dice: [3, 4, 3] }],
    };
    const players = segments({ payload: thorn }, "Thorn");
    expect(lineText(players)).toBe(
      "Thorn attacks Goblin: 9 + 4 = 13 — DM: hit. 6 piercing damage + 10 piercing (Sneak Attack) (3d6: 3 + 4 + 3)",
    );
    expect(players.filter((s) => s.die).map((s) => s.die?.label)).toEqual([
      "Sneak Attack",
      "Sneak Attack",
      "Sneak Attack",
    ]);
    const dmLine = line(
      {
        payload: thorn,
        dmPayload: {
          ...ruledDm(true),
          overrides: { toHit: false, hit: false, damage: false },
          hitComputed: true,
          targetAc: 13,
        },
      },
      "Thorn",
    );
    expect(dmLine).toContain("6 piercing damage + 10 piercing (Sneak Attack)");
  });
});
