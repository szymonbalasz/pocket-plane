// S4-5 (FR-MOD-57, FR-CBT-84; seams S8 / rulings B4, B5, B9): trigger and weapon extra-part dice
// as D5's per-die `die` segments, built only from `payload` (players) / `dmPayload` (DM); the
// FR-DICE-28 kind contract with sentinels in the new fields.
import { describe, expect, test } from "bun:test";
import type { AttackLogDmPayload, AttackLogPayload } from "@shared/combat-tracker/log-kinds";
import { type LineSegment, lineText } from "@shared/dice-roll-log/kind-types";
import { formatEntry } from "@shared/dice-roll-log/line";
import type { RollPayloadItem } from "@shared/dice-roll-log/schemas";
import { linePartSegments, rollOfferSegments } from "./combat-parts";
import { modSegments, partDiceView } from "./line";

const dice = (segs: readonly LineSegment[]) => segs.flatMap((s) => (s.die ? [s.die] : []));

/** Brakka's outcome line (MOD §13.1 step 4): Divine Fury 1d6+2 rolled 4 → 6, public. */
const brakkaLine: AttackLogPayload = {
  targetName: "Goblin",
  attackName: "Flame Tongue greatsword",
  damageType: "slashing",
  toHit: { dice: 14, constant: 8, total: 22, natural: 14 },
  hit: true,
  damage: 25,
  multiplier: "normal",
  crit: false,
  parts: [{ label: "Divine Fury", value: 6, type: "radiant", expression: "1d6+2", dice: [4] }],
  damageParts: [{ type: "fire", value: 4, multiplier: "half" }],
};
const brakkaDm: AttackLogDmPayload = {
  targetAc: 15,
  hitComputed: true,
  toHitRolled: 22,
  damageRolled: 15,
  damageTotal: 15,
  applied: 25,
  overkill: 0,
  overrides: { toHit: false, hit: false, damage: false },
  rolls: {
    damage: {
      expression: "2d6+5",
      dice: [
        [3, true],
        [5, true],
      ],
      constant: 5,
      crit: false,
    },
    extra: [
      {
        type: "fire",
        expression: "2d6",
        dice: [
          [2, true],
          [6, true],
        ],
        constant: 0,
        rolled: 8,
      },
    ],
  },
  parts: [
    {
      triggerId: "df",
      label: "Divine Fury",
      rolled: 6,
      expression: "1d6+2",
      dice: [4],
    },
  ],
};
const attack = (payload: unknown, dmPayload?: unknown) =>
  formatEntry({ kind: "cbt.attack", actorName: "Brakka", payload, dmPayload }).segments;

