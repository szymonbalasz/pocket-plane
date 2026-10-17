// Tray composing and display (FR-DICEX-04, -05, -08 e), and the throw zone (FR-DICEX-17). Pure.
import {
  constantOf,
  type DiceTerm,
  MAX_DICE,
  parseExpression,
  type Term,
  toNotation,
} from "@shared/dice-roll-log/grammar";
import type { DmRollActorRef, RollCategory, RollMode } from "@shared/dice-roll-log/schemas";
import type { Rect } from "../play-shell/geometry";

export const PALETTE = [4, 6, 8, 10, 12, 20, 100] as const;

/** One die chip: `term` = index of its term in the expression (`data-term`). */
export interface TrayChip {
  faces: number;
  term: number;
  sign: 1 | -1;
  /** FR-DICEX-08 e: one of the two d20s of an adv / dis preview. */
  tag?: "adv" | "dis";
}

/** Terms of `expression`, or null when it doesn't parse. */
export function termsOf(expression: string): Term[] | null {
  const r = parseExpression(expression);
  return r.ok ? r.value : null;
}

const isPlainD20 = (t: Term): t is DiceTerm =>
  t.kind === "dice" && t.count === 1 && t.faces === 20 && t.keep === null;

/**
 * One chip per die, grouped by term. Adv / dis: the first `1d20` term shows two d20 chips tagged
 * with the mode (FR-DICEX-08 e), as FR-DICE-04 will roll it.
 */
export function chipsOf(terms: readonly Term[], mode: RollMode = "normal"): TrayChip[] {
  const out: TrayChip[] = [];
  const d20 = mode === "normal" ? -1 : terms.findIndex(isPlainD20);
  terms.forEach((t, term) => {
    if (t.kind !== "dice") return;
    if (term === d20) {
      const tag = mode === "advantage" ? "adv" : "dis";
      out.push({ faces: 20, term, sign: t.sign, tag }, { faces: 20, term, sign: t.sign, tag });
      return;
    }
    for (let i = 0; i < t.count; i++) out.push({ faces: t.faces, term, sign: t.sign });
  });
  return out;
}

/** The mode the tray previews: its own (toggle / keys) first, else the request's `previewMode`. */
export function previewMode(trayMode: RollMode, requestPreview?: RollMode): RollMode {
  return trayMode !== "normal" ? trayMode : (requestPreview ?? "normal");
}

const diceTotal = (terms: readonly Term[]) =>
  terms.reduce((n, t) => (t.kind === "dice" ? n + t.count : n), 0);

/** Palette: one die; joins the first positive same-faces term without keep, else a new term. */
export function addDie(terms: readonly Term[], faces: number): Term[] {
  if (diceTotal(terms) >= MAX_DICE) return [...terms];
  const i = terms.findIndex(
    (t) => t.kind === "dice" && t.faces === faces && t.keep === null && t.sign === 1,
  );
  if (i >= 0) {
    const t = terms[i] as DiceTerm;
    return terms.map((x, j) => (j === i ? { ...t, count: t.count + 1 } : x));
  }
  // New dice go before the constants, so "1d12+5" + d6 reads "1d12+1d6+5".
  const firstConst = terms.findIndex((t) => t.kind === "const");
  const die: DiceTerm = { kind: "dice", sign: 1, count: 1, faces, keep: null };
  if (firstConst < 0) return [...terms, die];
  return [...terms.slice(0, firstConst), die, ...terms.slice(firstConst)];
}

/** Clicking a chip removes one die of its term (the term goes with its last die). */
export function removeDie(terms: readonly Term[], term: number): Term[] {
  const t = terms[term];
  if (t?.kind !== "dice") return [...terms];
  if (t.count <= 1) return terms.filter((_, j) => j !== term);
  const count = t.count - 1;
  const keep = t.keep ? (t.keep.n >= count ? null : t.keep) : null;
  return terms.map((x, j) => (j === term ? { ...t, count, keep } : x));
}

/** The constant Input: every constant term replaced by one (0 → none), after the dice. */
export function setConstant(terms: readonly Term[], value: number): Term[] {
  const dice = terms.filter((t) => t.kind === "dice");
  if (value === 0 || !Number.isFinite(value)) return dice;
  const c: Term = { kind: "const", sign: value < 0 ? -1 : 1, value: Math.abs(Math.trunc(value)) };
  return [...dice, c];
}

export const constantOfTerms = constantOf;
export const notationOf = toNotation;

/**
 * FR-DICEX-17: bottom centre of the free area, at most 720×420. Null when the free area is the
 * fallback over windows (nothing may land on an open window).
 */
export const ZONE_MAX = { w: 720, h: 420 };

export function throwZone(free: Rect, windows: readonly Rect[]): Rect | null {
  const covered = windows.some(
    (r) =>
      r.x < free.x + free.w && free.x < r.x + r.w && r.y < free.y + free.h && free.y < r.y + r.h,
  );
  if (covered) return null;
  const w = Math.min(ZONE_MAX.w, free.w);
  const h = Math.min(ZONE_MAX.h, free.h);
  return { x: Math.round(free.x + (free.w - w) / 2), y: free.y + free.h - h, w, h };
}

/** A `free` request's fields (FR-DICEX-02). */
export interface FreeFields {
  expression: string;
  mode: RollMode;
  category: RollCategory;
  label?: string;
  actor?: DmRollActorRef;
}

/**
 * The `free` request after a palette click: it adds to the staged request, but after a result
 * it starts a new roll with nothing of the old one's label, actor or category (BL-18: a
 * notation's "Notation test" label stuck to the next palette roll).
 */
export function paletteRequest(
  staged: FreeFields | null,
  expression: string,
  mode: RollMode,
  fresh: boolean,
): FreeFields {
  if (staged && !fresh) return { ...staged, expression };
  return { expression, mode, category: "other" };
}
