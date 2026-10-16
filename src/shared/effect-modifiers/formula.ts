// Rule-trigger formulas (FR-MOD-34, MOD §8.5): a hand-rolled parser + evaluator, pure, no
// dependency (OQ-MOD-21, #151). Whitelist by construction: names are matched against fixed
// lists only (never used as property keys), there is no property access and no eval. Values are
// exact rationals (`/` is exact; whatever is still fractional at the end rounds down, 5e).
//
// Parsed at save (owner-independent errors, with 1-based positions); evaluated against an owner
// (FR-MOD-35) to an FR-DICE-01 expression such as "2d6+1d8+3".
import type { Ability } from "@shared/entities/schemas";

export const FORMULA_MAX_CHARS = 60;
export const FORMULA_MAX_TOKENS = 40;
export const FORMULA_MAX_DICE_TERMS = 3;
/** Σ dice counts after evaluation, before crit doubling (review R3). */
export const FORMULA_MAX_DICE = 25;
/** After crit doubling: FR-DICE-01's limit. */
export const FORMULA_MAX_DICE_CRIT = 50;
/** Each dice term's count is clamped to 0–20 (0 drops the term). */
export const FORMULA_MAX_TERM_DICE = 20;
/** The evaluated constant is clamped to −99…99. */
export const FORMULA_MAX_CONSTANT = 99;
export const DIE_SIZES = [4, 6, 8, 10, 12] as const;
export const CLASS_NAME_MAX = 30;
export const STEPS_MAX = 4;

export const FORMULA_VARS = [
  "level",
  "prof",
  "cr",
  "str",
  "dex",
  "con",
  "int",
  "wis",
  "cha",
] as const;
export type FormulaVar = (typeof FORMULA_VARS)[number];
export const FORMULA_FUNCS = ["floor", "ceil", "min", "max", "steps", "level"] as const;
type FormulaFunc = (typeof FORMULA_FUNCS)[number];

const isVar = (s: string): s is FormulaVar => (FORMULA_VARS as readonly string[]).includes(s);
const isFunc = (s: string): s is FormulaFunc => (FORMULA_FUNCS as readonly string[]).includes(s);

/** `message` reads "Unknown name ‘foo’ at 7"; `pos` (1-based) lets an editor place a caret. */
export interface FormulaError {
  message: string;
  pos: number | null;
}
export type FormulaResult<T> = { ok: true; value: T } | { ok: false; error: FormulaError };

/** FR-MOD-35. Missing values count as 0; `cr` is rounded down. */
export interface FormulaOwner {
  /** Σ class levels (a definition: 0). */
  level?: number;
  /** `level(<class>)`: case-insensitive name match, summed. The caller maps a legacy `className`. */
  classes?: readonly { name: string; level: number }[];
  prof?: number;
  cr?: number;
  /** Ability modifiers. */
  abilities?: Partial<Readonly<Record<Ability, number>>>;
}

type Expr =
  | { k: "num"; v: bigint }
  | { k: "var"; name: FormulaVar }
  | { k: "level"; cls: string }
  | { k: "neg"; e: Expr }
  | { k: "add"; sign: 1 | -1; a: Expr; b: Expr }
  | { k: "mul"; a: Expr; b: Expr }
  | { k: "div"; a: Expr; d: bigint }
  | { k: "floor" | "ceil"; e: Expr }
  | { k: "min" | "max"; a: Expr; b: Expr }
  | { k: "steps"; e: Expr; ts: bigint[] };

type FormulaTerm =
  | { kind: "dice"; sign: 1 | -1; count: Expr; size: Expr; sizePos: number }
  | { kind: "expr"; sign: 1 | -1; e: Expr };

/** A parsed formula; evaluate it with `evaluateFormula`. */
export interface Formula {
  readonly source: string;
  readonly terms: readonly FormulaTerm[];
}

export interface FormulaDice {
  sign: 1 | -1;
  count: number;
  size: number;
}

export interface FormulaValue {
  /** Dice terms in formula order, count ≥ 1 (crit-doubled when asked). */
  dice: FormulaDice[];
  constant: number;
  /** Σ counts (after crit doubling). */
  diceCount: number;
  /** FR-DICE-01 expression ("1d6+2"); null when it evaluates to 0 (offers / adds nothing). */
  expression: string | null;
}

// ---------------------------------------------------------------------------------------------
// Tokens

