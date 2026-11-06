// Sorcery points and Flexible Casting (class-resources FR-CRES-05–08), pure.
import { describe, expect, test } from "bun:test";
import { restOutcome } from "./rest";
import { FeatureRow, sheetDataShape } from "./sheet";
import { CREATE_SLOT_COST, convertSlot, createSlot, slotsLeft, tickSlots } from "./sorcery";

const stats = {
  hpMax: 45,
  spellcasting: {
    ability: "cha" as const,
    slots: { "1": 4, "2": 3, "3": 2 },
    pact: { level: 1, slots: 2 },
  },
};
const font = (used: number) =>
  FeatureRow.parse({ id: "font", name: "Font of Magic", usesMax: 5, used, pool: "sorcery-points" });
const sheet = (used: number, o: Partial<Parameters<typeof convertSlot>[0]> = {}) => ({
  slotsUsed: {},
  slotsCreated: {},
  pactUsed: 0,
  features: [font(used)],
  ...o,
});
const pointsOf = (s: { features: { id: string; used: number }[] }) =>
  5 - (s.features.find((f) => f.id === "font")?.used ?? 0);

describe("FR-CRES-05 sorcery points row", () => {
  test("FR-CRES-05 pool needs uses; one pool row per sheet", () => {
    expect(FeatureRow.safeParse({ id: "a", name: "A", pool: "sorcery-points" }).success).toBe(
      false,
    );
    const two = [font(0), { ...font(0), id: "b" }];
    expect(sheetDataShape.features.safeParse(two).success).toBe(false);
    expect(sheetDataShape.features.safeParse([font(0)]).success).toBe(true);
  });
});

describe("FR-CRES-06 slot → points", () => {
  test("FR-CRES-06 a 2nd-level slot regains 2 points; the slot is spent", () => {
    const out = convertSlot(sheet(3), stats, { slot: 2 });
    if (!out.ok) throw new Error(out.message);
    expect(out.points).toEqual({ before: 2, after: 4 });
    expect(pointsOf(out.sheet)).toBe(4);
    expect(out.sheet.slotsUsed).toEqual({ "2": 1 });
  });

  test("FR-CRES-06 a pact slot regains the pact level", () => {
    const out = convertSlot(sheet(1), stats, { pact: true });
    if (!out.ok) throw new Error(out.message);
    expect(out.sheet.pactUsed).toBe(1);
    expect(pointsOf(out.sheet)).toBe(5);
  });

  test("FR-CRES-06 refusals: points would pass the max (OQ-CRES-02 A), no slot left, no pool", () => {
    const full = convertSlot(sheet(0), stats, { slot: 1 });
    expect(full.ok ? "" : full.message).toBe("Sorcery points are full");
    const over = convertSlot(sheet(1), stats, { slot: 2 });
    expect(over.ok ? "" : over.message).toBe("Sorcery points are full");
    const none = convertSlot(sheet(5, { slotsUsed: { "3": 2 } }), stats, { slot: 3 });
    expect(none.ok ? "" : none.message).toBe("No 3rd-level slot left");
    const pact = convertSlot(sheet(5, { pactUsed: 2 }), stats, { pact: true });
    expect(pact.ok ? "" : pact.message).toBe("No pact slot left");
    const noPool = convertSlot({ ...sheet(5), features: [] }, stats, { slot: 1 });
    expect(noPool.ok ? "" : noPool.message).toBe("No sorcery points row");
  });
});

describe("FR-CRES-07 points → slot", () => {
  test("FR-CRES-07 costs 2 / 3 / 5 / 6 / 7", () => {
    expect(Object.values(CREATE_SLOT_COST)).toEqual([2, 3, 5, 6, 7]);
  });

  test("FR-CRES-07 a 1st-level slot costs 2; created count goes up; not enough points refused", () => {
    const out = createSlot(sheet(0), 1);
    if (!out.ok) throw new Error(out.message);
    expect(out.points).toEqual({ before: 5, after: 3 });
    expect(out.sheet.slotsCreated).toEqual({ "1": 1 });
    const poor = createSlot(sheet(3), 3);
    expect(poor.ok ? "" : poor.message).toBe("A 3rd-level slot costs 5 sorcery points (2 left)");
    const bad = createSlot(sheet(0), 6);
    expect(bad.ok).toBe(false);
  });
});

describe("FR-CRES-08 created slots", () => {
  test("FR-CRES-08 ticking spends created slots first, then normal ones; un-ticking lowers used only", () => {
    const s = { slotsUsed: { "1": 3 }, slotsCreated: { "1": 1 } };
    expect(slotsLeft(s, stats, "1")).toBe(2);
    const a = tickSlots(s, stats, "1", 1);
    expect([a.slotsUsed, a.slotsCreated, a.changed]).toEqual([{ "1": 3 }, {}, 1]);
    const b = tickSlots(s, stats, "1", 3);
    expect([b.slotsUsed, b.slotsCreated, b.changed]).toEqual([{ "1": 4 }, {}, 2]);
    const c = tickSlots(s, stats, "1", -1);
    expect([c.slotsUsed, c.slotsCreated]).toEqual([{ "1": 2 }, { "1": 1 }]);
  });

  test("FR-CRES-08 converting a level with a created slot spends the created one", () => {
    const out = convertSlot(sheet(5, { slotsCreated: { "1": 1 } }), stats, { slot: 1 });
    if (!out.ok) throw new Error(out.message);
    expect([out.sheet.slotsUsed, out.sheet.slotsCreated]).toEqual([{}, {}]);
  });

  test("FR-CRES-08 long rest clears created slots; short rest keeps them", () => {
    const s = {
      hpCurrent: 10,
      tempHp: 0,
      deathSuccesses: 0,
      deathFailures: 0,
      sheet: { ...sheet(2, { slotsCreated: { "2": 1 } }), hitDiceUsed: {} },
    };
    expect(restOutcome("short", s, stats).sheet.slotsCreated).toEqual({ "2": 1 });
    expect(restOutcome("long", s, stats).sheet.slotsCreated).toEqual({});
  });
});
