import { describe, expect, test } from "bun:test";
import {
  ciede2000,
  closestPair,
  contrastRatio,
  DM_DEFAULT_COLOR,
  defaultColor,
  deltaE,
  PLAYER_COLOR_KEYS,
  PLAYER_COLORS,
  type PlayerColor,
} from "./colors";

/** CAMP §7: on the app background, the window surface, the canvas casing. */
const SURFACES = { app: "#0a0a0a", window: "#171717", casing: "#000000" } as const;
const SECTION_7: Record<PlayerColor, [number, number, number]> = {
  amber: [8.79, 7.96, 9.32],
  jade: [7.87, 7.13, 8.35],
  sky: [8.58, 7.77, 9.1],
  rose: [8.01, 7.25, 8.5],
  yellow: [14.97, 13.56, 15.88],
  blue: [6.25, 5.66, 6.63],
  vermillion: [5.12, 4.64, 5.43],
  bronze: [4.99, 4.52, 5.3],
};
const ACCENT_DANGER = "#ef4444";

describe("FR-CAMP-23 default colour", () => {
  test("FR-CAMP-23 default colour: add order jade, sky, rose…; the DM's key skipped; a picked key skipped; past 8 the least used, ties in palette order", () => {
    expect(PLAYER_COLOR_KEYS).toEqual([
      "amber",
      "jade",
      "sky",
      "rose",
      "yellow",
      "blue",
      "vermillion",
      "bronze",
    ]);
    expect(DM_DEFAULT_COLOR).toBe("amber");
    // Players join one by one under an amber DM.
    const taken: PlayerColor[] = ["amber"];
    for (let i = 0; i < 7; i++) taken.push(defaultColor(taken));
    expect(taken.slice(1)).toEqual([
      "jade",
      "sky",
      "rose",
      "yellow",
      "blue",
      "vermillion",
      "bronze",
    ]);
    // A DM on jade: the first player gets amber.
    expect(defaultColor(["jade"])).toBe("amber");
    // A picked key is skipped like any other.
    expect(defaultColor(["amber", "jade", "rose"])).toBe("sky");
    // 9th player: every key used once → the first in palette order; then the least used.
    expect(defaultColor(taken)).toBe("amber");
    expect(defaultColor([...taken, "amber"])).toBe("jade");
    expect(defaultColor([...taken, "amber", "amber", "jade"])).toBe("sky");
  });
});

describe("FR-CAMP-28 palette contrast", () => {
  test("FR-CAMP-28 palette contrast: WCAG ≥ 4.5 on windows and app, ≥ 5.0 on the casing; reproduces §7's figures to 0.1", () => {
    for (const k of PLAYER_COLOR_KEYS) {
      const hex = PLAYER_COLORS[k];
      const got = [SURFACES.app, SURFACES.window, SURFACES.casing].map((s) =>
        contrastRatio(hex, s),
      );
      const [app, win, casing] = got as [number, number, number];
      expect({ k, ok: app >= 4.5 && win >= 4.5 && casing >= 5 }).toEqual({ k, ok: true });
      for (const [i, want] of SECTION_7[k].entries()) {
        expect(Math.abs((got[i] as number) - want)).toBeLessThanOrEqual(0.1);
      }
    }
    // Sanity: the WCAG extremes.
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#777777", "#777777")).toBe(1);
  });

  test("FR-CAMP-28 palette contrast: CIEDE2000 after Machado 2009 (severity 1.0): min ≥ 14 normal, ≥ 9.5 deutan / protan, ≥ 6.5 tritan; §7's pairs to 0.1", () => {
    const normal = closestPair("normal");
    const deutan = closestPair("deuteranopia");
    const protan = closestPair("protanopia");
    const tritan = closestPair("tritanopia");
    expect(normal.deltaE).toBeGreaterThanOrEqual(14);
    expect(deutan.deltaE).toBeGreaterThanOrEqual(9.5);
    expect(protan.deltaE).toBeGreaterThanOrEqual(9.5);
    expect(tritan.deltaE).toBeGreaterThanOrEqual(6.5);
    // CAMP §7: normal 14.1 (sky–blue), deuteranopia 9.7 (sky–blue), protanopia 9.6 (sky–rose),
    // tritanopia 6.8 (sky–jade).
    expect([...normal.pair].sort()).toEqual(["blue", "sky"]);
    expect([...deutan.pair].sort()).toEqual(["blue", "sky"]);
    expect([...protan.pair].sort()).toEqual(["rose", "sky"]);
    expect([...tritan.pair].sort()).toEqual(["jade", "sky"]);
    for (const [got, want] of [
      [normal.deltaE, 14.1],
      [deutan.deltaE, 9.7],
      [protan.deltaE, 9.6],
      [tritan.deltaE, 6.8],
    ] as const) {
      expect(Math.abs(got - want)).toBeLessThanOrEqual(0.1);
    }
  });

  test("FR-CAMP-28 palette contrast: every key ΔE ≥ 15 from accent.danger (blocked paths, wall hints)", () => {
    for (const k of PLAYER_COLOR_KEYS) {
      expect({ k, far: deltaE(PLAYER_COLORS[k], ACCENT_DANGER) >= 15 }).toEqual({ k, far: true });
    }
  });

  test("CIEDE2000 reproduces Sharma, Wu & Dalal (2005) test pairs", () => {
    // Table 1 of the paper: pairs 1, 7, 17, 25 and 34.
    const pairs: [[number, number, number], [number, number, number], number][] = [
      [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
      [[50, 0, 0], [50, -1, 2], 2.3669],
      [[50, 2.5, 0], [73, 25, -18], 27.1492],
      [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
      [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
    ];
    for (const [a, b, want] of pairs) expect(ciede2000(a, b)).toBeCloseTo(want, 4);
  });
});
