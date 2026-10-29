// The tray's attack / damage composition (FR-DICEX-97, -99, -101): pure.
import { describe, expect, test } from "bun:test";
import { ATTACK_NEEDS_D20 } from "@shared/dice-roll-log/schemas";
import {
  baseConstant,
  type Composition,
  compositionIssue,
  compositionOf,
  DAMAGE_DIE_TIP,
  dropDie,
  groupRecordId,
  joinDie,
  lockedDie,
  notationOfComposition,
  offersNoType,
  partSlotLabels,
  plainComposition,
  presetActor,
  retype,
  setBaseConstant,
  setGroupType,
  stagedPartsOf,
} from "./tray-parts";

const groups = (c: Composition) =>
  c.terms.flatMap((t, i) => (t.kind === "dice" ? [groupRecordId(c, i)] : []));
const termOf = (c: Composition, faces: number) =>
  c.terms.findIndex((t) => t.kind === "dice" && t.faces === faces);

describe("FR-DICEX-101 die groups and damage types", () => {
  test("FR-DICEX-101 join and new group", () => {
    // T2: 2d6 slashing; a d8 starts a group with the last group's type; switch it to fire.
    let c = compositionOf(["2d6"], "damage", ["slashing"]);
    c = joinDie(c, 8, "damage");
    expect(groups(c)).toEqual(["6:slashing", "8:slashing"]);
    c = setGroupType(c, termOf(c, 8), "fire");
    expect(groups(c)).toEqual(["6:slashing", "8:fire"]);
    // (b) a d6 joins the d6 group and its type.
    c = joinDie(c, 6, "damage");
    expect(stagedPartsOf(c, "damage")).toEqual([
      { expression: "3d6", type: "slashing" },
      { expression: "1d8", type: "fire" },
    ]);
    // Two groups of one size: a die joins the last one (OQ-DICEX-66 A).
    const flame = compositionOf(["2d6+5", "2d6"], "damage", ["slashing", "fire"]);
    const more = joinDie(flame, 6, "damage");
    expect(stagedPartsOf(more, "damage")).toEqual([
      { expression: "2d6+5", type: "slashing" },
      { expression: "3d6", type: "fire" },
    ]);
    // Same size and type merge into one group.
    const two = compositionOf(["1d6", "1d6"], "damage", ["slashing", "fire"]);
    expect(groups(two)).toEqual(["6:slashing", "6:fire"]);
    const merged = setGroupType(two, 1, "slashing");
    expect(groups(merged)).toEqual(["6:slashing"]);
    expect(stagedPartsOf(merged, "damage")).toEqual([{ expression: "2d6", type: "slashing" }]);
  });

  test("FR-DICEX-101 parts from groups", () => {
    // A staged row starts with its parts; an extra part's constant stays its own.
    const c = compositionOf(["2d6+5", "2d6+2"], "damage", ["slashing", "fire"]);
    expect(stagedPartsOf(c, "damage")).toEqual([
      { expression: "2d6+5", type: "slashing" },
      { expression: "2d6+2", type: "fire" },
    ]);
    expect(baseConstant(c, "damage")).toBe(5);
    expect(stagedPartsOf(setBaseConstant(c, 7, "damage"), "damage")).toEqual([
      { expression: "2d6+7", type: "slashing" },
      { expression: "2d6+2", type: "fire" },
    ]);
    // The fire part's constant follows its dice to a new type.
    const cold = setGroupType(c, 1, "cold");
    expect(stagedPartsOf(cold, "damage")).toEqual([
      { expression: "2d6+5", type: "slashing" },
      { expression: "2d6+2", type: "cold" },
    ]);
    // ... and goes with its last die.
    const gone = dropDie(dropDie(c, 1), 1);
    expect(stagedPartsOf(gone, "damage")).toEqual([{ expression: "2d6+5", type: "slashing" }]);
    // An untyped base: "No type" offered, the base part sends no type.
    const untyped = joinDie(compositionOf(["1d8+3"], "damage", [null]), 6, "damage");
    expect(offersNoType(untyped)).toBe(true);
    const typed = setGroupType(untyped, termOf(untyped, 6), "fire");
    expect(stagedPartsOf(typed, "damage")).toEqual([
      { expression: "1d8+3" },
      { expression: "1d6", type: "fire" },
    ]);
    expect(offersNoType(compositionOf(["1d8"], "damage", ["piercing"]))).toBe(false);
    expect(partSlotLabels(typed, "damage")).toEqual(["Damage", "Fire"]);
    expect(partSlotLabels(compositionOf(["1d20+9"], "attack"), "attack")).toEqual(["To hit"]);
    // Typing keeps each size's type; a new size takes the last group's.
    const plain = plainComposition("2d6+1d8+1d4+3");
    if (!plain) throw new Error("parse");
    const retyped = retype(cold, plain.terms);
    expect(retyped.types).toEqual(["cold", "cold", "cold", null]);
    expect(notationOfComposition(retyped)).toBe("2d6+1d8+1d4+3");
  });

  test("FR-DICEX-101 limits", () => {
    let c = compositionOf(["1d6"], "damage", ["slashing"]);
    c = setGroupType(joinDie(c, 8, "damage"), 1, "fire");
    c = setGroupType(joinDie(c, 10, "damage"), 2, "cold");
    expect(compositionIssue(c, "damage")).toBeNull();
    const fourth = setGroupType(joinDie(c, 12, "damage"), 3, "acid");
    expect(compositionIssue(fourth, "damage")).toBe("At most 3 damage parts");
    let many = compositionOf(["20d6"], "damage", ["fire"]);
    expect(compositionIssue(many, "damage")).toBeNull();
    many = joinDie(many, 6, "damage");
    expect(compositionIssue(many, "damage")).toBe("At most 20 damage dice");
    expect(compositionIssue({ terms: [], types: [] }, "damage")).toBe(DAMAGE_DIE_TIP);
  });
});

