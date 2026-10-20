// FR-CAMP-35 picker model (CAMP §13 client row, rulings-b 11): HSV ↔ hex, the hex field, the exact
// verdict, the clamp (hue change → column; empty column → row, else rings; none at a hue → stays,
// cached) and the mask vs the exact rules.
import { describe, expect, test } from "bun:test";
import { type ColorHolder, PLAYER_COLORS } from "@shared/campaign-management/colors";
import {
  clamp,
  hexToHsv,
  hsvToHex,
  judge,
  MASK_CELLS,
  maskPath,
  type PickerRules,
  parseHexInput,
  pickerRules,
  type Sv,
  searchSv,
} from "./color-picker";

/** prefs-s6: the DM amber, Player 2 lavender; the target is Player 1. */
const P1_OTHERS: ColorHolder[] = [
  { by: "dm", name: "DM", color: "#e69f00" },
  { by: "p2", name: "Player 2", color: "#b388ff" },
];
/** Seven crowded colours: every palette colour but Amber. */
const SEVEN: ColorHolder[] = Object.entries(PLAYER_COLORS)
  .slice(1)
  .map(([k, color]) => ({ by: k, name: k, color }));

/** Rules that count exact checks (to see the cache skip the square search). */
function counted(rules: PickerRules) {
  const c = { calls: 0 };
  const wrapped: PickerRules = {
    key: rules.key,
    verdict: rules.verdict,
    allowed: (hex) => {
      c.calls++;
      return rules.allowed(hex);
    },
  };
  return { rules: wrapped, c };
}

const ok = (rules: PickerRules, h: number) => (p: Sv) => rules.allowed(hsvToHex({ h, ...p }));

