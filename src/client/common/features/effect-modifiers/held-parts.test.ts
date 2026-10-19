// Sprint 5 R2 (D8 ruling #259): a held `roll` line (FR-DICE-40) blanks the sums of rolled MOD
// parts as well as dice and the total: `modSegments` / `rollOfferSegments` mark them `numeric`.
// Constants (Rage + 2, the item's + 4) stay; the landed line is unchanged.
import { describe, expect, test } from "bun:test";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { formatEntry } from "@shared/dice-roll-log/line";
import { heldSegments } from "@ui/features/dice-roll-log/logic";

const item = {
  rollId: "r1",
  expression: "1d12+4",
  mode: "normal" as const,
  manual: false,
  dice: [{ faces: 12, value: 8, kept: true }],
  constant: 4,
  total: 25,
  natural: null,
  label: "Greataxe damage (slashing)",
  mods: [
    { label: "Rage", value: 2 },
    // One die = its value: a chip (blank while held).
    { label: "Bless", value: 3, expression: "1d4", rollId: "r2", dice: [3] },
    // A sum: "5" then its dice run.
    { label: "Hunter's Mark", value: 5, expression: "1d4+2", rollId: "r3", dice: [3] },
    // Players read "(DM)": the value only, still rolled.
    { label: null, value: 3, expression: "1d4", rollId: "r4" },
  ],
  offered: [
    {
      label: "Divine Fury",
      value: 6,
      type: "radiant" as const,
      expression: "1d6+2",
      rollId: "r5",
      dice: [4],
    },
    { label: null, value: 9, type: null, expression: "2d6", rollId: "r6" },
  ],
};
const segments = () => formatEntry({ kind: "roll", actorName: "Brakka", payload: [item] }).segments;

describe("FR-DICE-40 held line blanks MOD part sums", () => {
  test("FR-DICE-40 held line blanks MOD part sums: rolled parts' values and offered values '…', constants kept; landed text unchanged", () => {
    expect(lineText(segments())).toBe(
      "Brakka — Greataxe damage (slashing): 8 + 4 + 2 Rage + 3 Bless + 5 Hunter's Mark (1d4+2: 3 + 2) + 3 (DM) = 25 (+ 6 radiant Divine Fury (1d6+2: 4 + 2), + 9 (DM) on a hit)",
    );
    expect(lineText(heldSegments(segments()))).toBe(
      "Brakka — Greataxe damage (slashing): … + 4 + 2 Rage + … Bless + … Hunter's Mark (1d4+2: … + 2) + … (DM) = … (+ … radiant Divine Fury (1d6+2: … + 2), + … (DM) on a hit)",
    );
    // Offer runs stay muted around the blanked values.
    const offers = heldSegments(segments()).slice(-8);
    expect(offers.every((s) => s.style === "muted")).toBe(true);
  });
});
