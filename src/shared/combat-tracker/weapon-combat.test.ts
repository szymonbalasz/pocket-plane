// Sprint 4 S4-1b (track R): the players' outcome wording (FR-CBT-85, BL-10) and the outcome line
// with weapon damage parts (FR-CBT-84), pure.
import { describe, expect, test } from "bun:test";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { formatEntry } from "@shared/dice-roll-log/line";

const line = (e: { payload: unknown; dmPayload?: unknown }, actorName = "Mira") =>
  lineText(formatEntry({ kind: "cbt.attack", actorName, ...e }).segments);

const base = {
  targetName: "Goblin",
  attackName: "Shortsword",
  damageType: "piercing",
  toHit: { dice: 12, constant: 4, total: 16, natural: 12 },
  hit: true,
  damage: 6,
  multiplier: "normal" as const,
  crit: false,
};
const dm = (o: { hitComputed?: boolean; hit?: boolean } = {}) => ({
  targetAc: 15,
  hitComputed: o.hitComputed ?? true,
  toHitRolled: 16,
  damageRolled: 6,
  damageTotal: 6,
  applied: 6,
  overkill: 0,
  overrides: { toHit: false, hit: o.hit ?? false, damage: false },
});

describe("FR-CBT-85 BL-10 wording", () => {
  test("FR-CBT-85 players read '— DM: hit.' / '— DM: miss' / '— DM: critical hit!'; the DM's line is unchanged", () => {
    expect(line({ payload: base })).toBe(
      "Mira attacks Goblin: 12 + 4 = 16 — DM: hit. 6 piercing damage",
    );
    expect(line({ payload: base, dmPayload: dm() })).toBe(
      "Mira attacks Goblin: 12 + 4 = 16 vs AC 15 — hit! 6 piercing damage",
    );
    const miss = { ...base, hit: false, damage: 0 };
    expect(line({ payload: miss })).toBe("Mira attacks Goblin: 12 + 4 = 16 — DM: miss");
    expect(line({ payload: miss, dmPayload: dm({ hitComputed: false }) })).toBe(
      "Mira attacks Goblin: 12 + 4 = 16 vs AC 15 — miss",
    );
    const crit = {
      ...base,
      toHit: { dice: 20, constant: 4, total: 24, natural: 20 },
      damage: 12,
      crit: true,
    };
    expect(line({ payload: crit })).toBe(
      "Mira attacks Goblin: 20 + 4 = 24 (natural 20) — DM: critical hit! 12 piercing damage",
    );
    expect(line({ payload: crit, dmPayload: dm() })).toBe(
      "Mira attacks Goblin: 20 + 4 = 24 (natural 20) vs AC 15 — critical hit! 12 piercing damage",
    );
  });

  test("FR-CBT-85 a ruled hit / miss reads the same for players as an unruled one; the DM sees the ruling", () => {
    // The DM overrode a computed miss: players can't tell (#178 G8).
    expect(line({ payload: base })).toBe(line({ payload: base }));
    expect(line({ payload: base })).toContain("— DM: hit.");
    expect(line({ payload: base, dmPayload: dm({ hitComputed: false, hit: true }) })).toBe(
      "Mira attacks Goblin: 12 + 4 = 16 vs AC 15 — DM ruled hit. 6 piercing damage",
    );
    const miss = { ...base, hit: false, damage: 0 };
    expect(line({ payload: miss })).toBe("Mira attacks Goblin: 12 + 4 = 16 — DM: miss");
    expect(line({ payload: miss, dmPayload: dm({ hitComputed: true, hit: true }) })).toBe(
      "Mira attacks Goblin: 12 + 4 = 16 vs AC 15 — DM ruled miss",
    );
  });

  test("FR-CBT-85 natural rulings stay public as FR-CBT-58", () => {
    const nat1 = { ...base, toHit: { dice: 1, constant: 4, total: 5, natural: 1 } };
    expect(line({ payload: nat1 })).toBe(
      "Mira attacks Goblin: 1 + 4 = 5 (natural 1) — DM ruled hit. 6 piercing damage",
    );
    const nat20 = {
      ...base,
      toHit: { dice: 20, constant: 4, total: 24, natural: 20 },
      hit: false,
      damage: 0,
      crit: true,
    };
    expect(line({ payload: nat20 })).toBe(
      "Mira attacks Goblin: 20 + 4 = 24 (natural 20) — DM ruled miss",
    );
  });
});

describe("FR-CBT-84 outcome line parts", () => {
  const brakka = {
    targetName: "Goblin",
    attackName: "Flame Tongue greatsword",
    damageType: "slashing",
    toHit: { dice: 14, constant: 8, total: 22, natural: 14 },
    hit: true,
    damage: 25,
    multiplier: "normal" as const,
    crit: false,
    damageParts: [{ type: "fire", value: 4, multiplier: "half" as const }],
    parts: [{ label: "Divine Fury", value: 6, type: "radiant" }],
  };
  const brakkaDm = {
    ...dm(),
    targetAc: 13,
    damageRolled: 15,
    damageTotal: 15,
    applied: 25,
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
    parts: [{ triggerId: "t1", label: "Divine Fury", rolled: 6 }],
  };

  test("FR-CBT-84 players: '15 slashing + 4 fire (half) damage + 6 radiant (Divine Fury)', no extra-part dice", () => {
    expect(line({ payload: brakka }, "Brakka")).toBe(
      "Brakka attacks Goblin: 14 + 8 = 22 — DM: hit. 15 slashing + 4 fire (half) damage + 6 radiant (Divine Fury)",
    );
  });

  test("FR-CBT-84 DM: each part's dice after it (from dmPayload.rolls.extra), 'DM set' per part", () => {
    expect(line({ payload: brakka, dmPayload: brakkaDm }, "Brakka")).toBe(
      "Brakka attacks Goblin: 14 + 8 = 22 vs AC 13 — hit! 15 slashing (2d6+5: 3 + 5 + 5) + 4 fire (half) (2d6: 2 + 6) damage + 6 radiant (Divine Fury)",
    );
    const set = {
      ...brakkaDm,
      rolls: {
        ...brakkaDm.rolls,
        extra: [{ ...brakkaDm.rolls.extra[0], set: true as const }],
      },
    };
    expect(line({ payload: brakka, dmPayload: set }, "Brakka")).toContain(
      "+ 4 fire (half) (DM set; rolled 8) (2d6: 2 + 6) damage",
    );
  });

  test("FR-CBT-84 base multiplier after the base part; a line without parts reads as before", () => {
    const half = {
      ...brakka,
      damage: 7 + 8 + 6,
      multiplier: "half" as const,
      damageParts: [{ type: "fire", value: 8 }],
    };
    expect(line({ payload: half }, "Brakka")).toBe(
      "Brakka attacks Goblin: 14 + 8 = 22 — DM: hit. 7 slashing (half) + 8 fire damage + 6 radiant (Divine Fury)",
    );
    const { damageParts: _d, parts: _p, ...plain } = brakka;
    expect(line({ payload: { ...plain, damage: 15, multiplier: "half" } }, "Brakka")).toBe(
      "Brakka attacks Goblin: 14 + 8 = 22 — DM: hit. 15 slashing damage (half)",
    );
  });
});