describe("FR-CAMP-35 picker model", () => {
  test("FR-CAMP-35 picker: HSV ↔ hex round-trips the palette; the hex field takes #rrggbb and #rgb, any case, # optional", () => {
    expect(hsvToHex({ h: 0, s: 100, v: 100 })).toBe("#ff0000");
    expect(hsvToHex({ h: 120, s: 100, v: 50 })).toBe("#008000");
    expect(hsvToHex({ h: 0, s: 0, v: 100 })).toBe("#ffffff");
    expect(hexToHsv("#19b98a")).toEqual({ h: 162, s: 86, v: 73 });
    expect(hexToHsv("#808080")).toEqual({ h: 0, s: 0, v: 50 });
    for (const hex of Object.values(PLAYER_COLORS)) {
      // 1 % steps: within one step per channel of the original.
      const back = hsvToHex(hexToHsv(hex));
      const ch = (x: string, i: number) => Number.parseInt(x.slice(1 + 2 * i, 3 + 2 * i), 16);
      for (const i of [0, 1, 2]) expect(Math.abs(ch(back, i) - ch(hex, i))).toBeLessThanOrEqual(3);
    }
    expect(parseHexInput("#7FD8FF")).toBe("#7fd8ff");
    expect(parseHexInput("7fd8ff")).toBe("#7fd8ff");
    expect(parseHexInput(" #7fd ")).toBe("#77ffdd");
    expect(parseHexInput("#7fd", false)).toBeNull();
    for (const bad of ["", "#", "#12345", "#ggg", "red", "#1234567"]) {
      expect(parseHexInput(bad)).toBeNull();
    }
  });

  test("FR-CAMP-35 picker: the verdict is FR-CAMP-31 then FR-CAMP-32 with their messages (§13 P5)", () => {
    const at = (hex: string) => judge(hex, P1_OTHERS);
    expect(at("#7fd8ff")).toBeNull();
    expect(at("#a0c814")).toEqual({
      reason: "too-close",
      by: "dm",
      message: "Too close to DM's colour for colour-blind players",
    });
    expect(at("#b388ff")).toEqual({ reason: "taken", by: "p2", message: "Taken by Player 2" });
    expect(at("#3d6ec9")).toEqual({ reason: "too-dark", message: "Too dark to read on the map" });
    expect(at("#9e9e9e")).toEqual({ reason: "too-grey", message: "Too grey" });
    expect(at("#f05555")).toEqual({ reason: "too-red", message: "Too close to the danger red" });
    // The memoised rules agree and key on the others' colours, not their order.
    const r = pickerRules(P1_OTHERS);
    expect(r.verdict("#3d6ec9")?.reason).toBe("too-dark");
    expect(r.allowed("#7fd8ff")).toBe(true);
    expect(pickerRules([...P1_OTHERS].reverse()).key).toBe(r.key);
    expect(pickerRules(SEVEN).key).not.toBe(r.key);
  });

  test("FR-CAMP-35 clamp (a): a hue change that breaks the rules at the marker → the column's nearest allowed V (ties → higher), by the exact rules", () => {
    const rules = pickerRules(P1_OTHERS);
    const jade = hexToHsv(PLAYER_COLORS.jade); // (162, 86, 73)
    expect(rules.allowed(hsvToHex(jade))).toBe(true);
    const target = { ...jade, h: 200 };
    expect(rules.verdict(hsvToHex(target))?.reason).toBe("too-dark");
    const got = clamp(target, rules, new Set());
    expect(got).toMatchObject({ h: 200, s: 86, none: false });
    expect(rules.allowed(got.hex)).toBe(true);
    expect(got.hex).toBe(hsvToHex(got));
    // Nothing nearer in the column is allowed.
    const d = Math.abs(got.v - target.v);
    for (let k = 1; k < d; k++) {
      for (const v of [target.v + k, target.v - k]) {
        if (v >= 0 && v <= 100) expect(ok(rules, 200)({ s: 86, v })).toBe(false);
      }
    }
    // Ties go up: two allowed points at the same distance → the higher V.
    expect(searchSv({ s: 50, v: 50 }, ({ s, v }) => s === 50 && (v === 47 || v === 53))).toEqual({
      s: 50,
      v: 53,
    });
    expect(searchSv({ s: 50, v: 50 }, ({ s, v }) => v === 50 && (s === 46 || s === 54))).toEqual({
      s: 54,
      v: 50,
    });
  });

  test("FR-CAMP-35 clamp (b): a column with no allowed point (S = 0, all too grey) → the row's nearest allowed S, else the nearest ring point (higher V, then higher S)", () => {
    const rules = pickerRules(P1_OTHERS);
    // Hue 120, V 80: S 0 is grey, the row has greens.
    const row = clamp({ h: 120, s: 0, v: 80 }, rules, new Set());
    expect(row).toMatchObject({ v: 80, none: false });
    expect(row.s).toBeGreaterThan(0);
    for (let s = 0; s < row.s; s++) expect(ok(rules, 120)({ s, v: 80 })).toBe(false);
    // Hue 0, V 50: S 0 grey, the row too dark / too red → a ring point.
    const ring = clamp({ h: 0, s: 0, v: 50 }, rules, new Set());
    expect(ring.none).toBe(false);
    expect(ring.s).not.toBe(0);
    expect(ring.v).not.toBe(50);
    expect(rules.allowed(ring.hex)).toBe(true);
    const dist = Math.abs(ring.s) + Math.abs(ring.v - 50);
    for (let s = 0; s <= 100; s++) {
      for (let v = 0; v <= 100; v++) {
        if (s + Math.abs(v - 50) < dist) expect(ok(rules, 0)({ s, v })).toBe(false);
      }
    }
    // Ring order: within a ring higher V first, then higher S.
    const pts = [
      { s: 49, v: 51 },
      { s: 51, v: 51 },
      { s: 51, v: 49 },
    ];
    const has = (p: Sv) => pts.some((q) => q.s === p.s && q.v === p.v);
    expect(searchSv({ s: 50, v: 50 }, has)).toEqual({ s: 51, v: 51 });
  });

  test("FR-CAMP-35 clamp (b): a hue with no allowed point (7 crowded colours) → the marker stays at the target, `none`; a second move at that hue skips the square search (cached)", () => {
    const { rules, c } = counted(pickerRules(SEVEN));
    const cache = new Set<string>();
    const t0 = performance.now();
    const first = clamp({ h: 213, s: 50, v: 50 }, rules, cache);
    const ms = performance.now() - t0;
    expect(first).toEqual({
      h: 213,
      s: 50,
      v: 50,
      hex: hsvToHex({ h: 213, s: 50, v: 50 }),
      none: true,
    });
    // The whole 101 × 101 square was judged once.
    expect(c.calls).toBe(101 * 101);
    expect(ms).toBeLessThan(500);
    c.calls = 0;
    const second = clamp({ h: 213, s: 20, v: 90 }, rules, cache);
    expect(second).toMatchObject({ h: 213, s: 20, v: 90, none: true });
    expect(c.calls).toBe(0);
    // Another hue (or other colours) is searched as usual.
    expect(clamp({ h: 120, s: 50, v: 50 }, rules, cache).none).toBe(false);
    expect(c.calls).toBeGreaterThan(0);
    const fewer = pickerRules(SEVEN.filter((o) => o.by !== "blue" && o.by !== "sky"));
    expect(clamp({ h: 213, s: 50, v: 50 }, fewer, cache).none).toBe(false);
  });

  test("FR-CAMP-35 clamp (c): mask vs rules: a target in a cell drawn as allowed whose exact colour fails → the exact rule wins, the marker moves on", () => {
    const rules = pickerRules(P1_OTHERS);
    const step = 100 / MASK_CELLS;
    let found: { h: number; s: number; v: number } | null = null;
    // A cell whose centre is allowed but an integer point inside it is not.
    for (let h = 0; h < 360 && !found; h += 15) {
      for (let row = 0; row < MASK_CELLS && !found; row++) {
        for (let col = 0; col < MASK_CELLS && !found; col++) {
          const cs = (col + 0.5) * step;
          const cv = 100 - (row + 0.5) * step;
          if (!rules.allowed(hsvToHex({ h, s: cs, v: cv }))) continue;
          for (const s of [Math.ceil(col * step), Math.floor((col + 1) * step)]) {
            for (const v of [Math.ceil(100 - (row + 1) * step), Math.floor(100 - row * step)]) {
              if (!found && !rules.allowed(hsvToHex({ h, s, v }))) found = { h, s, v };
            }
          }
        }
      }
    }
    if (!found) throw new Error("no cell edge where the mask and the rules disagree");
    const got = clamp(found, rules, new Set());
    expect(got.none).toBe(false);
    expect(got.s !== found.s || got.v !== found.v).toBe(true);
    expect(rules.allowed(got.hex)).toBe(true);
  });

  test("FR-CAMP-35 picker: the mask shades the blocked cells only (a path in the 32 × 32 grid); all-blocked rows merge into one rect", () => {
    const rules = pickerRules(P1_OTHERS);
    const path = maskPath(200, rules);
    const rects = [...path.matchAll(/M(\d+) (\d+)h(\d+)v1h-?\d+z/g)].map((m) =>
      m.slice(1, 4).map(Number),
    );
    expect(rects.length).toBeGreaterThan(0);
    const blocked = new Set<string>();
    for (const [x, y, w] of rects as [number, number, number][]) {
      for (let i = 0; i < w; i++) blocked.add(`${x + i},${y}`);
    }
    const step = 100 / MASK_CELLS;
    for (let row = 0; row < MASK_CELLS; row++) {
      for (let col = 0; col < MASK_CELLS; col++) {
        const hex = hsvToHex({ h: 200, s: (col + 0.5) * step, v: 100 - (row + 0.5) * step });
        expect(blocked.has(`${col},${row}`)).toBe(!rules.allowed(hex));
      }
    }
    // The bottom row is all too dark: one rect.
    expect(path).toContain(`M0 ${MASK_CELLS - 1}h${MASK_CELLS}v1h-${MASK_CELLS}z`);
  });
});
