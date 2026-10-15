import { describe, expect, test } from "bun:test";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { formatEntry } from "@shared/dice-roll-log/line";
import {
  canRollInitiative,
  showRollMonsters,
  skippedOnStep,
  skippedText,
  unrolledMonsters,
} from "./rules";

describe("FR-CBT-46 roll controls by round × initiative", () => {
  test("FR-CBT-46 round 0: every row rolls; round ≥ 1: only rows without initiative", () => {
    expect(canRollInitiative(0, null)).toBe(true);
    expect(canRollInitiative(0, 12)).toBe(true);
    expect(canRollInitiative(1, null)).toBe(true);
    expect(canRollInitiative(1, 12)).toBe(false);
    expect(canRollInitiative(3, 0)).toBe(false);
    expect(canRollInitiative(2, undefined)).toBe(true);
  });

  test("FR-CBT-46 Roll monsters: non-removed monsters without initiative; hidden when none", () => {
    const rows = [
      { id: "g", kind: "monster" as const, removed: false, initiative: 12 },
      { id: "g2", kind: "monster" as const, removed: true, initiative: null },
      { id: "m", kind: "pc" as const, removed: false, initiative: null },
    ];
    expect(unrolledMonsters(rows)).toEqual([]);
    // Sprint 2 (FR-CBT-64): round 0 hides it too when nothing is left to roll.
    expect(showRollMonsters(0, 0)).toBe(false);
    expect(showRollMonsters(0, 2)).toBe(true);
    expect(showRollMonsters(1, 0)).toBe(false);
    const restored = rows.map((r) => (r.id === "g2" ? { ...r, removed: false } : r));
    expect(unrolledMonsters(restored).map((r) => r.id)).toEqual(["g2"]);
    expect(showRollMonsters(1, 1)).toBe(true);
  });
});

describe("FR-CBT-53 formatLine DM vs player", () => {
  const payload = {
    targetName: "Goblin",
    attackName: "Shortsword",
    damageType: "piercing",
    toHit: { dice: 15, constant: 4, total: 19, natural: 15 },
    hit: true,
    damage: 3,
    multiplier: "half" as const,
    crit: false,
  };
  const dmPayload = {
    targetAc: 15,
    hitComputed: true,
    toHitRolled: 19,
    damageRolled: 6,
    damageTotal: 6,
    applied: 3,
    overkill: 0,
    overrides: { toHit: false, hit: false, damage: false },
  };
  const line = (e: { payload: unknown; dmPayload?: unknown }) =>
    lineText(formatEntry({ kind: "cbt.attack", actorName: "Mira", ...e }).segments);

  test("FR-CBT-53 legacy rows (no manual, no rolls) parse and read as before, plus 'vs AC' for the DM", () => {
    expect(line({ payload })).toBe(
      "Mira attacks Goblin: 15 + 4 = 19 — hit! 3 piercing damage (half)",
    );
    expect(line({ payload, dmPayload })).toBe(
      "Mira attacks Goblin: 15 + 4 = 19 vs AC 15 — hit! 3 piercing damage (half)",
    );
  });

  test("FR-CBT-53 kept and dropped d20s (adv) and the damage dice, DM only", () => {
    const rolls = {
      toHit: {
        expression: "2d20kh1+4",
        mode: "advantage" as const,
        dice: [
          [15, true],
          [7, false],
        ] as [number, boolean][],
        constant: 4,
      },
      damage: {
        expression: "1d6+2",
        dice: [[4, true]] as [number, boolean][],
        constant: 2,
        crit: false,
      },
    };
    const manual = { toHit: false, damage: true };
    expect(line({ payload: { ...payload, manual }, dmPayload: { ...dmPayload, rolls } })).toBe(
      "Mira attacks Goblin: 15 + 4 = 19 (2d20kh1+4 adv: 15 ~7~ + 4) vs AC 15 — hit! 3 piercing damage (half) (1d6+2: 4 + 2) (physical)",
    );
    expect(line({ payload: { ...payload, manual } })).toBe(
      "Mira attacks Goblin: 15 + 4 = 19 — hit! 3 piercing damage (half) (physical)",
    );
    // A physical total of several dice has no per-die values: no breakdown.
    const blind = {
      ...rolls,
      damage: {
        ...rolls.damage,
        expression: "2d6",
        dice: [
          [null, true],
          [null, true],
        ],
      },
    };
    expect(line({ payload, dmPayload: { ...dmPayload, rolls: blind } })).not.toContain("2d6");
  });

  test("FR-CBT-53 DM ruled miss on a computed hit; the player still reads 'miss'", () => {
    const miss = { ...payload, hit: false, damage: 0 };
    const ruled = { ...dmPayload, overrides: { toHit: false, hit: true, damage: false } };
    expect(line({ payload: miss, dmPayload: ruled })).toBe(
      "Mira attacks Goblin: 15 + 4 = 19 vs AC 15 — DM ruled miss",
    );
    expect(line({ payload: miss })).toBe("Mira attacks Goblin: 15 + 4 = 19 — miss");
  });
});

