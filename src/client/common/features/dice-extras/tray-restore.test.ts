// Sprint 11 F3 (BL-112, FR-DICEX-83): a roll-request answer staged in the tray (Alt → tray) is
// one-shot: once the prompt is spent the tray goes back as it was before that stage. A normal
// tray roll is unchanged: it stays on its result (FR-DICEX-10).
import { describe, expect, test } from "bun:test";
import type { RollControlOptions } from "../dice-roll-log/roll-control";
import { createDiceExtrasStore, trayRestore } from "./store";

const control = (onRoll: RollControlOptions["onRoll"]): RollControlOptions => ({
  expressions: ["1d20+3"],
  category: "skill-check",
  label: "Mira — Perception",
  onRoll,
});

describe("FR-DICEX-83 BL-112 tray after a prompt answer", () => {
  test("FR-DICEX-83 BL-112 trayRestore: closed → close, minimised → minimise, open → stays", () => {
    expect(trayRestore("closed")).toBe("close");
    expect(trayRestore("minimised")).toBe("minimise");
    expect(trayRestore("open")).toBeNull();
  });

  test("FR-DICEX-83 BL-112 holds: only the staged control request with that very onRoll", () => {
    const s = createDiceExtrasStore();
    const answer = () => {};
    const other = () => {};
    expect(s.holds(answer)).toBe(false);
    s.stage({ kind: "control", options: control(answer), mode: "normal" });
    expect(s.holds(answer)).toBe(true);
    expect(s.holds(other)).toBe(false);
    // A newer stage replaces it: the prompt's answer no longer owns the tray.
    s.stage({ kind: "free", expression: "2d6", mode: "normal", category: "other" });
    expect(s.holds(answer)).toBe(false);
    s.stage({ kind: "control", options: control(answer), mode: "normal" });
    s.clear();
    expect(s.holds(answer)).toBe(false);
  });

  test("FR-DICEX-83 BL-112 restoreTray bumps `restored` only; the staged request and result stay", () => {
    const s = createDiceExtrasStore();
    const answer = () => {};
    s.stage({ kind: "control", options: control(answer), mode: "normal" });
    const before = s.api.getState();
    s.restoreTray();
    const after = s.api.getState();
    expect(after.restored).toBe(before.restored + 1);
    expect(after.staged).toBe(before.staged);
    expect(after.request).toBe(before.request);
  });
});
