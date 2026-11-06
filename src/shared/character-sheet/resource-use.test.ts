// Feature use with a cost (class-resources FR-CRES-09–12), pure: cost words, the plan, ops
// applied and given back, and the log line's text.
import { describe, expect, test } from "bun:test";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { applyOps, opsBetween, planUse, spendMissing, spendText } from "./resource-use";
import { resourceUseLogKind } from "./resource-use-kind";
import { FeatureRow } from "./sheet";

const stats = {
  spellcasting: { ability: "cha" as const, slots: { "1": 2 }, pact: { level: 3, slots: 2 } },
};
const font = FeatureRow.parse({
  id: "font",
  name: "Font of Magic",
  usesMax: 5,
  pool: "sorcery-points",
});
const cd = FeatureRow.parse({ id: "cd", name: "Channel Divinity", usesMax: 2 });
const quick = FeatureRow.parse({
  id: "quick",
  name: "Quickened Spell",
  spend: { from: { feature: "font" }, amount: 2 },
});
const turn = FeatureRow.parse({
  id: "turn",
  name: "Turn Undead",
  spend: { from: { feature: "cd" }, amount: 1 },
});
const smite = FeatureRow.parse({
  id: "smite",
  name: "Eldritch Smite",
  spend: { from: { pact: true }, amount: 1 },
});
const sheet = {
  slotsUsed: {},
  slotsCreated: {},
  pactUsed: 0,
  features: [font, cd, quick, turn, smite],
};

describe("FR-CRES-10 cost words", () => {
  test("FR-CRES-10 spendText / spendMissing", () => {
    expect(spendText(sheet, quick.spend as NonNullable<typeof quick.spend>)).toBe(
      "2 sorcery points",
    );
    expect(spendText(sheet, turn.spend as NonNullable<typeof turn.spend>)).toBe(
      "1 Channel Divinity",
    );
    expect(spendText(sheet, smite.spend as NonNullable<typeof smite.spend>)).toBe("a pact slot");
    expect(
      spendMissing({ features: [quick] }, quick.spend as NonNullable<typeof quick.spend>),
    ).toBe(true);
  });
});

describe("FR-CRES-11 plan, apply, undo", () => {
  test("FR-CRES-11 Quickened: ops + payload; applied, then given back", () => {
    const plan = planUse(sheet, stats, "quick", {});
    if (!plan.ok) throw new Error(plan.message);
    expect(plan.ops).toEqual([{ on: "feature", id: "font", n: 2 }]);
    const after = applyOps(sheet, stats, plan.ops, 1);
    expect(after.features.find((f) => f.id === "font")?.used).toBe(2);
    expect(applyOps(after, stats, plan.ops, -1).features.find((f) => f.id === "font")?.used).toBe(
      0,
    );
    expect(opsBetween(sheet, after)).toEqual(plan.ops);
  });

  test("FR-CRES-12 line text", () => {
    const plan = planUse(sheet, stats, "smite", {});
    if (!plan.ok) throw new Error(plan.message);
    const text = lineText(
      resourceUseLogKind.formatLine({
        actorName: "Soel",
        payload: { characterId: "c", ...plan.payload },
      }),
    );
    expect(text).toBe("Soel · Eldritch Smite · −1 pact slot (1 pact slot left)");
  });
});