type Tok =
  | { t: "int"; v: bigint; pos: number }
  | { t: "name"; v: string; pos: number }
  | { t: "class"; v: string; pos: number }
  | { t: "d"; pos: number }
  | { t: "op"; v: "+" | "-" | "*" | "/" | "(" | ")" | ","; pos: number };

class FormulaFail extends Error {
  constructor(
    readonly msg: string,
    readonly at: number | null,
  ) {
    super(msg);
  }
}

function fail(msg: string, pos: number | null = null): never {
  throw new FormulaFail(pos === null ? msg : `${msg} at ${pos}`, pos);
}

const OPS = new Set(["+", "-", "*", "/", "(", ")", ","]);
const CLASS_RE = /^[a-z][a-z -]*$/;

function tokenize(src: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src.charAt(i);
    const pos = i + 1;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9]/.test(src.charAt(j))) j++;
      toks.push({ t: "int", v: BigInt(src.slice(i, j)), pos });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      // The dice operator: any `d` after a number or `)` (no implicit products, so nothing else
      // fits there), or a bare `d6`.
      const prev = toks[toks.length - 1];
      const afterValue = prev?.t === "int" || (prev?.t === "op" && prev.v === ")");
      if ((c === "d" || c === "D") && (afterValue || /^d[0-9]*(?![A-Za-z_])/i.test(src.slice(i)))) {
        toks.push({ t: "d", pos });
        i++;
        continue;
      }
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src.charAt(j))) j++;
      const word = src.slice(i, j).toLowerCase();
      i = j;
      toks.push({ t: "name", v: word, pos });
      // `level(<class>)`: the class name is free text (letters, spaces, hyphens).
      if (word === "level") {
        let k = i;
        while (k < src.length && /\s/.test(src.charAt(k))) k++;
        if (src.charAt(k) === "(") {
          const close = src.indexOf(")", k + 1);
          if (close < 0) fail("Expected ‘)’", k + 1);
          const raw = src.slice(k + 1, close);
          const name = raw.trim().toLowerCase();
          const at = k + 2 + (raw.length - raw.trimStart().length);
          if (name === "" || name.length > CLASS_NAME_MAX || !CLASS_RE.test(name)) {
            fail(`Class name: letters, spaces and hyphens, at most ${CLASS_NAME_MAX}`, at);
          }
          toks.push({ t: "op", v: "(", pos: k + 1 });
          toks.push({ t: "class", v: name.replace(/\s+/g, " "), pos: at });
          toks.push({ t: "op", v: ")", pos: close + 1 });
          i = close + 1;
        }
      }
      continue;
    }
    if (OPS.has(c)) {
      toks.push({ t: "op", v: c as "+" | "-" | "*" | "/" | "(" | ")" | ",", pos });
      i++;
      continue;
    }
    fail(`Unexpected ‘${c}’`, pos);
  }
  return toks;
}

// ---------------------------------------------------------------------------------------------
// Parser

class Parser {
  private i = 0;
  /** > 0 while parsing a dice term's count or size. */
  private inDice = 0;

  constructor(
    private readonly toks: Tok[],
    private readonly end: number,
  ) {}

  private peek(o = 0): Tok | undefined {
    return this.toks[this.i + o];
  }
  private here(): number {
    return this.peek()?.pos ?? this.end;
  }
  private isOp(v: string, o = 0): boolean {
    const t = this.peek(o);
    return t?.t === "op" && t.v === v;
  }
  private expectOp(v: ")" | "(" | ","): void {
    if (!this.isOp(v)) this.unexpected(`Expected ‘${v}’`);
    this.i++;
  }
  private unexpected(expected?: string): never {
    const t = this.peek();
    if (!t) return fail(expected ? `${expected} at the end` : "Unexpected end");
    if (t.t === "d") return this.diceMisplaced(t.pos);
    if (expected) return fail(expected, t.pos);
    const text = t.t === "op" ? t.v : t.t === "int" ? t.v.toString() : t.v;
    return fail(`Unexpected ‘${text}’`, t.pos);
  }
  private diceMisplaced(pos: number): never {
    return fail(this.inDice ? "No dice inside dice" : "Dice only as a top-level addend", pos);
  }

  formula(): FormulaTerm[] {
    const terms: FormulaTerm[] = [this.term(1)];
    while (this.peek()) {
      if (this.isOp("+") || this.isOp("-")) {
        const sign = this.isOp("+") ? 1 : -1;
        this.i++;
        terms.push(this.term(sign));
        continue;
      }
      const last = terms[terms.length - 1];
      if (last?.kind === "dice" && (this.isOp("*") || this.isOp("/"))) {
        this.diceMisplaced(this.here());
      }
      this.unexpected("Expected + or -");
    }
    return terms;
  }