describe("FR-DICEX-97 editable adjust", () => {
  test("FR-DICEX-97 locks: the attack's d20, a damage roll's last die", () => {
    const atk = compositionOf(["1d20+9"], "attack");
    expect(lockedDie(atk, "attack")).toEqual({ term: 0, tip: "An attack needs its d20" });
    expect(dropDie(atk, 0).terms).toHaveLength(1); // the d20 goes only if a caller ignores the lock
    const blessed = joinDie(atk, 4, "attack");
    expect(stagedPartsOf(blessed, "attack")).toEqual([{ expression: "1d20+1d4+9" }]);
    expect(compositionIssue(joinDie(atk, 20, "attack"), "attack")).toBe(ATTACK_NEEDS_D20);
    expect(compositionIssue({ terms: [], types: [] }, "attack")).toBe(ATTACK_NEEDS_D20);
    expect(lockedDie(compositionOf(["1d8"], "damage", ["fire"]), "damage")?.tip).toBe(
      DAMAGE_DIE_TIP,
    );
    expect(lockedDie(compositionOf(["2d8"], "damage", ["fire"]), "damage")).toBeNull();
    expect(lockedDie(compositionOf(["1d8"], "plain"), "plain")).toBeNull();
  });
});

describe("FR-DICEX-99 player actor preset", () => {
  const you = { role: "player" as const, playerId: "p1" };
  const entities = [
    { id: "brakka", kind: "character", ownerPlayerId: "p1" },
    { id: "mira", kind: "character", ownerPlayerId: "p1" },
    { id: "thorn", kind: "character", ownerPlayerId: "p2" },
  ];
  const encounters = [{ id: "e1", status: "started" }];
  const pc = (entityId: string, p: object = {}) => ({
    encounterId: "e1",
    kind: "pc",
    entityId,
    removed: false,
    ...p,
  });

  test("FR-DICEX-99 purpose toggle: one own character in the fight → the actor", () => {
    const one = [pc("brakka"), pc("thorn")];
    expect(presetActor({ you, entities, encounters, combatants: one })).toEqual({
      entityId: "brakka",
    });
    // Two own PCs, none, a removed one, no started encounter, the DM → no preset.
    const two = [pc("brakka"), pc("mira")];
    expect(presetActor({ you, entities, encounters, combatants: two })).toBeNull();
    expect(presetActor({ you, entities, encounters, combatants: [pc("thorn")] })).toBeNull();
    const removed = [pc("brakka"), pc("mira", { removed: true })];
    expect(presetActor({ you, entities, encounters, combatants: removed })).toEqual({
      entityId: "brakka",
    });
    const ended = [{ id: "e1", status: "ended" }];
    expect(presetActor({ you, entities, encounters: ended, combatants: one })).toBeNull();
    const dm = { role: "dm" as const, playerId: null };
    expect(presetActor({ you: dm, entities, encounters, combatants: one })).toBeNull();
  });
});
