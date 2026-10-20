import { describe, expect, test } from "bun:test";
import {
  type ColorProblem,
  chroma,
  ciede2000,
  closestPair,
  colorClash,
  colorDistance,
  colorName,
  colorProblem,
  contrastRatio,
  DANGER_REDS,
  DM_DEFAULT_COLOR,
  defaultColor,
  deltaE,
  HexColorInput,
  normalizeColor,
  type PaletteKey,
  PLAYER_COLOR_KEYS,
  PLAYER_COLORS,
} from "./colors";

/** CAMP §7: on the app background, the window surface, the canvas casing. */
const SURFACES = { app: "#0a0a0a", window: "#171717", casing: "#000000" } as const;
const SECTION_7: Record<PaletteKey, [number, number, number]> = {
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
const P = PLAYER_COLORS;
const LAVENDER = "#b388ff";
const LIME = "#a0c814";
const r1 = (x: number) => Math.round(x * 10) / 10;

/** HSV (h°, s and v 0–1) → `#rrggbb`. */
function hsv(h: number, s: number, v: number): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  const hex = (x: number) =>
    Math.round(x * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${hex(f(5))}${hex(f(3))}${hex(f(1))}`;
}

/** CAMP §6's grid: hue 3°, saturation and value in 5 % steps. */
const GRID: string[] = [];
for (let h = 0; h < 360; h += 3) {
  for (let s = 0; s <= 100; s += 5) {
    for (let v = 0; v <= 100; v += 5) GRID.push(hsv(h, s / 100, v / 100));
  }
}

describe("FR-CAMP-30 colour value", () => {
  test("FR-CAMP-30 colour value: palette colours keep order and hex; DM default Amber's hex; keys and any-case hex normalise; palette colours show their name, others their hex", () => {
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
    expect(DM_DEFAULT_COLOR).toBe("#e69f00");
    expect(normalizeColor("rose")).toBe(P.rose);
    expect(normalizeColor("#ABCDEF")).toBe("#abcdef");
    for (const bad of ["red", "Rose", "#abc", "#abcdeg", "", null, undefined, 7]) {
      expect(normalizeColor(bad)).toBeNull();
    }
    expect([colorName("#E08AB8"), colorName("rose"), colorName(LAVENDER)]).toEqual([
      "Rose",
      "Rose",
      LAVENDER,
    ]);
    // `camp.setColor`'s colour (FR-CAMP-33): any-case hex, stored lowercase; no names, no #rgb.
    expect(HexColorInput.parse("#7FD8FF")).toBe("#7fd8ff");
    for (const bad of ["vermillion", "#fff", "7fd8ff", "#7fd8ff "]) {
      expect({ bad, ok: HexColorInput.safeParse(bad).success }).toEqual({ bad, ok: false });
    }
  });
});

describe("FR-CAMP-31 colour validity", () => {
  test("FR-CAMP-31 colour validity: every palette colour passes; too-dark, too-grey, too-red examples, danger (a) in colour-blind views", () => {
    for (const k of PLAYER_COLOR_KEYS) expect({ k, p: colorProblem(P[k]) }).toEqual({ k, p: null });
    // #3d6ec9: 3.65 : 1 on the window surface.
    expect(contrastRatio("#3d6ec9", "#171717")).toBeCloseTo(3.65, 2);
    expect(colorProblem("#3d6ec9")).toBe("too-dark");
    expect(colorProblem("#5a4630")).toBe("too-dark");
    expect([r1(chroma("#9e9e9e")), colorProblem("#9e9e9e")]).toEqual([0, "too-grey"]);
    expect([r1(deltaE("#f05555", ACCENT_DANGER)), colorProblem("#f05555")]).toEqual([
      3.5,
      "too-red",
    ]);
    // Danger (a), #288: normal 19.7 but 1.5 for deuteranopia vs #ef4444.
    expect([
      r1(deltaE("#cc793d", ACCENT_DANGER)),
      r1(colorDistance("#cc793d", ACCENT_DANGER)),
    ]).toEqual([19.7, 1.5]);
    expect(colorProblem("#cc793d")).toBe("too-red");
    // The tightest palette colours still pass: Vermillion 5.4, Bronze 5.7 (vs #ef4444), 5.9.
    expect(DANGER_REDS).toEqual(["#ef4444", "#ff6467"]);
    expect(r1(colorDistance(P.vermillion, ACCENT_DANGER))).toBe(5.4);
    expect(r1(colorDistance(P.bronze, ACCENT_DANGER))).toBe(5.7);
    expect(r1(colorDistance(P.bronze, "#ff6467"))).toBe(5.9);
    expect([LAVENDER, "#7fd8ff", "#80d8ff", LIME].map(colorProblem)).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  test("FR-CAMP-31 colour validity: boundaries, adjacent hex either side: 4.49 / 4.50 : 1, C* 24.9 / 25.0, normal ΔE 14.9 / 15.0, worst ΔE 4.9 / 5.0 from #ef4444 and from --destructive", () => {
    const cases: [string, string, (h: string) => number, number, ColorProblem][] = [
      ["#507dd8", "#507ed9", (h) => contrastRatio(h, "#171717"), 4.5, "too-dark"],
      ["#71b0ce", "#71b0cf", chroma, 25, "too-grey"],
      ["#f4447d", "#f4447e", (h) => deltaE(h, ACCENT_DANGER), 15, "too-red"],
      ["#d08530", "#d0852f", (h) => colorDistance(h, ACCENT_DANGER), 5, "too-red"],
      ["#96b140", "#96b13f", (h) => colorDistance(h, "#ff6467"), 5, "too-red"],
    ];
    for (const [under, over, measure, threshold, problem] of cases) {
      expect({ under, below: measure(under) < threshold, p: colorProblem(under) }).toEqual({
        under,
        below: true,
        p: problem,
      });
      expect({ over, atLeast: measure(over) >= threshold, p: colorProblem(over) }).toEqual({
        over,
        atLeast: true,
        p: null,
      });
      expect(measure(over) - measure(under)).toBeLessThan(0.3);
    }
  });

  test("FR-CAMP-31 colour validity: about 17 % of the HSV grid passes", () => {
    const pass = GRID.filter((h) => colorProblem(h) === null).length / GRID.length;
    expect(pass).toBeGreaterThan(0.16);
    expect(pass).toBeLessThan(0.19);
  });
});

describe("FR-CAMP-32 distance rule", () => {
  test("FR-CAMP-32 distance rule: palette pairwise ≥ 9.6 (Sky–Rose); lime vs Amber → colour-blind message; lavender vs Blue too close; same hex → Taken by; the closest holder named", () => {
    let min = { d: Infinity, pair: "" };
    for (const [i, a] of PLAYER_COLOR_KEYS.entries()) {
      for (const b of PLAYER_COLOR_KEYS.slice(i + 1)) {
        const d = colorDistance(P[a], P[b]);
        if (d < min.d) min = { d, pair: `${a}-${b}` };
      }
    }
    expect([r1(min.d), min.pair]).toEqual([9.6, "sky-rose"]);

    const dm = { by: "dm", name: "DM", color: P.amber };
    expect([r1(deltaE(LIME, P.amber)), r1(colorDistance(LIME, P.amber))]).toEqual([28.5, 2]);
    expect(colorClash(LIME, [dm])).toEqual({
      reason: "too-close",
      by: "dm",
      message: "Too close to DM's colour for colour-blind players",
    });
    const p2 = { by: "p2", name: "Player 2", color: LAVENDER };
    expect([r1(colorDistance(LAVENDER, P.blue)), r1(colorDistance(LAVENDER, P.sky))]).toEqual([
      2.3, 4.9,
    ]);
    expect(colorClash(P.blue, [dm, p2])?.message).toBe(
      "Too close to Player 2's colour for colour-blind players",
    );
    // Under 9 in normal vision too → no colour-blind suffix.
    expect(colorClash("#7fd8ff", [{ by: "p1", name: "Player 1", color: "#80d8ff" }])).toEqual({
      reason: "too-close",
      by: "p1",
      message: "Too close to Player 1's colour",
    });
    expect(colorClash("#B388FF", [dm, p2])).toEqual({
      reason: "taken",
      by: "p2",
      message: "Taken by Player 2",
    });
    // An old key reads as its hex; an unreadable holder is skipped; far enough → null.
    expect(colorClash(P.jade, [{ by: "p1", name: "Player 1", color: "jade" }])?.reason).toBe(
      "taken",
    );
    expect(colorClash(P.jade, [{ by: "p9", name: "X", color: "red" }])).toBeNull();
    expect(colorClash(LAVENDER, [dm, { by: "p1", name: "Player 1", color: P.jade }])).toBeNull();
    // Two holders under 9: the closer one is named.
    const near = { by: "p3", name: "Player 3", color: "#b389ff" };
    expect(colorClash("#b388fe", [p2, near])?.by).toBe("p2");
    expect(colorClash("#b389fe", [p2, near])?.by).toBe("p3");
  });

  test("FR-CAMP-32 distance rule: a greedy pack over the grid (palette first) yields ≥ 18 colours at ≥ 9", () => {
    const pack = PLAYER_COLOR_KEYS.map((k) => P[k]);
    for (const h of GRID) {
      if (colorProblem(h) === null && pack.every((c) => colorDistance(h, c) >= 9)) pack.push(h);
    }
    expect(pack.length).toBeGreaterThanOrEqual(18);
  });

  test("FR-CAMP-32 defaults: add order Jade, Sky, Rose…; lavender blocks Blue and Sky; all blocked → the farthest, ties in palette order", () => {
    // Players join one by one under an Amber DM.
    const taken: string[] = [DM_DEFAULT_COLOR];
    for (let i = 0; i < 7; i++) taken.push(defaultColor(taken));
    expect(taken.slice(1)).toEqual([
      P.jade,
      P.sky,
      P.rose,
      P.yellow,
      P.blue,
      P.vermillion,
      P.bronze,
    ]);
    // A DM on Jade: the first player gets Amber; a picked colour is skipped like any other.
    expect(defaultColor([P.jade])).toBe(P.amber);
    expect(defaultColor([P.amber, P.jade, P.rose])).toBe(P.sky);
    // Player 2 lavender: Blue (2.3) and Sky (4.9) are too close → Rose; later Vermillion.
    expect(defaultColor([P.amber, P.jade, LAVENDER])).toBe(P.rose);
    expect(defaultColor([P.amber, P.jade, LAVENDER, P.rose, P.yellow])).toBe(P.vermillion);
    // Old keys read as their hex; unreadable values are ignored.
    expect(defaultColor(["amber", "jade", "nope"])).toBe(P.sky);
    // All 8 taken: every distance 0 → the first in palette order, again and again.
    const all = PLAYER_COLOR_KEYS.map((k) => P[k]);
    expect(defaultColor(all)).toBe(P.amber);
    expect(defaultColor([...all, P.amber])).toBe(P.amber);
    // One holder a near-twin instead: that palette colour's distance is small but the largest.
    for (const [k, twin] of [
      ["amber", "#e8a10a"],
      ["jade", "#1bbb8c"],
    ] as const) {
      const held = all.map((c) => (c === P[k] ? twin : c));
      expect(colorDistance(P[k], twin)).toBeGreaterThan(0);
      expect(colorDistance(P[k], twin)).toBeLessThan(9);
      expect(defaultColor(held)).toBe(P[k]);
    }
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
