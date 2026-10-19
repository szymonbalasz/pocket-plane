// Player colours (CAMP FR-CAMP-23, -28; ADR-0055): the fixed palette of 8, the default rule, and
// the pure checks behind CAMP §7's figures (WCAG 2.x contrast; CIEDE2000 after colour-blind
// simulation). The wire carries the key; each client maps it to `--player-<key>` (FR-CAMP-28).
import { z } from "zod";

/** Keys in default order (FR-CAMP-23: a new player gets the first free one). */
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
export type PlayerColor = (typeof PLAYER_COLOR_KEYS)[number];
export const PlayerColor = z.enum(PLAYER_COLOR_KEYS);

/** CAMP §7 palette, dark mode (visual-direction `player.<key>`). */
export const PLAYER_COLORS: Readonly<Record<PlayerColor, string>> = {
  amber: "#e69f00",
  jade: "#19b98a",
  sky: "#56b4e9",
  rose: "#e08ab8",
  yellow: "#f0e442",
  blue: "#5b8ff0",
  vermillion: "#d55e00",
  bronze: "#a07850",
};

/** FR-CAMP-24: every campaign starts here. */
export const DM_DEFAULT_COLOR: PlayerColor = "amber";

export const isPlayerColor = (v: unknown): v is PlayerColor =>
  (PLAYER_COLOR_KEYS as readonly unknown[]).includes(v);

/** "vermillion" → "Vermillion" (picker labels, CAMP §7). */
export const colorLabel = (k: PlayerColor): string => k.charAt(0).toUpperCase() + k.slice(1);

/**
 * FR-CAMP-23 default: the first key in palette order not in `taken` (the DM colour and the other
 * players' colours of the campaign); all 8 taken → the least-used key, ties in palette order.
 */
export function defaultColor(taken: readonly PlayerColor[]): PlayerColor {
  const uses = new Map<PlayerColor, number>(PLAYER_COLOR_KEYS.map((k) => [k, 0]));
  for (const k of taken) uses.set(k, (uses.get(k) ?? 0) + 1);
  let best: PlayerColor = PLAYER_COLOR_KEYS[0];
  for (const k of PLAYER_COLOR_KEYS) {
    if ((uses.get(k) ?? 0) < (uses.get(best) ?? 0)) best = k;
  }
  return best;
}

// ---- Colour science (FR-CAMP-28 palette contrast; no dependency) ----

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
export function closestPair(vision: Vision): { pair: [PlayerColor, PlayerColor]; deltaE: number } {
  let best: { pair: [PlayerColor, PlayerColor]; deltaE: number } | null = null;
  for (const [i, a] of PLAYER_COLOR_KEYS.entries()) {
    for (const b of PLAYER_COLOR_KEYS.slice(i + 1)) {
      const d = deltaE(PLAYER_COLORS[a], PLAYER_COLORS[b], vision);
      if (!best || d < best.deltaE) best = { pair: [a, b], deltaE: d };
    }
  }
  return best as { pair: [PlayerColor, PlayerColor]; deltaE: number };
}
