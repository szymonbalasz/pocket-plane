// P3 glitch 9: a critical damage roll's label marks it (FR-CBT-16 crit, roll line copy).
import { describe, expect, test } from "bun:test";
import { LABEL_MAX } from "@shared/dice-roll-log/schemas";
import { critLabel } from "./attack";

describe("FR-CBT-16 P3 glitch 9 crit damage label", () => {
  test("FR-CBT-16 '(piercing)' → '(piercing, critical)'; no parentheses → ' (critical)'", () => {
    expect(critLabel("Dagger damage (piercing)")).toBe("Dagger damage (piercing, critical)");
    expect(critLabel("Bite damage")).toBe("Bite damage (critical)");
  });

  test("FR-CBT-16 a long label stays within the roll label limit, the marker kept", () => {
    const long = `${"Ŵ".repeat(50)} damage (piercing)`;
    const out = critLabel(long);
    expect(out.length).toBeLessThanOrEqual(LABEL_MAX);
    expect(out.endsWith("…, critical)")).toBe(true);
    expect(critLabel("x".repeat(70)).length).toBeLessThanOrEqual(LABEL_MAX);
  });
});