  /** Index just past the `)` matching the `(` at token `from`, or -1. */
  private closing(from: number): number {
    let depth = 0;
    for (let k = from; k < this.toks.length; k++) {
      const t = this.toks[k];
      if (t?.t !== "op") continue;
      if (t.v === "(") depth++;
      if (t.v === ")" && --depth === 0) return k + 1;
    }
    return -1;
  }

  private term(sign: 1 | -1): FormulaTerm {
    const t = this.peek();
    const diceAt =
      t?.t === "int" ? this.i + 1 : t?.t === "op" && t.v === "(" ? this.closing(this.i) : -1;
    if (diceAt >= 0 && this.toks[diceAt]?.t === "d") return this.dice(sign);
    if (t?.t === "d") fail("Dice need a count, like 1d6", t.pos);
    return { kind: "expr", sign, e: this.product() };
  }

  private dice(sign: 1 | -1): FormulaTerm {
    this.inDice++;
    let count: Expr;
    const t = this.peek();
    if (t?.t === "int") {
      count = { k: "num", v: t.v };
      this.i++;
    } else {
      this.i++; // "("
      count = this.expr();
      this.expectOp(")");
    }
    this.i++; // "d"
    const s = this.peek();
    const sizePos = this.here();
    let size: Expr;
    if (s?.t === "int") {
      size = { k: "num", v: s.v };
      this.i++;
    } else if (s?.t === "op" && s.v === "(") {
      this.i++;
      size = this.expr();
      this.expectOp(")");
    } else {
      return fail("Die size: 4, 6, 8, 10, 12 or a (formula)", sizePos);
    }
    this.inDice--;
    if (this.peek()?.t === "d") this.diceMisplaced(this.here());
    // A constant size is checked now, an owner-dependent one at evaluation.
    if (isConstant(size)) checkSize(evalExpr(size, {}), sizePos);
    return { kind: "dice", sign, count, size, sizePos };
  }

  private expr(): Expr {
    let a = this.product();
    while (this.isOp("+") || this.isOp("-")) {
      const sign = this.isOp("+") ? 1 : -1;
      this.i++;
      a = { k: "add", sign, a, b: this.product() };
    }
    return a;
  }

  private product(): Expr {
    let a = this.unary();
    for (;;) {
      if (this.isOp("*")) {
        this.i++;
        a = { k: "mul", a, b: this.unary() };
      } else if (this.isOp("/")) {
        this.i++;
        const d = this.peek();
        if (d?.t !== "int") return fail("Divide by a whole number", this.here());
        if (d.v === 0n) return fail("Divide by 0", d.pos);
        this.i++;
        a = { k: "div", a, d: d.v };
      } else if (this.peek()?.t === "d") {
        return this.diceMisplaced(this.here());
      } else {
        return a;
      }
    }
  }

  private unary(): Expr {
    if (this.isOp("-")) {
      this.i++;
      return { k: "neg", e: this.unary() };
    }
    return this.atom();
  }

  private atom(): Expr {
    const t = this.peek();
    if (!t) return fail("Unexpected end");
    if (t.t === "int") {
      this.i++;
      return { k: "num", v: t.v };
    }
    if (t.t === "op" && t.v === "(") {
      this.i++;
      const e = this.expr();
      this.expectOp(")");
      return e;
    }
    if (t.t === "name") {
      this.i++;
      if (t.v === "level" && this.isOp("(")) {
        this.i++;
        const c = this.peek();
        if (c?.t !== "class") return fail("Expected a class name", this.here());
        this.i++;
        this.expectOp(")");
        return { k: "level", cls: c.v };
      }
      if (isVar(t.v)) return { k: "var", name: t.v };
      if (isFunc(t.v) && t.v !== "level") return this.call(t.v, t.pos);
      return fail(`Unknown name ‘${t.v}’`, t.pos);
    }
    return this.unexpected();
  }

