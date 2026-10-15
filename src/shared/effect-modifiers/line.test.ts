// FR-MOD-20 roll-hook parts in lines: `modSegments` signs, "(DM)", "(rolled for you)", mode
// hints, and the `roll` kind's line with parts for players (payload) and the DM (dmPayload).
import { describe, expect, test } from "bun:test";
import { lineText } from "@shared/dice-roll-log/kind-types";
import { formatEntry } from "@shared/dice-roll-log/line";
import type { RollEntryDmPayload, RollPayloadItem } from "@shared/dice-roll-log/schemas";
import { modeLabels, modSegments, modsTotal } from "./line";

const item = (p: Partial<RollPayloadItem>): RollPayloadItem => ({
  rollId: "r1",
  expression: "1d20+4",
  mode: "normal",
  manual: false,
  dice: [{ faces: 20, value: 14, kept: true }],
  constant: 4,
  total: 18,
  natural: 14,
  label: "Shortsword attack",
  ...p,
});
const line = (items: RollPayloadItem[], dmPayload?: RollEntryDmPayload, actorName = "Mira") =>
  lineText(formatEntry({ kind: "roll", actorName, payload: items, dmPayload }).segments);

describe("FR-MOD-20 modSegments", () => {
  test("FR-MOD-20 signs, labels, (DM), auto; DM names win", () => {
    const mods = [
      { label: "Bless", value: 3, expression: "1d4", rollId: "r2" },
      { label: "Bane", value: -2, expression: "1d4", rollId: "r3" },
      { label: null, value: -4, expression: "2d6", rollId: "r4" },
      { label: "Rage", value: 2 },
      { label: "Bless", value: 1, expression: "1d4", rollId: "r5", auto: true as const },
    ];
    expect(lineText(modSegments(mods))).toBe(
      " + 3 Bless − 2 Bane − 4 (DM) + 2 Rage + 1 Bless (rolled for you)",
    );
    const dm = mods.map((m, i) => ({ effectId: `fx${i}`, label: m.label ?? "Cursed" }));
    expect(lineText(modSegments(mods, dm))).toContain("− 4 Cursed");
    expect(lineText(modSegments(undefined))).toBe("");
    expect(modsTotal(mods)).toBe(0);
    expect(modsTotal(undefined)).toBe(0);
    // Labels are muted; values plain.
    expect(modSegments([mods[0] as (typeof mods)[number]]).map((s) => s.style)).toEqual([
      undefined,
      undefined,
      "muted",
    ]);
  });

  test("FR-MOD-20 mode hints: labels, null → (DM), DM names win", () => {
    expect(modeLabels(["Rage", null])).toBe("Rage, (DM)");
    expect(
      modeLabels(
        ["Rage", null],
        [
          { effectId: "a", label: "Rage" },
          { effectId: "b", label: "Reckless" },
        ],
      ),
    ).toBe("Rage, Reckless");
  });
});

describe("FR-MOD-20 roll line with parts", () => {
  const blessed = item({
    total: 21,
    mods: [{ label: "Bless", value: 3, expression: "1d4", rollId: "r2" }],
  });

  test("FR-MOD-20 'Mira — Shortsword attack: 14 + 4 + 3 Bless = 21'", () => {
    expect(line([blessed])).toBe("Mira — Shortsword attack: 14 + 4 + 3 Bless = 21");
  });

  test("FR-MOD-20 no parts → the line as before", () => {
    expect(line([item({})])).toBe("Mira — Shortsword attack: 14 + 4 = 18");
  });

  test("FR-MOD-20 / FR-MOD-23 secret part: players read (DM), the DM line names it", () => {
    const cursed = item({
      label: "WIS save",
      expression: "1d20+1",
      dice: [{ faces: 20, value: 11, kept: true }],
      constant: 1,
      natural: 11,
      total: 7,
      mods: [{ label: null, value: -5, expression: "2d6", rollId: "r9" }],
    });
    expect(line([cursed], undefined, "Goblin 2")).toBe("Goblin 2 — WIS save: 11 + 1 − 5 (DM) = 7");
    const dm: RollEntryDmPayload = { items: [{ mods: [{ effectId: "fx-c", label: "Cursed" }] }] };
    expect(line([cursed], dm, "Goblin 2")).toBe("Goblin 2 — WIS save: 11 + 1 − 5 Cursed = 7");
  });

  test("FR-MOD-20 death save keeps its outcome after the total", () => {
    const save = item({
      label: "Death save",
      expression: "1d20",
      dice: [{ faces: 20, value: 5, kept: true }],
      constant: 0,
      natural: 5,
      total: 8,
      note: "failure",
      mods: [{ label: "Bless", value: 3, expression: "1d4", rollId: "r2" }],
    });
    expect(line([save], undefined, "Thorn")).toBe("Thorn — Death save: 5 + 3 Bless = 8 — failure");
  });

  test("FR-MOD-18 physical base + auto part; manual total of several dice excludes the parts", () => {
    const physical = item({
      label: "CON save",
      manual: true,
      dice: [{ faces: 20, value: 10, kept: true }],
      natural: 10,
      total: 17,
      mods: [{ label: "Bless", value: 3, expression: "1d4", rollId: "r2", auto: true }],
    });
    expect(line([physical])).toBe(
      "Mira — CON save: 10 + 4 + 3 Bless (rolled for you) = 17 (physical)",
    );
    const severalDice = item({
      label: "Rapier damage",
      expression: "2d6+3",
      manual: true,
      dice: [
        { faces: 6, value: null, kept: true },
        { faces: 6, value: null, kept: true },
      ],
      constant: 3,
      natural: null,
      total: 14,
      mods: [{ label: "Rage", value: 2 }],
    });
    expect(line([severalDice])).toBe("Mira — Rapier damage: 9 + 3 + 2 Rage = 14 (physical)");
  });

  test("FR-MOD-20 mode hints in the marker: '(adv: Rage)'; DM names them", () => {
    const adv = item({
      label: "Athletics",
      expression: "2d20kh1+5",
      mode: "advantage",
      dice: [
        { faces: 20, value: 6, kept: false },
        { faces: 20, value: 13, kept: true },
      ],
      constant: 5,
      natural: 13,
      total: 18,
      modes: ["Rage"],
    });
    expect(line([adv], undefined, "Thorn")).toBe("Thorn — Athletics (adv: Rage): ~6~ 13 + 5 = 18");
    expect(line([{ ...adv, modes: [null] }], undefined, "Thorn")).toContain("(adv: (DM))");
    const dm: RollEntryDmPayload = {
      items: [{ mods: [], modes: [{ effectId: "fx", label: "Reckless" }] }],
    };
    expect(line([{ ...adv, modes: [null] }], dm, "Thorn")).toContain("(adv: Reckless)");
  });

  test("FR-MOD-19 multi-roll entry: each item its own parts and DM names", () => {
    const dmg = item({
      rollId: "r3",
      label: "Shortsword damage",
      expression: "1d6+2",
      dice: [{ faces: 6, value: 4, kept: true }],
      constant: 2,
      natural: null,
      total: 6,
    });
    const dm: RollEntryDmPayload = {
      items: [{ mods: [{ effectId: "fx-b", label: "Bless" }] }, { mods: [] }],
    };
    expect(line([blessed, dmg], dm)).toBe(
      "Mira — Shortsword attack: 14 + 4 + 3 Bless = 21; Shortsword damage: 4 + 2 = 6",
    );
  });
});
