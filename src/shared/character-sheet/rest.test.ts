// Rest rules (FR-CHARX-121, -122) and the `char.rest` log line (FR-CHARX-124), pure.
import { describe, expect, test } from "bun:test";
import type { ClassRow } from "@shared/entities/schemas";
import { getLogKind } from "../dice-roll-log/kinds";
import { hitDiceRegainOf, type RestState, regainHitDice, restOutcome } from "./rest";
import { LOG_KIND_CHAR_REST } from "./rest-kind";

const cls = (level: number, hitDie: ClassRow["hitDie"]): ClassRow => ({
  name: `C${hitDie}`,
  level,
  hitDie,
});

describe("rest rules", () => {
  test("FR-CHARX-122 hit dice regain: max(1, ⌊level / 2⌋), largest die first, clamped", () => {
    expect(hitDiceRegainOf({ classes: [] })).toBe(1);
    expect(hitDiceRegainOf({ classes: [cls(1, "d8")] })).toBe(1);
    expect(hitDiceRegainOf({ classes: [cls(3, "d8")] })).toBe(1);
    expect(hitDiceRegainOf({ classes: [cls(4, "d8"), cls(3, "d12")] })).toBe(3);
    // Multiclass: d12 first, then d10, d8, d6.
    const classes = [cls(2, "d6"), cls(3, "d8"), cls(2, "d12")]; // level 7 → 3
    expect(regainHitDice({ d6: 2, d8: 3, d12: 2 }, { classes })).toEqual({ d6: 2, d8: 2 });
    expect(regainHitDice({ d6: 2, d8: 2 }, { classes })).toEqual({ d6: 1 });
    // Used above the class levels (stale) is clamped first.
    expect(regainHitDice({ d12: 9 }, { classes })).toEqual({});
  });

  test("FR-CHARX-121 short leaves HP and slots; long resets them; rows without reset stay", () => {
    const s: RestState = {
      hpCurrent: 0,
      tempHp: 4,
      deathSuccesses: 2,
      deathFailures: 1,
      sheet: {
        slotsUsed: { "1": 2 },
        hitDiceUsed: { d8: 1 },
        features: [
          { id: "a", name: "A", source: "", text: "", usesMax: 1, used: 3, reset: "short" },
          { id: "b", name: "B", source: "", text: "", usesMax: 2, used: 2, reset: "long" },
          { id: "c", name: "C", source: "", text: "", usesMax: 2, used: 1 },
        ],
      },
    };
    const stats = { hpMax: 12, classes: [cls(1, "d8")] };
    const used = (r: RestState) => r.sheet.features.map((f) => f.used);
    const short = restOutcome("short", s, stats);
    expect(used(short)).toEqual([0, 2, 1]);
    expect({ ...short, sheet: null }).toEqual({ ...s, sheet: null });
    expect(short.sheet.slotsUsed).toEqual({ "1": 2 });
    const long = restOutcome("long", s, stats);
    expect(used(long)).toEqual([0, 0, 1]);
    expect(long).toMatchObject({ hpCurrent: 12, tempHp: 0, deathSuccesses: 0, deathFailures: 0 });
    expect(long.sheet.slotsUsed).toEqual({});
    expect(long.sheet.hitDiceUsed).toEqual({});
  });

  test('FR-CHARX-124 char.rest line: "Mira takes a long rest"', () => {
    const kind = getLogKind(LOG_KIND_CHAR_REST);
    const line = kind?.formatLine({
      actorName: "Mira",
      payload: kind.payload.parse({ characterId: "c1", kind: "long" }),
    });
    expect(line?.map((s) => s.text).join("")).toBe("Mira takes a long rest");
  });
});