  private call(fn: Exclude<FormulaFunc, "level">, pos: number): Expr {
    if (!this.isOp("(")) return fail(`Expected ‘(’ after ${fn}`, this.here());
    this.i++;
    const e = this.expr();
    let out: Expr;
    if (fn === "floor" || fn === "ceil") {
      out = { k: fn, e };
    } else if (fn === "min" || fn === "max") {
      this.expectOp(",");
      out = { k: fn, a: e, b: this.expr() };
    } else {
      const ts: bigint[] = [];
      while (this.isOp(",")) {
        this.i++;
        const n = this.peek();
        if (n?.t !== "int") return fail("steps thresholds are whole numbers", this.here());
        ts.push(n.v);
        this.i++;
      }
      if (ts.length < 1 || ts.length > STEPS_MAX) {
        fail(`steps takes 1–${STEPS_MAX} thresholds`, pos);
      }
      out = { k: "steps", e, ts };
    }
    this.expectOp(")");
    return out;
  }
}

/**
 * FR-MOD-34: parse at save. Rejects unknown names, bad literal / constant die sizes, dice inside a
 * product, call or dice, `/0`, division by anything but a whole number, and the caps (60 chars,
 * 40 tokens, 3 dice terms). Owner-dependent checks (dice cap, die-size formulas) are
 * `evaluateFormula`'s.
 */
export function parseFormula(source: string): FormulaResult<Formula> {
  try {
    if (source.trim() === "") fail("Enter a formula");
    if (source.length > FORMULA_MAX_CHARS) {
      fail(`Too long: ${source.length} > ${FORMULA_MAX_CHARS} characters`);
    }
    const toks = tokenize(source);
    if (toks.length > FORMULA_MAX_TOKENS) {
      fail(`Too many parts: ${toks.length} > ${FORMULA_MAX_TOKENS}`);
    }
    const terms = new Parser(toks, source.length + 1).formula();
    const dice = terms.filter((t) => t.kind === "dice").length;
    if (dice > FORMULA_MAX_DICE_TERMS) {
      fail(`Too many dice terms: ${dice} > ${FORMULA_MAX_DICE_TERMS}`);
    }
    return { ok: true, value: { source, terms } };
  } catch (e) {
    return failed(e);
  }
}

// ---------------------------------------------------------------------------------------------
// Evaluation (exact rationals, d > 0)

type Q = { n: bigint; d: bigint };

const q = (n: bigint, d = 1n): Q => {
  if (d < 0n) return q(-n, -d);
  const g = gcd(n < 0n ? -n : n, d);
  return g > 1n ? { n: n / g, d: d / g } : { n, d };
};
const gcd = (a: bigint, b: bigint): bigint => (b === 0n ? (a === 0n ? 1n : a) : gcd(b, a % b));
const floorQ = (x: Q): bigint => {
  const t = x.n / x.d;
  return x.n % x.d !== 0n && x.n < 0n ? t - 1n : t;
};
const cmpQ = (a: Q, b: Q): number => {
  const l = a.n * b.d;
  const r = b.n * a.d;
  return l < r ? -1 : l > r ? 1 : 0;
};
const intOf = (v: number | undefined): bigint =>
  v !== undefined && Number.isFinite(v) ? BigInt(Math.floor(v)) : 0n;

function isConstant(e: Expr): boolean {
  switch (e.k) {
    case "num":
      return true;
    case "var":
    case "level":
      return false;
    case "neg":
    case "floor":
    case "ceil":
    case "steps":
      return isConstant(e.e);
    case "div":
      return isConstant(e.a);
    case "add":
    case "mul":
    case "min":
    case "max":
      return isConstant(e.a) && isConstant(e.b);
  }
}

function varValue(name: FormulaVar, o: FormulaOwner): bigint {
  switch (name) {
    case "level":
      return intOf(o.level);
    case "prof":
      return intOf(o.prof);
    case "cr":
      return intOf(o.cr);
    default:
      return intOf(o.abilities?.[name]);
  }
}

function classLevel(cls: string, o: FormulaOwner): bigint {
  let sum = 0n;
  for (const c of o.classes ?? []) {
    if (c.name.trim().replace(/\s+/g, " ").toLowerCase() === cls) sum += intOf(c.level);
  }
  return sum;
}

