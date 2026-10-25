// Player colours (CAMP FR-CAMP-23, -28, -30–32; ADR-0055 amended by ADR-0057): a colour is a
// lowercase `#rrggbb`; the 8 sprint-5 colours are the suggested palette colours. Pure rules used
// by server and picker: validity (`colorProblem`), the distance between people (`colorDistance`,
// `colorClash`) and a new player's default (`defaultColor`), on the WCAG / CIELAB / CIEDE2000
// helpers below (no dependency).
import { z } from "zod";

/** Palette keys in default order (FR-CAMP-32: a new player gets the first one far enough away). */
export const PLAYER_COLOR_KEYS = [
  "amber",
  "jade",
  "sky",
  "rose",
  "yellow",
  "blue",
  "vermillion",
  "bronze",
] as const;
export type PaletteKey = (typeof PLAYER_COLOR_KEYS)[number];
export const PaletteKey = z.enum(PLAYER_COLOR_KEYS);

/** CAMP §7 palette colours, dark mode (visual-direction `player.<key>`); order and hex fixed. */
export const PLAYER_COLORS: Readonly<Record<PaletteKey, string>> = {
  amber: "#e69f00",
  jade: "#19b98a",
  sky: "#56b4e9",
  rose: "#e08ab8",
  yellow: "#f0e442",
  blue: "#5b8ff0",
  vermillion: "#d55e00",
  bronze: "#a07850",
};

/** FR-CAMP-24, -30: every campaign starts at Amber (written by the create command). */
export const DM_DEFAULT_COLOR = PLAYER_COLORS.amber;

export const isPaletteKey = (v: unknown): v is PaletteKey =>
  (PLAYER_COLOR_KEYS as readonly unknown[]).includes(v);

/** A stored colour (FR-CAMP-30): lowercase `#rrggbb`. */
export const isHexColor = (v: unknown): v is string =>
  typeof v === "string" && /^#[0-9a-f]{6}$/.test(v);

/** `camp.setColor`'s colour (FR-CAMP-33): `#rrggbb` in any case, stored lowercase; no names. */
export const HexColorInput = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Expected a #rrggbb colour")
  .transform((s) => s.toLowerCase());

/**
 * A colour as old data or an older peer may hold it (FR-CAMP-34, -36): a palette key → its hex,
 * a hex in any case → lowercase; anything else → null.
 */