describe("FR-MOD-57 Divine Fury line in the combat log", () => {
  test("FR-MOD-57 outcome line: '+ 6 radiant (Divine Fury)' then one d6 die segment labelled Divine Fury, from payload (players) and dmPayload (DM)", () => {
    const players = attack(brakkaLine);
    expect(lineText(players)).toBe(
      "Brakka attacks Goblin: 14 + 8 = 22 — DM: hit. 15 slashing + 4 fire (half) damage + 6 radiant (Divine Fury) (1d6+2: 4 + 2)",
    );
    expect(dice(players)).toEqual([{ faces: 6, value: 4, kept: true, label: "Divine Fury" }]);
    // The DM's line: the same die from `dmPayload` (here the payload has none), plus the
    // weapon's breakdown and the extra part's dice labelled with its name.
    const dmOnly = attack(
      { ...brakkaLine, parts: [{ label: "Divine Fury", value: 6, type: "radiant" }] },
      brakkaDm,
    );
    expect(lineText(dmOnly)).toContain(
      "+ 4 fire (half) (2d6: 2 + 6) damage + 6 radiant (Divine Fury) (1d6+2: 4 + 2)",
    );
    expect(dice(dmOnly)).toEqual([
      { faces: 6, value: 3, kept: true },
      { faces: 6, value: 5, kept: true },
      { faces: 6, value: 2, kept: true, label: "Flame Tongue greatsword fire" },
      { faces: 6, value: 6, kept: true, label: "Flame Tongue greatsword fire" },
      { faces: 6, value: 4, kept: true, label: "Divine Fury" },
    ]);
  });

  test("FR-MOD-57 the roll line's offered die: offered: true (not kept: false), label 'Divine Fury (on a hit)'", () => {
    const segs = rollOfferSegments([
      {
        label: "Divine Fury",
        value: 6,
        type: "radiant",
        expression: "1d6+2",
        dice: [4],
        auto: true,
      },
    ]);
    expect(lineText(segs)).toBe(
      " (+ 6 radiant Divine Fury (rolled for you) (1d6+2: 4 + 2) on a hit)",
    );
    expect(dice(segs)).toEqual([
      { faces: 6, value: 4, kept: true, offered: true, label: "Divine Fury (on a hit)" },
    ]);
    expect(segs.every((s) => s.style === "muted")).toBe(true);
    // One die that is the whole value: the chip stands in for the number, text unchanged.
    const one = rollOfferSegments([
      { label: "Hunter's Mark", value: 5, type: null, expression: "1d6", dice: [5] },
    ]);
    expect(lineText(one)).toBe(" (+ 5 Hunter's Mark on a hit)");
    expect(dice(one)).toEqual([
      { faces: 6, value: 5, kept: true, offered: true, label: "Hunter's Mark (on a hit)" },
    ]);
  });

  test("FR-MOD-57 a part players read as (DM) shows its value only; the DM's names bring its dice", () => {
    const offered = [{ label: null, value: 9, type: null, expression: "2d6", dice: [3, 6] }];
    expect(dice(rollOfferSegments(offered))).toEqual([]);
    expect(lineText(rollOfferSegments(offered))).toBe(" (+ 9 (DM) on a hit)");
    const dm = rollOfferSegments(offered, [{ label: "Sneak Attack" }]);
    expect(dice(dm).map((d) => d.label)).toEqual([
      "Sneak Attack (on a hit)",
      "Sneak Attack (on a hit)",
    ]);
    const mods = [{ label: null, value: 3, expression: "1d4", rollId: "r2", dice: [3] }];
    expect(dice(modSegments(mods))).toEqual([]);
    expect(dice(modSegments(mods, [{ effectId: "e1", label: "Bless" }]))).toEqual([
      { faces: 4, value: 3, kept: true, label: "Bless" },
    ]);
  });

  test("FR-MOD-57 roll-line mods: Bless 1d4 → its chip in place of the number (text unchanged); a roll trigger 1d6+2 after its name", () => {
    const segs = modSegments([
      { label: "Bless", value: 3, expression: "1d4", rollId: "r2", dice: [3] },
      { label: "Fury", value: 6, expression: "1d6+2", dice: [4] },
      { label: "Bane", value: -2, expression: "1d4", rollId: "r3", dice: [2] },
    ]);
    expect(lineText(segs)).toBe(" + 3 Bless + 6 Fury (1d6+2: 4 + 2) − 2 Bane");
    expect(dice(segs)).toEqual([
      { faces: 4, value: 3, kept: true, label: "Bless" },
      { faces: 6, value: 4, kept: true, label: "Fury" },
      { faces: 4, value: 2, kept: true, label: "Bane" },
    ]);
    // Without per-die values (old rows, > 20 dice): as before, no die.
    expect(dice(modSegments([{ label: "Bless", value: 3, expression: "1d4" }]))).toEqual([]);
  });

  test("FR-MOD-57 DM value edit: players the value only; the DM's '(DM set; rolled 6)' with the dice; a halved part keeps its number", () => {
    const parts = [{ label: "Divine Fury", value: 9, type: "radiant" }];
    const dm = [
      { label: "Divine Fury", rolled: 6, set: true as const, expression: "1d6+2", dice: [4] },
    ];
    expect(dice(linePartSegments(parts, null, "slashing"))).toEqual([]);
    const dmLine = linePartSegments(parts, dm, "slashing");
    expect(lineText(dmLine)).toBe(" + 9 radiant (Divine Fury) (DM set; rolled 6) (1d6+2: 4 + 2)");
    expect(dice(dmLine)).toHaveLength(1);
    const half = linePartSegments(
      [
        {
          label: "Hex",
          value: 2,
          type: "necrotic",
          multiplier: "half",
          expression: "1d6",
          dice: [5],
        },
      ],
      null,
      "slashing",
    );
    expect(lineText(half)).toBe(" + 2 necrotic (Hex) (half) (1d6: 5)");
  });

  test("FR-MOD-57 non-public parts: no die segment for players even if dice were present; the DM's line has them", () => {
    const parts = [{ label: null, value: 9, type: null, expression: "2d6", dice: [3, 6] }];
    expect(dice(linePartSegments(parts, null, "slashing"))).toEqual([]);
    const dm = [{ label: "Martial Advantage", rolled: 9, expression: "2d6", dice: [3, 6] }];
    expect(dice(linePartSegments([{ label: null, value: 9, type: null }], dm, "slashing"))).toEqual(
      [
        { faces: 6, value: 3, kept: true, label: "Martial Advantage" },
        { faces: 6, value: 6, kept: true, label: "Martial Advantage" },
      ],
    );
  });

  test("FR-MOD-57 old lines render as before (no expression / dice)", () => {
    const old = { ...brakkaLine, parts: [{ label: "Divine Fury", value: 6, type: "radiant" }] };
    expect(lineText(attack(old))).toBe(
      "Brakka attacks Goblin: 14 + 8 = 22 — DM: hit. 15 slashing + 4 fire (half) damage + 6 radiant (Divine Fury)",
    );
    expect(dice(attack(old))).toEqual([]);
  });

  test("FR-DICE-36 segment format (S8 / B5): every die segment carries one die {faces, value, kept, offered?, label?}; never muted-as-not-applied", () => {
    const all = [
      // The parts only (the base weapon dice are D5's, unlabelled).
      ...attack(brakkaLine, { ...brakkaDm, rolls: { extra: brakkaDm.rolls?.extra } }),
      ...rollOfferSegments([
        { label: "Divine Fury", value: 6, type: "radiant", expression: "1d6+2", dice: [4] },
      ]),
      ...modSegments([{ label: "Bless", value: 3, expression: "1d4", dice: [3] }]),
    ];
    for (const d of dice(all)) {
      expect(
        Object.keys(d).every((k) => ["faces", "value", "kept", "offered", "label"].includes(k)),
      ).toBe(true);
      expect(d.kept).toBe(true);
      expect(d.label).toBeString();
    }
    const view = partDiceView({ expression: "1d8+1d6", dice: [5, 2] }, 6, "Smite");
    expect(dice(view.after).map((d) => d.faces)).toEqual([8, 6]);
    // Unparsable or a count mismatch → round chips (faces null), still labelled.
    const odd = partDiceView({ expression: "2d6", dice: [5] }, 5, "Odd");
    expect(dice(odd.after)).toEqual([{ faces: null, value: 5, kept: true, label: "Odd" }]);
  });
});

