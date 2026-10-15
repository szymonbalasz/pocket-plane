// FR-ENT-25 (OQ-ENT-20): a creature's optional HP formula `NdM`, optionally `+K` / `−K`
// (N 1–50, M ∈ 4/6/8/10/12/20, K 0–999), e.g. `2d8+2`. Pure; combat rolls it for monsters'
// "Rolled" HP (FR-CBT-62/64). Average HP stays `statBlock.hpMax`; `hpAverage` is a form hint.

export const HP_FORMULA_FACES = [4, 6, 8, 10, 12, 20] as const;
export const HP_FORMULA_DICE_MAX = 50;
export const HP_FORMULA_MODIFIER_MAX = 999;
export const HP_MAX = 999;
export const HP_FORMULA_MESSAGE = "Use NdM+K, e.g. 2d8+2 (d4–d20, up to 50 dice)";

export interface HpFormulaParts {
  count: number;
  faces: number;
  /** Signed. */
  modifier: number;
}

const RE = /^(\d{1,2})d(\d{1,2})(?:([+-])(\d{1,3}))?$/;

/** Lower-case, no spaces, `−` (U+2212) → `-`. The stored form. */
export function normalizeHpFormula(raw: string): string {
  return raw.replace(/\s+/g, "").replace(/−/g, "-").toLowerCase();
}

/** The formula's parts, or null if it isn't a valid formula (after normalising). */
export function parseHpFormula(raw: string): HpFormulaParts | null {
  const m = RE.exec(normalizeHpFormula(raw));
  if (!m) return null;
  const count = Number(m[1]);
  const faces = Number(m[2]);
  const k = m[4] === undefined ? 0 : Number(m[4]);
  if (count < 1 || count > HP_FORMULA_DICE_MAX) return null;
  if (!(HP_FORMULA_FACES as readonly number[]).includes(faces)) return null;
  if (k > HP_FORMULA_MODIFIER_MAX) return null;
  return { count, faces, modifier: m[3] === "-" ? -k : k };
}

function parts(formula: string): HpFormulaParts {
  const p = parseHpFormula(formula);
  if (!p) throw new Error(`Not an HP formula: "${formula}"`);
  return p;
}

/** 5e "average": `max(1, floor(N × (M + 1) / 2) + K)`, capped at 999. */
export function hpAverage(formula: string): number {
  const p = parts(formula);
  return Math.min(HP_MAX, Math.max(1, Math.floor((p.count * (p.faces + 1)) / 2) + p.modifier));
}

/** The expression `dice.evaluate` rolls (e.g. `2d8+2`); the caller clamps the total to 1–999. */
export function hpRollSpec(formula: string): string {
  const p = parts(formula);
  const mod = p.modifier === 0 ? "" : p.modifier > 0 ? `+${p.modifier}` : `-${-p.modifier}`;
  return `${p.count}d${p.faces}${mod}`;
}

/** Clamp a rolled HP total into 1–999 (FR-CBT-64). */
export const clampRolledHp = (total: number): number => Math.min(HP_MAX, Math.max(1, total));