export function normalizeColor(v: unknown): string | null {
  if (isPaletteKey(v)) return PLAYER_COLORS[v];
  if (typeof v === "string" && /^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
  return null;
}

/** The palette key whose hex this is (any case), or null. */
export function paletteKeyOf(hex: string): PaletteKey | null {
  const h = hex.toLowerCase();
  return PLAYER_COLOR_KEYS.find((k) => PLAYER_COLORS[k] === h) ?? null;
}

/** "vermillion" → "Vermillion" (picker labels, CAMP §7). */
export const colorLabel = (k: PaletteKey): string => k.charAt(0).toUpperCase() + k.slice(1);

/** FR-CAMP-30: a palette colour shows its name ("Rose"), any other colour its hex. */
export function colorName(color: string): string {
  const hex = normalizeColor(color);
  const key = hex ? paletteKeyOf(hex) : null;
  return key ? colorLabel(key) : (hex ?? color);
}

// ---- FR-CAMP-31 validity ----

/**
 * The window surface (`--card`) of each theme: log names are text on it. FR-THEME-18: a colour
 * must read on both, Default's `#171717` and Gilt & Stone's `#101414`.
 */
export const WINDOW_SURFACES = { default: "#171717", gilt: "#101414" } as const;
/** Default's window surface. */
export const WINDOW_SURFACE = WINDOW_SURFACES.default;
/** The danger reds the app draws: `accent.danger` / `hp.down`, the canvas `--destructive`. */
export const DANGER_REDS = ["#ef4444", "#ff6467"] as const;
export const MIN_CONTRAST = 4.5;
export const MIN_CHROMA = 25;
/** ΔE2000 from `accent.danger` in normal vision. */
export const MIN_DANGER_NORMAL = 15;
/** ΔE2000 from each danger red in the worst of the three views (OQ-CAMP-29 danger (a)). */
export const MIN_DANGER_WORST = 5;

export type ColorProblem = "too-dark" | "too-grey" | "too-red";

export const COLOR_PROBLEM_MESSAGE: Readonly<Record<ColorProblem, string>> = {
  "too-dark": "Too dark to read on the map",
  "too-grey": "Too grey",
  "too-red": "Too close to the danger red",
};

/** CIELAB chroma C* (normal vision). */
export function chroma(hex: string): number {
  const [, a, b] = linearToLab(linearRgb(hexToRgb(hex)));
  return Math.hypot(a, b);
}

/**
 * FR-CAMP-31: null when the colour reads on the map and stays a person colour; else the first
 * rule it breaks: (a) contrast ≥ 4.5 : 1 on every theme's window surface (FR-THEME-18); (b)
 * C* ≥ 25; (c) ΔE ≥ 15 from `#ef4444` in normal vision and ≥ 5 from each danger red in the worst
 * of the three views.
 */
export function colorProblem(hex: string): ColorProblem | null {
  if (surfaceContrast(hex) < MIN_CONTRAST) return "too-dark";
  if (chroma(hex) < MIN_CHROMA) return "too-grey";
  if (deltaE(hex, DANGER_REDS[0]) < MIN_DANGER_NORMAL) return "too-red";
  if (DANGER_REDS.some((red) => colorDistance(hex, red) < MIN_DANGER_WORST)) return "too-red";
  return null;
}

/** FR-THEME-18: the lowest contrast of `hex` over the window surfaces of all themes. */
export function surfaceContrast(hex: string): number {
  return Math.min(...Object.values(WINDOW_SURFACES).map((s) => contrastRatio(hex, s)));
}

// ---- FR-CAMP-32 distance between people ----

/** A pick must be at least this far from everyone else's colour. */
export const MIN_PERSON_DISTANCE = 9;
/** The views the distance is checked in (not tritanopia, CAMP §7). */
export const DISTANCE_VISIONS = ["normal", "deuteranopia", "protanopia"] as const;

/** FR-CAMP-32: the smallest ΔE2000 of `a` vs `b` in normal, deuteranopia and protanopia views. */
export function colorDistance(a: string, b: string): number {
  return Math.min(...DISTANCE_VISIONS.map((v) => deltaE(a, b, v)));
}

/** Someone else's colour in the campaign: a player (`by` = id) or the DM (`by` = `dm`). */
export interface ColorHolder {
  by: string;
  name: string;
  color: string;
}

export interface ColorClash {
  reason: "taken" | "too-close";
  by: string;
  message: string;
}

/**
 * FR-CAMP-32: the closest holder under 9 (ties in the given order), or null. Distance 0 →
 * "Taken by ‹name›"; else "Too close to ‹name›'s colour", plus " for colour-blind players" when
 * normal vision alone is ≥ 9. A holder whose colour isn't readable (`normalizeColor`) is skipped.
 */
export function colorClash(hex: string, others: readonly ColorHolder[]): ColorClash | null {
  const own = hex.toLowerCase();
  let best: { h: ColorHolder; hex: string; d: number } | null = null;
  for (const h of others) {
    const other = normalizeColor(h.color);
    if (!other) continue;
    const d = other === own ? 0 : colorDistance(own, other);
    if (d < MIN_PERSON_DISTANCE && (!best || d < best.d)) best = { h, hex: other, d };
  }
  if (!best) return null;
  const { h, d } = best;
  if (d === 0) return { reason: "taken", by: h.by, message: `Taken by ${h.name}` };
  const cb = deltaE(own, best.hex) >= MIN_PERSON_DISTANCE ? " for colour-blind players" : "";
  return { reason: "too-close", by: h.by, message: `Too close to ${h.name}'s colour${cb}` };
}

/**
 * FR-CAMP-32 default (amends FR-CAMP-23): the first palette colour at distance ≥ 9 from every
 * colour in `taken` (the DM colour and the campaign's other players'; read with
 * `normalizeColor`, unreadable ones ignored); none → the palette colour whose smallest distance
 * is largest, ties in palette order. Deterministic: no `ctx` generator.
 */
export function defaultColor(taken: readonly string[]): string {
  const held = taken.map(normalizeColor).filter((c): c is string => c !== null);
  let best = { hex: PLAYER_COLORS[PLAYER_COLOR_KEYS[0]], d: -1 };
  for (const k of PLAYER_COLOR_KEYS) {
    const hex = PLAYER_COLORS[k];
    const d = Math.min(Infinity, ...held.map((c) => (c === hex ? 0 : colorDistance(hex, c))));
    if (d >= MIN_PERSON_DISTANCE) return hex;
    if (d > best.d) best = { hex, d };
  }
  return best.hex;
}

// ---- Colour science (FR-CAMP-28 palette contrast, FR-CAMP-31 / -32; no dependency) ----

export type Rgb = readonly [number, number, number];

/** `#rrggbb` → sRGB channels 0–1. */
export function hexToRgb(hex: string): Rgb {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`Not a #rrggbb colour: ${hex}`);
  return [m[1], m[2], m[3]].map((h) => Number.parseInt(h as string, 16) / 255) as unknown as Rgb;
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

export const linearRgb = (rgb: Rgb): Rgb => rgb.map(toLinear) as unknown as Rgb;

/** WCAG 2.x relative luminance. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = linearRgb(hexToRgb(hex));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

export type Vision = "normal" | "deuteranopia" | "protanopia" | "tritanopia";
type Matrix = readonly [Rgb, Rgb, Rgb];

/** Machado, Oliveira & Fernandes (2009), severity 1.0, applied to linear RGB. */
const MACHADO: Readonly<Record<Exclude<Vision, "normal">, Matrix>> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** Linear RGB as seen under `vision` (clamped to the gamut). */
export function simulate(lin: Rgb, vision: Vision): Rgb {
  if (vision === "normal") return lin;
  return MACHADO[vision].map((row) =>
    clamp01(row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]),
  ) as unknown as Rgb;
}

