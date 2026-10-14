// Edit-mode field model (FR-CHARX-27, -28, -38): draft + "Changed by" logic, unsaved re-commit
// for `set` only, client mirror of the zod rules.
import { describe, expect, test } from "bun:test";
import {
  changedHint,
  type FieldAction,
  type FieldState,
  fieldReducer,
  idleField,
  parseIntField,
  recommitsAfterLoss,
  rowError,
  setFieldError,
} from "./edit-model";

const run = (actions: FieldAction[], from: FieldState = idleField) =>
  actions.reduce(fieldReducer, from);

describe("FR-CHARX-28 field draft and remote change", () => {
  test("FR-CHARX-28 hint text per client", () => {
    expect(changedHint("player", { npc: false, ownerName: "Player 1" })).toBe("Changed by the DM");
    expect(changedHint("dm", { npc: false, ownerName: "Player 1" })).toBe("Changed by Player 1");
    expect(changedHint("dm", { npc: true, ownerName: null })).toBe("Changed in another tab");
  });

  test("FR-CHARX-28 a remote change while editing keeps the draft and flags it", () => {
    const s = run([
      { type: "focus", text: "14", committed: 14 },
      { type: "input", text: "15" },
      { type: "remote", committed: 16 },
    ]);
    expect(s).toMatchObject({ draft: "15", changed: true });
  });

  test("FR-CHARX-28 no hint: same value, own commit in flight, or not editing", () => {
    expect(
      run([
        { type: "focus", text: "14", committed: 14 },
        { type: "remote", committed: 14 },
      ]).changed,
    ).toBe(false);
    expect(
      run([
        { type: "focus", text: "14", committed: 14 },
        { type: "input", text: "15" },
        { type: "commitStart" },
        { type: "remote", committed: 15 },
      ]).changed,
    ).toBe(false);
    expect(run([{ type: "remote", committed: 3 }])).toEqual(idleField);
  });

  test("FR-CHARX-27 commit ok → back to the committed value; invalid input shows an error", () => {
    const s = run([
      { type: "focus", text: "14", committed: 14 },
      { type: "input", text: "x" },
      { type: "invalid", message: "Whole number" },
    ]);
    expect(s.error).toBe("Whole number");
    expect(run([{ type: "commitStart" }, { type: "commitOk" }], s)).toEqual(idleField);
  });
});

describe("FR-CHARX-38 lost intents", () => {
  test("FR-CHARX-38 a lost set keeps the draft as Not saved, survives refocus and cancel", () => {
    const lost = run([
      { type: "focus", text: "14", committed: 14 },
      { type: "input", text: "15" },
      { type: "commitStart" },
      { type: "commitFail", lost: true },
    ]);
    expect(lost).toMatchObject({ draft: "15", unsaved: true, inFlight: false });
    expect(run([{ type: "focus", text: "14", committed: 14 }, { type: "cancel" }], lost)).toEqual(
      lost,
    );
    expect(run([{ type: "commitStart" }, { type: "commitOk" }], lost)).toEqual(idleField);
  });

  test("FR-CHARX-38 only set re-commits; create, row create, counters toast", () => {
    expect(recommitsAfterLoss("set")).toBe(true);
    for (const op of ["putRow", "create", "counter", "other"] as const) {
      expect(recommitsAfterLoss(op)).toBe(false);
    }
  });
});

describe("FR-CHARX-27 client mirror", () => {
  test("FR-CHARX-27 set field bounds as the server's zod", () => {
    expect(setFieldError("ac", 15)).toBeNull();
    expect(setFieldError("ac", 31)).not.toBeNull();
    expect(setFieldError("hpMax", 0)).not.toBeNull();
    expect(setFieldError("species", null)).toBeNull();
    expect(setFieldError("notes", "x".repeat(4001))).not.toBeNull();
  });

  test("FR-CHARX-27 row mirror: spell rules, damage grammar", () => {
    expect(
      rowError("c", "spells", { name: "Bolt", level: 1, roll: "attack", effect: "healing" }),
    ).toContain("effect");
    expect(rowError("c", "attacks", { name: "Bow", toHit: 4, damage: "1d6+2" })).toBeNull();
    expect(rowError("c", "attacks", { name: "Bow", toHit: 4, damage: "d6" })).not.toBeNull();
  });

  test("parseIntField: empty → null, minus sign, junk → NaN", () => {
    expect(parseIntField("")).toBeNull();
    expect(parseIntField("−2")).toBe(-2);
    expect(parseIntField("+3")).toBe(3);
    expect(parseIntField("3.5")).toBeNaN();
  });
});