describe("FR-CBT-50 skip cue", () => {
  const row = (id: string, position: number, extra: Record<string, unknown> = {}) => ({
    id,
    name: id,
    position,
    kind: "monster" as const,
    removed: false,
    hpCurrent: 5 as number | null,
    initiative: 20 - position,
    ...extra,
  });
  // Wolf, Mira, Goblin, Goblin 2, Thorn, Elite.
  const base = [
    row("Wolf", 1),
    row("Mira", 2, { kind: "pc", hpCurrent: null }),
    row("Goblin", 3),
    row("Goblin 2", 4),
    row("Thorn", 5, { kind: "pc", hpCurrent: null }),
    row("Elite", 6),
  ];
  const down = (names: string[], rows = base) =>
    rows.map((r) => (names.includes(r.id) ? { ...r, hpCurrent: 0 } : r));

  test("FR-CBT-50 one down: Next from Mira skips Goblin", () => {
    const s = skippedOnStep(down(["Goblin"]), 1, "Mira", "next");
    expect(s).toEqual({ names: ["Goblin"], round: null });
    expect(skippedText(s as NonNullable<typeof s>)).toBe("Skipped Goblin (down)");
  });

  test("FR-CBT-50 two down: names in passing order", () => {
    const s = skippedOnStep(down(["Goblin", "Goblin 2"]), 1, "Mira", "next");
    expect(s).toEqual({ names: ["Goblin", "Goblin 2"], round: null });
    expect(skippedText(s as NonNullable<typeof s>)).toBe("Skipped Goblin, Goblin 2 (down)");
  });

  test("FR-CBT-50 wrap adds the round", () => {
    const s = skippedOnStep(down(["Elite", "Wolf"]), 1, "Thorn", "next");
    expect(s).toEqual({ names: ["Elite", "Wolf"], round: 2 });
    expect(skippedText(s as NonNullable<typeof s>)).toBe("Skipped Elite, Wolf (down) · Round 2");
  });

  test("FR-CBT-50 removed combatants are not named; nobody skipped → null", () => {
    const rows = down(["Goblin"]).map((r) => (r.id === "Goblin 2" ? { ...r, removed: true } : r));
    expect(skippedOnStep(rows, 1, "Mira", "next")?.names).toEqual(["Goblin"]);
    expect(skippedOnStep(rows, 1, "Wolf", "next")).toBeNull();
    // A removed and down monster is not named either.
    const both = rows.map((r) => (r.id === "Goblin 2" ? { ...r, hpCurrent: 0 } : r));
    expect(skippedOnStep(both, 1, "Mira", "next")?.names).toEqual(["Goblin"]);
  });

  test("FR-CBT-50 Prev passes backwards; a failing step → null", () => {
    const rows = down(["Goblin", "Goblin 2"]);
    expect(skippedOnStep(rows, 2, "Thorn", "prev")).toEqual({
      names: ["Goblin 2", "Goblin"],
      round: null,
    });
    expect(skippedOnStep(down(["Elite"]), 2, "Wolf", "prev")).toEqual({
      names: ["Elite"],
      round: 1,
    });
    expect(skippedOnStep(rows, 1, "Wolf", "prev")).toBeNull();
    // Start round 1: down monsters before the first eligible are passed over too.
    expect(skippedOnStep(down(["Wolf"]), 0, null, "next")).toEqual({
      names: ["Wolf"],
      round: null,
    });
  });
});
