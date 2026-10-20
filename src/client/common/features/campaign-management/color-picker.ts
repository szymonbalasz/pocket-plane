// The colour picker's model (CAMP FR-CAMP-35), DOM-free: HSV ↔ hex, the exact verdict of a draft
// (FR-CAMP-31 validity, then FR-CAMP-32 distance against the store's colours), the clamp of a
// marker target (column → row → rings, judged by the exact rules; "none at this hue" cached per
// (hue, others)) and the shading mask, which is drawing only.
import {
  COLOR_PROBLEM_MESSAGE,
  type ColorHolder,
  type ColorProblem,
  colorClash,
  colorProblem,
  hexToRgb,
  normalizeColor,
} from "@shared/campaign-management/colors";

/** Saturation and value in whole percent (0–100): the marker moves in 1 % steps. */
export interface Sv {
  s: number;
  v: number;
}

/** Hue in whole degrees (0–359) plus the marker. */
export interface Hsv extends Sv {
  h: number;
}

/** `camp-color-status`'s `data-reason`. */
export type PickerReason = ColorProblem | "taken" | "too-close" | "no-colour" | "bad-hex";

export interface Verdict {
  reason: PickerReason;
  message: string;
  /** The holder clashed with (player id | `dm`), for distance reasons. */
  by?: string;
}

export const NO_COLOUR_MESSAGE = "No allowed colour at this hue";
export const BAD_HEX_MESSAGE = "Enter a colour as #rrggbb or #rgb";

const byte = (c: number) =>
  Math.round(c * 255)
    .toString(16)
    .padStart(2, "0");

/** HSV (h °, s / v %) → lowercase `#rrggbb`. */
export function hsvToHex({ h, s, v }: Hsv): string {
  const S = s / 100;
  const V = v / 100;
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return V - V * S * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return `#${byte(f(5))}${byte(f(3))}${byte(f(1))}`;
}

/** `#rrggbb` → HSV rounded to whole degrees / percent (greys get hue 0). */
export function hexToHsv(hex: string): Hsv {
  const [r, g, b] = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) {
    h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return {
    h: Math.round(h + 360) % 360,
    s: max > 0 ? Math.round((d / max) * 100) : 0,
    v: Math.round(max * 100),
  };
}

/**
 * The hex field (CAMP §7): `#rrggbb`, or `#rgb` when `short`, `#` optional, any case →
 * lowercase `#rrggbb`; anything else → null.
 */
export function parseHexInput(text: string, short = true): string | null {
  const t = text.trim().replace(/^#/, "").toLowerCase();
  if (/^[0-9a-f]{6}$/.test(t)) return `#${t}`;
  if (short && /^[0-9a-f]{3}$/.test(t)) return `#${[...t].map((c) => c + c).join("")}`;
  return null;
}

/** FR-CAMP-31 then FR-CAMP-32 (against `others`, the target excluded): null = allowed. */
export function judge(hex: string, others: readonly ColorHolder[]): Verdict | null {
  const problem = colorProblem(hex);
  if (problem) return { reason: problem, message: COLOR_PROBLEM_MESSAGE[problem] };
  const clash = colorClash(hex, others);
  return clash ? { reason: clash.reason, message: clash.message, by: clash.by } : null;
}

/** The exact rules for one set of others, memoised per hex (many marker points share one). */
export interface PickerRules {
  /** Identifies the others' colours: part of the "none at this hue" cache key. */
  key: string;
  verdict(hex: string): Verdict | null;
  allowed(hex: string): boolean;
}

export function pickerRules(others: readonly ColorHolder[]): PickerRules {
  const memo = new Map<string, Verdict | null>();
  const verdict = (hex: string) => {
    let v = memo.get(hex);
    if (v === undefined) {
      v = judge(hex, others);
      memo.set(hex, v);
    }
    return v;
  };
  const key = others
    .map((o) => normalizeColor(o.color) ?? "")
    .sort()
    .join(",");
  return { key, verdict, allowed: (hex) => verdict(hex) === null };
}

const inRange = (x: number) => x >= 0 && x <= 100;

/**
 * FR-CAMP-35 clamp search for a disallowed `target`, nearest first: (1) its column (same S,
 * V ± 1, ± 2 …; ties → higher V); (2) its row (same V, S ± 1 …; ties → higher S); (3) rings of
 * Manhattan distance 1, 2 … (within a ring higher V, then higher S). Null = none in the square.
 */
export function searchSv(target: Sv, ok: (p: Sv) => boolean): Sv | null {
  const { s, v } = target;
  for (let d = 1; d <= 100; d++) {
    for (const vv of [v + d, v - d]) if (inRange(vv) && ok({ s, v: vv })) return { s, v: vv };
  }
  for (let d = 1; d <= 100; d++) {
    for (const ss of [s + d, s - d]) if (inRange(ss) && ok({ s: ss, v })) return { s: ss, v };
  }
  for (let d = 1; d <= 200; d++) {
    for (let dv = d; dv >= -d; dv--) {
      const vv = v + dv;
      if (!inRange(vv)) continue;
      const ds = d - Math.abs(dv);
      // The column and row were searched above.
      if (ds === 0 || dv === 0) continue;
      for (const ss of [s + ds, s - ds])
        if (inRange(ss) && ok({ s: ss, v: vv })) return { s: ss, v: vv };
    }
  }
  return null;
}

export interface Clamped extends Hsv {
  hex: string;
  /** No allowed point at this hue: the marker stays at the target (FR-CAMP-35). */
  none: boolean;
}

/** Hues (with the others' key) known to have no allowed point: a drag skips the search. */
export type ClampCache = Set<string>;

/**
 * FR-CAMP-35: where a marker target lands. Allowed by the exact rules → taken; else the nearest
 * allowed point per `searchSv`; none at this hue → the target itself with `none` (cached per
 * (hue, others), so the next target at that hue costs nothing).
 */
export function clamp(target: Hsv, rules: PickerRules, cache: ClampCache): Clamped {
  const at = (p: Sv) => hsvToHex({ h: target.h, ...p });
  const none = { ...target, hex: at(target), none: true };
  const key = `${target.h}|${rules.key}`;
  if (cache.has(key)) return none;
  if (rules.allowed(none.hex)) return { ...none, none: false };
  const found = searchSv(target, (p) => rules.allowed(at(p)));
  if (found) return { h: target.h, ...found, hex: at(found), none: false };
  cache.add(key);
  return none;
}

/** The mask's grid (CAMP §7): 32 × 32 cells over the square. */
export const MASK_CELLS = 32;

/**
 * The shading over the square at hue `h` (drawing only; may disagree with the exact rules at
 * cell edges): an SVG path in a `MASK_CELLS`² viewBox, one rect per run of blocked cells in a
 * row, judged at each cell's centre. Row 0 is the top (V = 100).
 */
export function maskPath(h: number, rules: PickerRules): string {
  const step = 100 / MASK_CELLS;
  let d = "";
  for (let row = 0; row < MASK_CELLS; row++) {
    const v = 100 - (row + 0.5) * step;
    let start = -1;
    for (let col = 0; col <= MASK_CELLS; col++) {
      const blocked = col < MASK_CELLS && !rules.allowed(hsvToHex({ h, s: (col + 0.5) * step, v }));
      if (blocked && start < 0) start = col;
      if (!blocked && start >= 0) {
        d += `M${start} ${row}h${col - start}v1h${start - col}z`;
        start = -1;
      }
    }
  }
  return d;
}