export type Lab = readonly [number, number, number];

/** Linear sRGB → CIELAB (D65). */
export function linearToLab([r, g, b]: Rgb): Lab {
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 / 116) * t + 16 / 116);
  const [fx, fy, fz] = [f(x), f(y), f(z)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const deg = (rad: number) => (rad * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;

/** CIEDE2000 (Sharma, Wu & Dalal 2005), kL = kC = kH = 1. */
export function ciede2000([L1, a1, b1]: Lab, [L2, a2, b2]: Lab): number {
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar7 = ((C1 + C2) / 2) ** 7;
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (b: number, a: number) => {
    if (b === 0 && a === 0) return 0;
    const h = deg(Math.atan2(b, a));
    return h < 0 ? h + 360 : h;
  };
  const h1p = hue(b1, a1p);
  const h2p = hue(b2, a2p);
  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp / 2));
  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
    else hbarp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
  }
  const T =
    1 -
    0.17 * Math.cos(rad(hbarp - 30)) +
    0.24 * Math.cos(rad(2 * hbarp)) +
    0.32 * Math.cos(rad(3 * hbarp + 6)) -
    0.2 * Math.cos(rad(4 * hbarp - 63));
  const dTheta = 30 * Math.exp(-(((hbarp - 275) / 25) ** 2));
  const Cbarp7 = Cbarp ** 7;
  const Rc = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbarp;
  const Sh = 1 + 0.015 * Cbarp * T;
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc;
  return Math.sqrt(
    (dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh),
  );
}

/** ΔE2000 between two hex colours as seen under `vision`. */
export function deltaE(a: string, b: string, vision: Vision = "normal"): number {
  const lab = (hex: string) => linearToLab(simulate(linearRgb(hexToRgb(hex)), vision));
  return ciede2000(lab(a), lab(b));
}

/** The closest pair of palette keys under `vision` (CAMP §7's colour-blind check). */
export function closestPair(vision: Vision): { pair: [PaletteKey, PaletteKey]; deltaE: number } {
  let best: { pair: [PaletteKey, PaletteKey]; deltaE: number } | null = null;
  for (const [i, a] of PLAYER_COLOR_KEYS.entries()) {
    for (const b of PLAYER_COLOR_KEYS.slice(i + 1)) {
      const d = deltaE(PLAYER_COLORS[a], PLAYER_COLORS[b], vision);
      if (!best || d < best.deltaE) best = { pair: [a, b], deltaE: d };
    }
  }
  return best as { pair: [PaletteKey, PaletteKey]; deltaE: number };
}
