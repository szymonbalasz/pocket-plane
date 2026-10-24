// Tray composing and display (FR-DICEX-04, -05, -08 e, -48), and the throw zone (FR-DICEX-17).
// Pure.
import type { DieShape } from "@shared/dice-extras/throw";
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
import type { ChunkState } from "./lazy3d";
import { type DisplaySetting, is3dDisplay } from "./settings";
import type { TrayExtraDice } from "./tray-extras";

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

/** A `trayExtras` entry's dice as chips (`term` = the entry's index), one per die. */
export const extraChips = (dice: readonly TrayExtraDice[]): TrayChip[] =>
  dice.flatMap((d, term) =>
    Array.from({ length: d.count }, () => ({ faces: d.faces, term, sign: d.sign })),
  );

/** FR-DICEX-48 (OQ-DICEX-36 A): more dice than this → one die per term with "×N". */
export const GROUP_OVER = 12;

/** One die of the tray preview; `group` = N when it stands for N dice of its term. */
export interface PreviewDie extends TrayChip {
  group?: number;
}

/** One die per chip, or (grouped) one per run of a term's chips with their count. */
export function previewDice(chips: readonly TrayChip[], grouped: boolean): PreviewDie[] {
  if (!grouped) return [...chips];
  const out: PreviewDie[] = [];
  for (const c of chips) {
    const last = out[out.length - 1];
    if (last && last.term === c.term && last.tag === c.tag) last.group = (last.group ?? 1) + 1;
    else out.push({ ...c });
  }
  return out;
}

/** A 3D still cell: a mesh shape, a d100 part. */
export type StillPart = `${DieShape}` | "d10:tens" | "d10:units";

const MESH: readonly number[] = [4, 6, 8, 10, 12, 20];

/** The still cells of a die (d100 = tens + units d10s); null → a round `DieShape` chip. */
export function stillParts(faces: number): StillPart[] | null {
  if (faces === 100) return ["d10:tens", "d10:units"];
  return MESH.includes(faces) ? [`d${faces}` as DieShape] : null;
}

export function parseStill(
  s: string | undefined,
): { shape: DieShape; part?: "tens" | "units" } | null {
  const [shape, part] = (s ?? "").split(":");
  if (!MESH.some((f) => `d${f}` === shape)) return null;
  const d = shape as DieShape;
  return part === "tens" || part === "units" ? { shape: d, part } : { shape: d };
}

/**
 * FR-DICEX-48 (table C): 3D stills when the effective display draws 3D (so not `flat` / `off`,
 * auto-flat, no WebGL, failed chunk) and the chunk is ready; else `DieShape` chips.
 */
export function trayPreviewMode(display: DisplaySetting, chunk: ChunkState, failed: boolean) {
  return is3dDisplay(display) && chunk === "ready" && !failed ? "3d" : "chips";
}

/** The tray asks for the chunk only in a 3D display (FR-DICEX-22: never in `flat` / `off`). */
export function trayWantsChunk(display: DisplaySetting, loader: { load(): void }): void {
  if (is3dDisplay(display)) loader.load();
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
 * FR-DICEX-50 (table F): the `free` request after an edit in the tray (a palette die, the
 * expression or the constant input). While composing it keeps the staged request; after a result
 * (or over a `control` request) it starts a new roll with nothing of the old one's label, actor or
 * category (BL-18: a notation's "Notation test" label stuck to the next palette roll). "Roll
 * again" re-sends the staged request as it is; a new stage (notation, roll bar, Alt+click)
 * replaces it with its own. Fresh = the tray is in `result`, or nothing `free` is staged.
 */
export const editStartsFresh = (state: string, request: "free" | "control" | null): boolean =>
  state === "result" || request !== "free";

/** The request `editStartsFresh` decides on: the staged one with the edit, or a fresh one. */
export function editRequest(
  staged: FreeFields | null,
  expression: string,
  mode: RollMode,
  fresh: boolean,
): FreeFields {
  if (staged && !fresh) return { ...staged, expression };
  return { expression, mode, category: "other" };
}

/** FR-DICEX-96: the tray's min, useful and default sizes, the steps its dice scale between. */
export const TRAY_MIN = { w: 300, h: 240 } as const;
export const TRAY_USEFUL = { w: 360, h: 300 } as const;
export const TRAY_DEFAULT = { w: 504, h: 420 } as const;
/** The dice scale at each step: today's dice at min, 48-px cells at useful, 56 at the default. */
export const TRAY_SCALE_STEPS = [1, 1.2, 1.4] as const;
export const TRAY_SCALE_MAX = 1.4;

type Box = { w: number; h: number };

/** Along one axis: the piecewise-linear value of `v` over `at` → `to` (clamped at both ends). */
function lerpAxis(v: number, at: readonly number[], to: readonly number[]): number {
  if (v <= (at[0] ?? 0)) return to[0] ?? 1;
  for (let i = 1; i < at.length; i++) {
    const a = at[i - 1] ?? 0;
    const b = at[i] ?? 0;
    if (v <= b) return (to[i - 1] ?? 1) + (((to[i] ?? 1) - (to[i - 1] ?? 1)) * (v - a)) / (b - a);
  }
  return to[to.length - 1] ?? 1;
}

/** The tighter axis's value over the three sizes, two decimals. */
function overSizes(win: Box | null, to: readonly number[]): number {
  if (!win || win.w <= 0 || win.h <= 0) return to[0] ?? 1;
  const w = lerpAxis(win.w, [TRAY_MIN.w, TRAY_USEFUL.w, TRAY_DEFAULT.w], to);
  const h = lerpAxis(win.h, [TRAY_MIN.h, TRAY_USEFUL.h, TRAY_DEFAULT.h], to);
  return Math.round(Math.min(w, h) * 100) / 100;
}

/**
 * FR-DICEX-96 (DM #343, orchestrator ruling): the tray's dice grow with the window, × 1 at the
 * min (300 × 240, today's dice), × 1.2 at the useful size (360 × 300: 48-px cells), × 1.4 at the
 * default (504 × 420: 56 px), linear between, by the tighter axis. `win` = the window's rendered
 * size (null = not measured yet → × 1).
 */
export const trayScale = (win: Box | null): number => overSizes(win, TRAY_SCALE_STEPS);

/**
 * FR-DICEX-96: the notation row (expression + constant) stays compact (28 px) up to the useful
 * size, so its room goes to a second row of dice, then grows × 1 → × 1.4 to the default.
 */
export const notationScale = (win: Box | null): number => overSizes(win, [1, 1, TRAY_SCALE_MAX]);

/** A base px size at `scale`, whole px. */
export const scaledPx = (px: number, scale: number) => Math.round(px * scale);

/** Inline font size for a base px at `scale`; none at × 1 (the class draws it). */
export const scaledFont = (px: number, scale: number) =>
  scale === 1 ? undefined : { fontSize: scaledPx(px, scale) };
