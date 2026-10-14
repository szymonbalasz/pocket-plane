import { describe, expect, test } from "bun:test";
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

  test("FR-CBT-46 Roll monsters: non-removed monsters without initiative; hidden from round 1 when none", () => {
    const rows = [
      { id: "g", kind: "monster" as const, removed: false, initiative: 12 },
      { id: "g2", kind: "monster" as const, removed: true, initiative: null },
      { id: "m", kind: "pc" as const, removed: false, initiative: null },
    ];
    expect(unrolledMonsters(rows)).toEqual([]);
    expect(showRollMonsters(0, 0)).toBe(true);
    expect(showRollMonsters(1, 0)).toBe(false);
    const restored = rows.map((r) => (r.id === "g2" ? { ...r, removed: false } : r));
    expect(unrolledMonsters(restored).map((r) => r.id)).toEqual(["g2"]);
    expect(showRollMonsters(1, 1)).toBe(true);
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