function evalExpr(e: Expr, o: FormulaOwner): Q {
  switch (e.k) {
    case "num":
      return q(e.v);
    case "var":
      return q(varValue(e.name, o));
    case "level":
      return q(classLevel(e.cls, o));
    case "neg": {
      const x = evalExpr(e.e, o);
      return q(-x.n, x.d);
    }
    case "add": {
      const a = evalExpr(e.a, o);
      const b = evalExpr(e.b, o);
      return q(a.n * b.d + BigInt(e.sign) * b.n * a.d, a.d * b.d);
    }
    case "mul": {
      const a = evalExpr(e.a, o);
      const b = evalExpr(e.b, o);
      return q(a.n * b.n, a.d * b.d);
    }
    case "div": {
      const a = evalExpr(e.a, o);
      return q(a.n, a.d * e.d);
    }
    case "floor":
      return q(floorQ(evalExpr(e.e, o)));
    case "ceil": {
      const x = evalExpr(e.e, o);
      return q(-floorQ(q(-x.n, x.d)));
    }
    case "min":
    case "max": {
      const a = evalExpr(e.a, o);
      const b = evalExpr(e.b, o);
      const c = cmpQ(a, b);
      return (e.k === "min" ? c <= 0 : c >= 0) ? a : b;
    }
    case "steps": {
      const x = evalExpr(e.e, o);
      return q(BigInt(e.ts.filter((t) => cmpQ(q(t), x) <= 0).length));
    }
  }
}

const clamp = (v: bigint, lo: number, hi: number): number =>
  v < BigInt(lo) ? lo : v > BigInt(hi) ? hi : Number(v);

function checkSize(x: Q, pos: number): number {
  const v = floorQ(x);
  const size = clamp(v, -1000, 1000);
  if (!(DIE_SIZES as readonly number[]).includes(size)) fail(`Die size ${v}`, pos);
  return size;
}

/**
 * FR-MOD-34 / -35: evaluate against an owner. Counts are clamped 0–20 (0 drops the term), the
 * constant −99…99; Σ counts > 25 or a die-size formula outside 4/6/8/10/12 → error (the save
 * rejects it; at fire time the caller skips the trigger with a DM note). `crit` doubles each
 * count after the cap check (≤ 50).
 */
export function evaluateFormula(
  f: Formula,
  owner: FormulaOwner,
  opts: { crit?: boolean } = {},
): FormulaResult<FormulaValue> {
  try {
    const dice: FormulaDice[] = [];
    let constant = q(0n);
    for (const t of f.terms) {
      if (t.kind === "expr") {
        const x = evalExpr(t.e, owner);
        constant = q(constant.n * x.d + BigInt(t.sign) * x.n * constant.d, constant.d * x.d);
        continue;
      }
      const size = checkSize(evalExpr(t.size, owner), t.sizePos);
      const count = clamp(floorQ(evalExpr(t.count, owner)), 0, FORMULA_MAX_TERM_DICE);
      if (count > 0) dice.push({ sign: t.sign, count, size });
    }
    const total = dice.reduce((s, d) => s + d.count, 0);
    if (total > FORMULA_MAX_DICE) fail(`Too many dice: ${total} > ${FORMULA_MAX_DICE}`);
    if (opts.crit) for (const d of dice) d.count *= 2;
    const c = clamp(floorQ(constant), -FORMULA_MAX_CONSTANT, FORMULA_MAX_CONSTANT);
    return {
      ok: true,
      value: {
        dice,
        constant: c,
        diceCount: dice.reduce((s, d) => s + d.count, 0),
        expression: toExpression(dice, c),
      },
    };
  } catch (e) {
    return failed(e);
  }
}

/** Parse + evaluate: the save-time check against the owner, and the fire-time value. */
export function formulaValue(
  source: string,
  owner: FormulaOwner,
  opts: { crit?: boolean } = {},
): FormulaResult<FormulaValue> {
  const p = parseFormula(source);
  return p.ok ? evaluateFormula(p.value, owner, opts) : p;
}

/**
 * FR-DICE-01 text: dice in formula order, then the constant. FR-DICE-01 can't start with "-", so
 * the first positive term leads ("2-1d4"); all negative → "0-1d4".
 */
function toExpression(dice: readonly FormulaDice[], constant: number): string | null {
  const parts: { sign: 1 | -1; text: string }[] = dice.map((d) => ({
    sign: d.sign,
    text: `${d.count}d${d.size}`,
  }));
  if (constant !== 0) parts.push({ sign: constant > 0 ? 1 : -1, text: `${Math.abs(constant)}` });
  if (parts.length === 0) return null;
  const lead = parts.findIndex((p) => p.sign === 1);
  if (lead < 0) parts.unshift({ sign: 1, text: "0" });
  else if (lead > 0) parts.unshift(...parts.splice(lead, 1));
  return parts.map((p, i) => (p.sign === -1 ? "-" : i === 0 ? "" : "+") + p.text).join("");
}

function failed(e: unknown): { ok: false; error: FormulaError } {
  if (e instanceof FormulaFail) return { ok: false, error: { message: e.msg, pos: e.at } };
  throw e;
}
