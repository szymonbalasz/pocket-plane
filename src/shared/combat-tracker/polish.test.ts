// Polish pass (sprint 1, #178): FR-CBT-58 public rulings against a natural roll.
import { describe, expect, test } from "bun:test";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { formatEntry } from "@shared/dice-roll-log/line";
import { naturalMark, publicRuling } from "./log-kinds";

describe("FR-CBT-58 formatLine", () => {
  const nat1 = {
    targetName: "Goblin",
    attackName: "Shortsword",
    damageType: "piercing",
    toHit: { dice: 1, constant: 4, total: 5, natural: 1 },
    hit: true,
    damage: 6,
    multiplier: "normal" as const,
    crit: false,
    manual: { toHit: true, damage: true },
  };
  const dm = (hitComputed: boolean, hit: boolean) => ({
    targetAc: 15,
    hitComputed,
    toHitRolled: 5,
    damageRolled: 6,
    damageTotal: 6,
    applied: 6,
    overkill: 0,
    overrides: { toHit: false, hit, damage: false },
  });
  const line = (e: { payload: unknown; dmPayload?: unknown }) =>
    lineText(formatEntry({ kind: "cbt.attack", actorName: "Mira", ...e }).segments);

  test("FR-CBT-58 natural 1 + hit → '(natural 1) — DM ruled hit' for player and DM", () => {
    expect(line({ payload: nat1 })).toBe(
      "Mira attacks Goblin: 1 + 4 = 5 (physical) (natural 1) — DM ruled hit 6 piercing damage (physical)",
    );
    expect(line({ payload: nat1, dmPayload: dm(false, true) })).toBe(
      "Mira attacks Goblin: 1 + 4 = 5 (physical) (natural 1) vs AC 15 — DM ruled hit 6 piercing damage (physical)",
    );
  });

  test("FR-CBT-58 natural 20 + miss → 'DM ruled miss' for everyone", () => {
    const nat20 = {
      ...nat1,
      toHit: { dice: 20, constant: 4, total: 24, natural: 20 },
      hit: false,
      damage: 0,
      crit: true,
      manual: undefined,
    };
    expect(line({ payload: nat20 })).toBe(
      "Mira attacks Goblin: 20 + 4 = 24 (natural 20) — DM ruled miss",
    );
    expect(line({ payload: nat20, dmPayload: dm(true, true) })).toBe(
      "Mira attacks Goblin: 20 + 4 = 24 (natural 20) vs AC 15 — DM ruled miss",
    );
  });

  test("FR-CBT-58 natural 20 + hit → '(natural 20) — critical hit!'; natural 1 + miss → plain miss", () => {
    const crit = {
      ...nat1,
      toHit: { dice: 20, constant: 4, total: 24, natural: 20 },
      damage: 12,
      crit: true,
      manual: undefined,
    };
    expect(line({ payload: crit })).toBe(
      "Mira attacks Goblin: 20 + 4 = 24 (natural 20) — critical hit! 12 piercing damage",
    );
    const fumble = { ...nat1, hit: false, damage: 0, manual: undefined };
    expect(line({ payload: fumble })).toBe("Mira attacks Goblin: 1 + 4 = 5 (natural 1) — miss");
  });

  test("FR-CBT-58 a non-natural override stays DM-only: player 'hit!', DM 'DM ruled hit'", () => {
    const p = {
      ...nat1,
      toHit: { dice: 9, constant: 4, total: 13, natural: 9 },
      manual: undefined,
    };
    expect(line({ payload: p })).toBe("Mira attacks Goblin: 9 + 4 = 13 — hit! 6 piercing damage");
    expect(line({ payload: p })).not.toContain("DM ruled");
    expect(line({ payload: p, dmPayload: { ...dm(false, true), toHitRolled: 13 } })).toBe(
      "Mira attacks Goblin: 9 + 4 = 13 vs AC 15 — DM ruled hit 6 piercing damage",
    );
  });

  test("FR-CBT-58 old rows (no manual, natural null) render as before", () => {
    const old = {
      ...nat1,
      toHit: { dice: null, constant: 4, total: 16, natural: null },
      manual: undefined,
    };
    expect(line({ payload: old })).toBe("Mira attacks Goblin: 16 — hit! 6 piercing damage");
  });

  test("FR-CBT-58 helpers: marks only 1 / 20; ruling only on a contradiction", () => {
    expect([1, 20, 2, 19, null].map(naturalMark)).toEqual([1, 20, null, null, null]);
    expect(publicRuling(1, true)).toBe(true);
    expect(publicRuling(20, false)).toBe(true);
    expect(publicRuling(1, false)).toBe(false);
    expect(publicRuling(20, true)).toBe(false);
    expect(publicRuling(9, true)).toBe(false);
    expect(publicRuling(null, false)).toBe(false);
  });
});