const S = "DMONLY";
const N = 7777;

describe("FR-DICE-28 kind contract (S4-5 fields)", () => {
  test("FR-DICE-28 cbt.attack: trigger dice, extra-part dice and roll ids in dmPayload never reach the players' line", () => {
    const payload: AttackLogPayload = {
      ...brakkaLine,
      // A monster's public trigger: name and value public, dice DM-only.
      parts: [{ label: "Martial Advantage", value: 9, type: null }],
    };
    const dm = {
      ...brakkaDm,
      rolls: {
        extra: [
          {
            type: "fire",
            expression: S,
            dice: [[N, true]],
            constant: N,
            rolled: N,
            set: true,
          },
        ],
      },
      parts: [{ triggerId: S, label: S, rolled: N, set: true, expression: S, dice: [N] }],
      rollIds: [S],
    };
    expect(
      formatEntry({ kind: "cbt.attack", actorName: "Elite", payload, dmPayload: dm }).supported,
    ).toBe(true);
    const players = attack(payload);
    expect(lineText(players)).not.toContain(S);
    expect(lineText(players)).not.toContain(String(N));
    expect(dice(players)).toEqual([]);
    expect(lineText(players)).toContain("+ 9 slashing (Martial Advantage)");
    const dmLine = attack(payload, dm);
    expect(dice(dmLine).map((d) => d.value)).toEqual([N, N]);
  });

  test("FR-DICE-28 roll: offered and mod dice from the payload only; DM names never in the players' line", () => {
    const item: RollPayloadItem = {
      rollId: "r1",
      expression: "1d12+4",
      mode: "normal",
      manual: false,
      dice: [{ faces: 12, value: 8, kept: true }],
      constant: 4,
      total: 15,
      natural: null,
      label: "Greataxe damage",
      mods: [{ label: null, value: 3, expression: "1d4", rollId: "r2", dice: [3] }],
      offered: [
        { label: null, value: 9, expression: "2d6", rollId: "r3", type: null, dice: [3, 6] },
      ],
    };
    const dmPayload = {
      items: [
        {
          mods: [{ effectId: S, label: S }],
          offered: [{ triggerId: S, label: S }],
        },
      ],
    };
    const players = formatEntry({ kind: "roll", actorName: "Brakka", payload: [item] }).segments;
    expect(lineText(players)).not.toContain(S);
    expect(dice(players)).toEqual([{ faces: 12, value: 8, kept: true }]);
    const dm = formatEntry({
      kind: "roll",
      actorName: "Brakka",
      payload: [item],
      dmPayload,
    }).segments;
    expect(dice(dm).map((d) => d.label)).toEqual([
      undefined,
      S,
      `${S} (on a hit)`,
      `${S} (on a hit)`,
    ]);
  });
});
