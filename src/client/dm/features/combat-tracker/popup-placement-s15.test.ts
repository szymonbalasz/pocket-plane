// Sprint 15 (BL-175), session-sim-17 v12 at DM 1440×900: the damage-card popup at 68, 60, grown to
// 440 × 305, on Mira. Placed once at open with no selection row (~255 px tall, clear of her at
// y 334), then the DM picked Fire Elemental 3 on the map and the panel grew a row. Token rects from
// the DM's captured records (36-px cells, map origin 328, 122), PCs footprint + 4 px.
import { describe, expect, test } from "bun:test";
import { coveredArea } from "@ui/features/play-shell/token-boxes";
import { popupPlacement, TARGET_ROW_GROW } from "./popup-placement";

const viewport = { w: 1440, h: 900 };
const initiative = { x: 1030, w: 398 };
const cell = (col: number, row: number, cells = 1) => ({
  x: 328 + 36 * col,
  y: 122 + 36 * row,
  w: 36 * cells,
  h: 36 * cells,
});
const grown = (c: { x: number; y: number; w: number; h: number }) => ({
  x: c.x - 4,
  y: c.y - 4,
  w: c.w + 8,
  h: c.h + 8,
});

/** Brakka's card: no selection row at open → the monsters are its likely targets (first tier). */
const LIKELY = [cell(10, 6), cell(14, 4), cell(15, 8)];
const MIRA = grown(cell(3, 6));
const BRAKKA = grown(cell(3, 8));
const THORN = grown(cell(4, 10));
const PCS = [MIRA, BRAKKA, THORN];
/** The other combatants (summons, the owlbear, charmed Goblin 2), and the PCs as FR-CBT-56 had them. */
const REST = [
  cell(3, 6),
  cell(3, 8),
  cell(4, 10),
  cell(0, 7, 2),
  cell(4, 8),
  cell(6, 5, 2),
  cell(2, 9, 2),
  cell(5, 9, 2),
  cell(12, 8),
];
const OPEN_H = 255;
const FINAL_H = 305;
const base = { viewport, initiative, width: 440, tokens: LIKELY };
const covers = (p: { x: number; y?: number }, h: number, t: typeof PCS) =>
  coveredArea({ x: p.x, y: p.y ?? 0, w: 440, h }, t);

describe("FR-NOTE-81 the damage-card popup keeps off the PCs where a clear spot exists", () => {
  test("FR-NOTE-81 sim-17 v12: before, 68, 60 clear at open and on Mira once a row grew it; now clear of every PC at its grown height", () => {
    const before = popupPlacement({ ...base, others: [[], REST], height: OPEN_H });
    expect(before).toMatchObject({ x: 68, y: 60 });
    expect(covers(before, OPEN_H, [MIRA])).toBe(0);
    expect(covers(before, FINAL_H, [MIRA])).toBeGreaterThan(0);

    const at = popupPlacement({ ...base, others: [[], REST], pcs: PCS, height: OPEN_H });
    expect(covers(at, FINAL_H, PCS)).toBe(0);
    expect(covers(at, OPEN_H, LIKELY)).toBe(0);
    expect((at.y ?? 0) + OPEN_H).toBeLessThanOrEqual(at.bottom);
  });

  test("FR-NOTE-81 FR-CBT-75 opened from a toast (v11: Brakka's card at 560, 317): the nearest free spot clears the PCs too", () => {
    const prefer = { x: 560, y: 317 };
    const at = popupPlacement({ ...base, others: [[], REST], pcs: PCS, height: FINAL_H, prefer });
    expect(covers(at, FINAL_H, PCS)).toBe(0);
    expect(covers(at, FINAL_H, LIKELY)).toBe(0);
  });

  test("FR-NOTE-81 FR-CBT-75 over its toast when that spot is free of targets and PCs, with the row to come; a PC within the grown height moves it", () => {
    const prefer = { x: 560, y: 100 };
    const clear = popupPlacement({
      ...base,
      tokens: [cell(14, 14)],
      others: [],
      pcs: PCS,
      height: OPEN_H,
      prefer,
    });
    expect(clear).toMatchObject({ side: "origin", x: 560, y: 100 });
    // A PC just below the panel as it opens: under it once a row is added.
    const below = { x: 600, y: 100 + OPEN_H + 20, w: 44, h: 44 };
    expect(20).toBeLessThan(TARGET_ROW_GROW);
    const moved = popupPlacement({
      ...base,
      tokens: [cell(14, 14)],
      others: [],
      pcs: [below],
      height: OPEN_H,
      prefer,
    });
    expect(moved.side).not.toBe("origin");
    expect(covers(moved, OPEN_H + TARGET_ROW_GROW, [below])).toBe(0);
  });

  test("FR-NOTE-81 a row's token and the likely targets come before a PC: no spot clears both → off the target (FR-CBT-55 stands), the least PC area next", () => {
    const small = { w: 900, h: 500 };
    const target = { x: 80, y: 60, w: 780, h: 180 };
    const pcsLow = [{ x: 80, y: 300, w: 780, h: 180 }];
    const at = popupPlacement({
      viewport: small,
      initiative: null,
      width: 440,
      tokens: [target],
      pcs: pcsLow,
      height: 200,
    });
    expect(covers(at, 200, [target])).toBe(0);
  });

  test("FR-NOTE-81 no clear spot: FR-CBT-56's pick, over the least PC area", () => {
    const wall = [{ x: 60, y: 60, w: 1000, h: 800 }];
    const at = popupPlacement({ ...base, tokens: [], others: [], pcs: wall, height: FINAL_H });
    expect(at).toMatchObject({ side: "left", x: 68 });
  });

  test("FR-NOTE-81 no PCs: FR-CBT-56's picks are unchanged", () => {
    const a = popupPlacement({ ...base, others: [[], REST], height: FINAL_H });
    const b = popupPlacement({ ...base, others: [[], REST], pcs: [], height: FINAL_H });
    expect(b).toEqual(a);
  });

  test("FR-NOTE-81 round trip at 1280×720 and 1600×900: the same fight at each one's camera keeps the PCs clear", () => {
    // The fit's camera at each size: cells of 28 px from 200, 100 at 1280; 36 px from 408, 122 at 1600.
    for (const [vp, init, size, ox, oy] of [
      [{ w: 1280, h: 720 }, { x: 868, w: 400 }, 28, 200, 100],
      [{ w: 1600, h: 900 }, { x: 1188, w: 400 }, 36, 408, 122],
    ] as const) {
      const at2 = (col: number, row: number) => ({
        x: ox + size * col,
        y: oy + size * row,
        w: size,
        h: size,
      });
      const pcs = [at2(3, 6), at2(3, 8), at2(4, 10)].map(grown);
      const at = popupPlacement({
        viewport: vp,
        initiative: init,
        width: 440,
        tokens: [at2(10, 6), at2(14, 4), at2(15, 8)],
        pcs,
        height: OPEN_H,
      });
      expect(covers(at, FINAL_H, pcs)).toBe(0);
    }
  });
});
