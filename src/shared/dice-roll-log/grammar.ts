// Dice expression grammar and limits (FR-DICE-01), adv/dis rewrite (FR-DICE-04). Pure; the
// server checks with it before the dice library ever sees a string, clients use it to preview.
import type { RollMode } from "@shared/events/dice-roll-log";

export const EXPRESSION_MAX_CHARS = 60;
export const MAX_TERMS = 10;
export const MAX_DICE = 50;
export const MAX_FACES = 1000;
export const MAX_CONSTANT = 999;

export interface DiceTerm {
  kind: "dice";
  sign: 1 | -1;
  count: number;
  faces: number;
  /** `kh` / `kl` K, or null (all dice kept). */
  keep: { which: "h" | "l"; n: number } | null;
}

export interface ConstTerm {
  kind: "const";
  sign: 1 | -1;
  value: number;
}

export type Term = DiceTerm | ConstTerm;

export type GrammarResult<T> = { ok: true; value: T } | { ok: false; message: string };

export const SYNTAX_MESSAGE = "Use NdM, NdMkhK, NdMklK or whole numbers joined by + or -";

const DICE_RE = /^(\d{1,6})d(\d{1,6})(?:k([hl])(\d{1,6}))?$/;
const CONST_RE = /^(\d{1,6})$/;

const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });

/** Checks the limits of a term list (also after an adv/dis rewrite). */
function checkLimits(terms: readonly Term[]): string | null {
  if (terms.length > MAX_TERMS) return `At most ${MAX_TERMS} terms`;
  let dice = 0;
  for (const t of terms) {
    if (t.kind === "const") {
      if (t.value > MAX_CONSTANT) return `Constants must be 0–${MAX_CONSTANT}`;
      continue;
    }
    if (t.count < 1) return "Dice count must be at least 1";
    if (t.count > MAX_DICE) return `At most ${MAX_DICE} dice`;
    if (t.faces < 2 || t.faces > MAX_FACES) return `Dice faces must be 2–${MAX_FACES}`;
    if (t.keep && (t.keep.n < 1 || t.keep.n > t.count)) return `Keep must be 1–${t.count}`;
    dice += t.count;
  }
  if (dice > MAX_DICE) return `At most ${MAX_DICE} dice`;
  return null;
}

/** FR-DICE-01: case-insensitive, spaces ignored, ≤ 60 chars, ≤ 10 terms, ≤ 50 dice. */
export function parseExpression(raw: string): GrammarResult<Term[]> {
  if (raw.length > EXPRESSION_MAX_CHARS) return fail(`At most ${EXPRESSION_MAX_CHARS} characters`);
  const s = raw.replace(/\s+/g, "").toLowerCase();
  if (s === "") return fail("Enter a dice expression");
  const parts = s.split(/([+-])/);
  if (parts.length > MAX_TERMS * 2 - 1) return fail(`At most ${MAX_TERMS} terms`);
  const terms: Term[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const body = parts[i] ?? "";
    const sign: 1 | -1 = i > 0 && parts[i - 1] === "-" ? -1 : 1;
    const d = DICE_RE.exec(body);
    if (d) {
      const keep = d[3] ? { which: d[3] as "h" | "l", n: Number(d[4]) } : null;
      terms.push({ kind: "dice", sign, count: Number(d[1]), faces: Number(d[2]), keep });
      continue;
    }
    const c = CONST_RE.exec(body);
    if (c) {
      terms.push({ kind: "const", sign, value: Number(c[1]) });
      continue;
    }
    return fail(SYNTAX_MESSAGE);
  }
  const limit = checkLimits(terms);
  return limit ? fail(limit) : { ok: true, value: terms };
}

/** Canonical notation, e.g. `2d20kh1+4`; what the library evaluates and the roll stores. */
export function toNotation(terms: readonly Term[]): string {
  return terms
    .map((t, i) => {
      const op = t.sign === -1 ? "-" : i === 0 ? "" : "+";
      if (t.kind === "const") return `${op}${t.value}`;
      const keep = t.keep ? `k${t.keep.which}${t.keep.n}` : "";
      return `${op}${t.count}d${t.faces}${keep}`;
    })
    .join("");
}

/**
 * FR-DICE-04: advantage / disadvantage rewrite the first `1d20` term to `2d20kh1` / `2d20kl1`.
 * No `1d20` term → an error naming the mode.
 */
export function applyMode(terms: readonly Term[], mode: RollMode): GrammarResult<Term[]> {
  if (mode === "normal") return { ok: true, value: [...terms] };
  const i = terms.findIndex(
    (t) => t.kind === "dice" && t.count === 1 && t.faces === 20 && t.keep === null,
  );
  if (i < 0) {
    return fail(`${mode === "advantage" ? "Advantage" : "Disadvantage"} needs a d20 roll`);
  }
  const out = [...terms];
  const t = out[i] as DiceTerm;
  out[i] = { ...t, count: 2, keep: { which: mode === "advantage" ? "h" : "l", n: 1 } };
  const limit = checkLimits(out);
  return limit ? fail(limit) : { ok: true, value: out };
}

/** Parse + mode in one step: the final terms a roll uses. */
export function prepareExpression(raw: string, mode: RollMode): GrammarResult<Term[]> {
  const parsed = parseExpression(raw);
  return parsed.ok ? applyMode(parsed.value, mode) : parsed;
}

export const diceTerms = (terms: readonly Term[]): DiceTerm[] =>
  terms.filter((t): t is DiceTerm => t.kind === "dice");

/** Net constant (signed sum of constant terms). */
export const constantOf = (terms: readonly Term[]): number =>
  terms.reduce((s, t) => (t.kind === "const" ? s + t.sign * t.value : s), 0);

/** Number of dice rolled, incl. dropped ones. */
export const diceCount = (terms: readonly Term[]): number =>
  diceTerms(terms).reduce((s, t) => s + t.count, 0);

/** Min–max of the dice part (sum of kept dice, signed): the manual `diceTotal` range (FR-DICE-06). */
export function diceRange(terms: readonly Term[]): { min: number; max: number } {
  let min = 0;
  let max = 0;
  for (const t of diceTerms(terms)) {
    const kept = t.keep ? t.keep.n : t.count;
    if (t.sign === 1) {
      min += kept;
      max += kept * t.faces;
    } else {
      min -= kept * t.faces;
      max -= kept;
    }
  }
  return { min, max };
}

/** Kept flags for one term's values: keep-highest / keep-lowest K, ties by position. */
export function keptFlags(term: DiceTerm, values: readonly number[]): boolean[] {
  if (!term.keep) return values.map(() => true);
  const order = values
    .map((v, i) => ({ v, i }))
    .sort((a, b) => (term.keep?.which === "h" ? b.v - a.v : a.v - b.v) || a.i - b.i);
  const kept = new Set(order.slice(0, term.keep.n).map((x) => x.i));
  return values.map((_, i) => kept.has(i));
}
