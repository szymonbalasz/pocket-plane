import { describe, expect, test } from "bun:test";
import {
  absorb,
  concentrationDc,
  deathAfterHp,
  deathRevert,
  deathSave,
  deathStateOf,
  effectName,
  endedText,
  endsRoundOf,
  expiresAt,
  notRestoredText,
  roundsLeft,
} from "./rules";

describe("FR-CBTX-05 durations", () => {
  test("FR-CBTX-05 endsRound: round 0 counts from 1; rounds left", () => {
    expect(endsRoundOf(0, 1)).toBe(2);
    expect(endsRoundOf(1, 10)).toBe(11);
    expect(endsRoundOf(4, 3)).toBe(7);
    expect(roundsLeft(11, 1)).toBe(10);
    expect(roundsLeft(3, 5)).toBe(0);
  });

  test("FR-CBTX-05 FR-CBTX-06 expiry predicate: anchor's turn in endsRound, any round past, ended never", () => {
    const e = { endsRound: 3, anchorCombatantId: "mira", endedAt: null };
    expect(expiresAt(e, { round: 3, turnCombatantId: "wolf" })).toBe(false);
    expect(expiresAt(e, { round: 3, turnCombatantId: "mira" })).toBe(true);
    expect(expiresAt(e, { round: 2, turnCombatantId: "mira" })).toBe(false);
    // Anchor removed / skipped: the first Next into a later round.
    expect(expiresAt(e, { round: 4, turnCombatantId: "wolf" })).toBe(true);
    expect(expiresAt({ ...e, anchorCombatantId: null }, { round: 3, turnCombatantId: "x" })).toBe(
      false,
    );
    expect(expiresAt({ ...e, endsRound: null }, { round: 9, turnCombatantId: "mira" })).toBe(false);
    expect(expiresAt({ ...e, endedAt: "t" }, { round: 3, turnCombatantId: "mira" })).toBe(false);
  });
});

describe("FR-CBTX-15 FR-CBTX-17 HP maths", () => {
  test("FR-CBTX-15 absorption: temp ≥ raw, < raw, 0", () => {
    expect(absorb(5, 3)).toEqual({ absorbed: 3, rest: 0 });
    expect(absorb(3, 8)).toEqual({ absorbed: 3, rest: 5 });
    expect(absorb(0, 8)).toEqual({ absorbed: 0, rest: 8 });
    expect(absorb(4, 0)).toEqual({ absorbed: 0, rest: 0 });
  });

  test("FR-CBTX-17 DC = max(10, ⌊damage / 2⌋)", () => {
    expect([1, 20, 23, 30].map(concentrationDc)).toEqual([10, 10, 11, 15]);
  });
});

describe("FR-CBTX-19 FR-CBTX-20 FR-CBTX-23 death state machine", () => {
  const c = (successes: number, failures: number) => ({ successes, failures });
  const dmg = (raw: number, crit = false, hpBefore = 0, hpAfter = 0) =>
    ({ kind: "damage", raw, crit, hpBefore, hpAfter }) as const;

  test("FR-CBTX-19 state: dead at 3 failures; stable at 3 successes; dying at 0; null above", () => {
    expect(deathStateOf(0, 0, 0)).toBe("dying");
    expect(deathStateOf(0, 3, 0)).toBe("stable");
    expect(deathStateOf(0, 3, 3)).toBe("dead");
    expect(deathStateOf(5, 0, 3)).toBe("dead");
    expect(deathStateOf(5, 2, 1)).toBeNull();
  });

  test("FR-CBTX-20 damage at 0: +1 failure, crit +2, stable → successes 0; dead / above 0 unchanged; heal resets", () => {
    expect(deathAfterHp(c(1, 0), dmg(3))).toEqual(c(1, 1));
    expect(deathAfterHp(c(0, 0), dmg(3, true))).toEqual(c(0, 2));
    expect(deathAfterHp(c(0, 2), dmg(3, true))).toEqual(c(0, 3));
    expect(deathAfterHp(c(3, 0), dmg(1))).toEqual(c(0, 1));
    expect(deathAfterHp(c(0, 3), dmg(1))).toEqual(c(0, 3));
    expect(deathAfterHp(c(0, 0), dmg(4, false, 4, 0))).toEqual(c(0, 0));
    expect(deathAfterHp(c(0, 0), dmg(0))).toEqual(c(0, 0));
    expect(deathAfterHp(c(2, 2), { ...dmg(0), kind: "heal", hpAfter: 3 })).toEqual(c(0, 0));
  });

  test("FR-CBTX-23 death save: success, failure, natural 1, natural 20, caps", () => {
    expect(deathSave(c(0, 0), 15)).toEqual({ outcome: "success", after: c(1, 0) });
    expect(deathSave(c(0, 0), 10)).toEqual({ outcome: "success", after: c(1, 0) });
    expect(deathSave(c(0, 0), 9)).toEqual({ outcome: "failure", after: c(0, 1) });
    expect(deathSave(c(0, 2), 1)).toEqual({ outcome: "failure", after: c(0, 3) });
    expect(deathSave(c(2, 2), 20)).toEqual({ outcome: "revive", after: c(0, 0) });
    expect(deathSave(c(2, 0), 12).after).toEqual(c(3, 0));
  });

  test("FR-CBTX-22 undo by delta: later rolls survive; HP back above 0 → both 0", () => {
    expect(deathRevert(c(2, 1), c(1, 0), c(1, 1), 0)).toEqual(c(2, 0));
    expect(deathRevert(c(0, 0), c(0, 0), c(0, 2), 0)).toEqual(c(0, 0));
    expect(deathRevert(c(1, 1), null, null, 0)).toEqual(c(1, 1));
    expect(deathRevert(c(1, 1), c(1, 0), c(1, 1), 4)).toEqual(c(0, 0));
  });
});

describe("names and toasts", () => {
  test("FR-CBTX-06 FR-CBTX-07 effect names, expiry and not-restored toasts", () => {
    const base = { condition: null, level: null, label: null };
    expect(effectName({ ...base, kind: "condition", condition: "exhaustion", level: 2 })).toBe(
      "Exhaustion 2",
    );
    expect(effectName({ ...base, kind: "custom", label: "Bless" })).toBe("Bless");
    expect(effectName({ ...base, kind: "concentration", label: "Bless" })).toBe(
      "Concentrating: Bless",
    );
    expect(
      endedText([
        { name: "Bless", target: "Mira" },
        { name: "Bless", target: "Thorn" },
        { name: "Bane", target: "Goblin 2" },
      ]),
    ).toBe("Ended: Bless (Mira, Thorn), Bane (Goblin 2)");
    expect(notRestoredText(["Frightened (Goblin)"])).toBe(
      "Not restored: Frightened (Goblin) — already active",
    );
  });
});
