// DICE sprint 7 (GM1) unit tests: `rerollableRoll` (FR-DICE-70), the reroll marker on a line
// (FR-DICE-64) and the final-roll counting contract (FR-DICE-67).
import { describe, expect, test } from "bun:test";
import { lineText } from "./kind-types";
import { formatEntry } from "./line";
import { countedRollIds, hasD20Term, type RerollableEntry, rerollableRoll } from "./reroll";
import type { RollPayloadItem } from "./schemas";

const item = (p: Partial<RollPayloadItem> = {}): RollPayloadItem => ({
  rollId: "r1",
  expression: "1d20+3",
  mode: "normal",
  manual: false,
  dice: [{ faces: 20, value: 17, kept: true }],
  constant: 3,
  total: 20,
  natural: 17,
  label: "Perception",
  ...p,
});

const entry = (p: Partial<RerollableEntry> = {}): RerollableEntry => ({
  kind: "roll",
  category: "skill-check",
  undone: false,
  supersededBy: null,
  payload: [item()],
  ...p,
});

describe("FR-DICE-70 rerollableRoll", () => {
  test("FR-DICE-70 rerollable: 1d20+3 ✓, 2d20kh1+5 ✓, 2d6 ✗, initiative ✗, undone ✗, superseded ✗, multi-roll → the d20 roll", () => {
    expect(rerollableRoll(entry())).toBe("r1");
    expect(rerollableRoll(entry({ payload: [item({ expression: "2d20kh1+5" })] }))).toBe("r1");
    expect(rerollableRoll(entry({ payload: [item({ expression: "2d20kl1-1" })] }))).toBe("r1");
    expect(rerollableRoll(entry({ payload: [item({ expression: "2d6" })] }))).toBeNull();
    expect(rerollableRoll(entry({ category: "initiative" }))).toBeNull();
    expect(rerollableRoll(entry({ undone: true }))).toBeNull();
    expect(rerollableRoll(entry({ supersededBy: "e2" }))).toBeNull();
    expect(rerollableRoll(entry({ kind: "cbt.attack" }))).toBeNull();
    // A damage-first entry with a later d20 roll: the d20's.
    const multi = [item({ rollId: "d", expression: "1d6+2" }), item({ rollId: "h" })];
    expect(rerollableRoll(entry({ payload: multi }))).toBe("h");
    // The to-hit of a both-rolls attack line (to-hit first).
    const attack = [item({ rollId: "h" }), item({ rollId: "d", expression: "1d4+2" })];
    expect(rerollableRoll(entry({ category: "attack", payload: attack }))).toBe("h");
    expect([hasD20Term("1d4+1d20"), hasD20Term("3d20"), hasD20Term("-1d20")]).toEqual([
      true,
      false,
      false,
    ]);
  });
});

describe("FR-DICE-64 reroll line", () => {
  test('FR-DICE-64 reroll line: `replaces` → "(reroll, was 4)"; adv keeps its marker first', () => {
    const line = (p: Partial<RollPayloadItem>) =>
      lineText(formatEntry({ kind: "roll", actorName: "Mira", payload: [item(p)] }).segments);
    expect(line({ replaces: { entryId: "e1", total: 4 } })).toBe(
      "Mira — Perception (reroll, was 4): 17 + 3 = 20",
    );
    expect(
      line({
        mode: "advantage",
        expression: "2d20kh1+3",
        dice: [
          { faces: 20, value: 2, kept: false },
          { faces: 20, value: 17, kept: true },
        ],
        replaces: { entryId: "e1", total: 9 },
      }),
    ).toBe("Mira — Perception (adv) (reroll, was 9): ~2~ 17 + 3 = 20");
    expect(line({})).toBe("Mira — Perception: 17 + 3 = 20");
  });
});

describe("FR-DICE-67 stats contract", () => {
  test("FR-DICE-67 final roll: superseded and undone entries' rolls excluded; a roll listed again counts once", () => {
    const counted = countedRollIds([
      { undone: false, supersededBy: "e2", rollIds: ["old", "dmg"] },
      { undone: false, supersededBy: null, rollIds: ["new", "dmg"] },
      { undone: true, supersededBy: null, rollIds: ["gone"] },
    ]);
    expect([...counted].sort()).toEqual(["dmg", "new"]);
  });
});
