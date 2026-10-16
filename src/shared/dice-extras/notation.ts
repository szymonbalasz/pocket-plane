// Dice notation in free text (FR-DICEX-28): the only notation parser (seams S7). Pure; `DiceText`
// renders each match as a link that stages the expression in the dice tray.
import { parseExpression, toNotation } from "@shared/dice-roll-log/grammar";

export interface NotationMatch {
  /** Offsets into the text: `text.slice(start, end)` is the matched notation as written. */
  start: number;
  end: number;
  /** Canonical expression (`toNotation(parseExpression(match))`), e.g. `1d12+5`. */
  expression: string;
}

const DICE = /(\d*)[dD](\d+)(?:[kK][hHlL]\d+)?/y;
const INT = /\d+/y;
/** An operator with spaces / tabs around it (never a line break): `+`, `-`, `−` U+2212, `–` U+2013. */
const OP = /[ \t]*[+\-−–][ \t]*/y;
/** After a term (spaces allowed): `/`, `*`, `×` or `x` + digit make it arithmetic, not notation. */
const ARITH_AFTER = /[ \t]*(?:[/*×]|[xX]\d)/y;
const WORD = /[\p{L}\p{N}_]/u;

function stickyAt(re: RegExp, text: string, at: number): number {
  re.lastIndex = at;
  const m = re.exec(text);
  return m ? at + m[0].length : -1;
}

/** End of the term at `at`, or -1. The first term must be a dice term; later ones may be integers. */
function termEnd(text: string, at: number, diceOnly: boolean): number {
  const d = stickyAt(DICE, text, at);
  if (d >= 0) return d;
  return diceOnly ? -1 : stickyAt(INT, text, at);
}

/** A term may end here: no letter, digit or `_` right after it, and no `/ * × x2` after it. */
function validEnd(text: string, end: number): boolean {
  const next = text[end];
  if (next !== undefined && WORD.test(next)) return false;
  return stickyAt(ARITH_AFTER, text, end) < 0;
}

/** Normalised for the grammar: dash variants → `-`, no spaces, `dM` → `1dM`. */
const normalise = (raw: string) =>
  raw
    .replace(/[−–]/g, "-")
    .replace(/[ \t]+/g, "")
    .replace(/(^|[+-])[dD]/g, (_, op: string) => `${op}1d`);

/**
 * FR-DICEX-28: every dice notation in `text`, in order, non-overlapping. A match starts with a
 * dice term (`NdM`, `dM`, `NdMkhK`, `NdMklK`), extends greedily over `op term` (a dangling op is
 * left out) and must pass FR-DICE-01's limits, else it stays plain text.
 */
export function findNotation(text: string): NotationMatch[] {
  const out: NotationMatch[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    const digit = c >= 48 && c <= 57;
    if (!digit && c !== 100 && c !== 68) continue; // digit, d, D
    if (i > 0 && WORD.test(text[i - 1] as string)) continue;
    const first = termEnd(text, i, true);
    if (first < 0 || !validEnd(text, first)) continue;
    let end = first;
    for (;;) {
      const op = stickyAt(OP, text, end);
      if (op < 0) break;
      const next = termEnd(text, op, false);
      if (next < 0 || !validEnd(text, next)) break;
      end = next;
    }
    const parsed = parseExpression(normalise(text.slice(i, end)));
    if (parsed.ok) out.push({ start: i, end, expression: toNotation(parsed.value) });
    i = end - 1;
  }
  return out;
}

/** Text split into plain runs and matches, for rendering (`DiceText`). */
export type NotationPart = { text: string; expression?: string };

export function splitNotation(text: string): NotationPart[] {
  const parts: NotationPart[] = [];
  let at = 0;
  for (const m of findNotation(text)) {
    if (m.start > at) parts.push({ text: text.slice(at, m.start) });
    parts.push({ text: text.slice(m.start, m.end), expression: m.expression });
    at = m.end;
  }
  if (at < text.length) parts.push({ text: text.slice(at) });
  return parts;
}
