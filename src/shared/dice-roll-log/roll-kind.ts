// The `roll` log-entry kind (FR-DICE-20): "<actor> — <label or expression>: <dice> + <constants>
// = <total>" per roll; "(adv)" / "(dis)" with the dropped die struck through; natural 20 / 1
// (not on initiative, FR-DICE-29); "physical" for manual rolls. Other kinds may reuse
// `rollSegments` / `rollBreakdownSegments` for their roll parts (FR-DICE-28). Roll-hook parts
// (FR-MOD-19/20) follow the constant ("14 + 4 + 3 Bless = 21"); the DM's line names every part
// from `dmPayload`, players see "(DM)" for parts of effects they don't receive.
import { rollOfferSegments } from "@shared/effect-modifiers/combat-parts";
import { AUTO_PART_TEXT, modeLabels, modSegments, modsTotal } from "@shared/effect-modifiers/line";
import { diceTerms, parseExpression } from "./grammar";
import { defineLogKind, type LineDie, type LineSegment } from "./kind-types";
import {
  type RollCategory,
  RollEntryDmPayload,
  RollEntryPayload,
  type RollItemDmMods,
  type RollMode,
  type RollPayloadItem,
} from "./schemas";

export const ROLL_KIND = "roll";

/** A die as a line run shows it; `faces` null = unknown (a round chip). */
interface RunDie {
  faces: number | null;
  value: number | null;
  kept: boolean;
  auto?: true;
}

/** FR-DICE-35: the die's number, with its `die` (one per segment, seams S8) when it has a value. */
function dieSegment(d: RunDie): LineSegment {
  const text = String(d.value);
  if (d.value === null) return d.kept ? { text } : { text, style: "dropped" };
  const die: LineDie = { faces: d.faces, value: d.value, kept: d.kept };
  return d.kept ? { text, die } : { text, style: "dropped", die };
}

/** One group's dice: "3 + 5" between kept dice, " " next to a dropped one. */
function groupSegments(dice: readonly RunDie[], out: LineSegment[]): void {
  dice.forEach((d, i) => {
    const prev = dice[i - 1];
    if (prev) out.push({ text: prev.kept && d.kept ? " + " : " " });
    out.push(dieSegment(d));
    if (d.auto) out.push({ text: ` ${AUTO_PART_TEXT}`, style: "muted" });
  });
}

/** Dice values of one roll, grouped per dice term in notation order. */
function diceSegments(item: RollPayloadItem): LineSegment[] {
  const parsed = parseExpression(item.expression);
  const allNull = item.dice.length > 0 && item.dice.every((d) => d.value === null);
  if (allNull || !parsed.ok) {
    // Manual total of several dice (values unknown), or an unparsable stored expression: one
    // chip with the sum (round unless it is a single die's value).
    if (item.dice.length === 0) return [];
    const sum = allNull
      ? item.total - item.constant - modsTotal(item.mods)
      : item.dice.reduce((s, d) => s + (d.kept ? (d.value ?? 0) : 0), 0);
    const faces = item.dice.length === 1 ? (item.dice[0]?.faces ?? null) : null;
    return [{ text: String(sum), die: { faces, value: sum, kept: true } }];
  }
  const out: LineSegment[] = [];
  let cursor = 0;
  let first = true;
  for (const t of parsed.value) {
    if (t.kind !== "dice") continue;
    const dice = item.dice.slice(cursor, cursor + t.count);
    cursor += t.count;
    if (first) {
      if (t.sign === -1) out.push({ text: "-" });
    } else {
      out.push({ text: t.sign === -1 ? " - " : " + " });
    }
    first = false;
    const group = t.sign === -1 && dice.length > 1;
    if (group) out.push({ text: "(" });
    groupSegments(dice, out);
    if (group) out.push({ text: ")" });
  }
  return out;
}

/** Appends " + <constant>" (or the constant alone when there are no dice). */
function withConstant(out: LineSegment[], constant: number): LineSegment[] {
  if (constant !== 0 || out.length === 0) {
    const abs = Math.abs(constant);
    if (out.length === 0) out.push({ text: String(constant) });
    else out.push({ text: constant < 0 ? ` - ${abs}` : ` + ${abs}` });
  }
  return out;
}

/** "<dice> + <constants>" of one roll (no total); [] → nothing to show. */
const termSegments = (item: RollPayloadItem): LineSegment[] =>
  withConstant(diceSegments(item), item.constant);

/**
 * One roll's segments. FR-DICE-29 (#172): no natural 20 / 1 marker on an `initiative`-category
 * roll (a natural 1 has no rule meaning there). `dm` = the item's `dmPayload` names (FR-MOD-20).
 */
export function rollSegments(
  item: RollPayloadItem,
  opts: { category?: RollCategory; dm?: RollItemDmMods | null } = {},
): LineSegment[] {
  const out: LineSegment[] = [{ text: item.label ?? item.expression }];
  const mode = item.mode === "advantage" ? "adv" : item.mode === "disadvantage" ? "dis" : null;
  if (mode) {
    const why = item.modes ? `: ${modeLabels(item.modes, opts.dm?.modes)}` : "";
    out.push({ text: ` (${mode}${why})` });
  }
  out.push({ text: ": " });
  out.push(...termSegments(item));
  out.push(...modSegments(item.mods, opts.dm?.mods));
  out.push({ text: " = " }, { text: String(item.total), style: "total" });
  // FR-MOD-20 (R7): offered trigger parts, not in the total.
  out.push(...rollOfferSegments(item.offered, opts.dm?.offered));
  if (opts.category !== "initiative") {
    if (item.natural === 20) out.push({ text: " — natural 20!" });
    if (item.natural === 1) out.push({ text: " — natural 1" });
  }
  if (item.note) out.push({ text: ` — ${item.note}` });
  if (item.manual) out.push({ text: " " }, { text: "physical", style: "badge" });
  return out;
}

/** A stored roll's dice as another kind keeps them (FR-DICE-28): compact `[value, kept]` pairs. */
export interface RollBreakdown {
  expression: string;
  mode?: RollMode;
  dice: readonly (readonly [number | null, boolean])[];
  constant: number;
}

/**
 * FR-DICE-28: a DM-only dice run for other kinds' lines, e.g. "(1d6+2: 4 + 2)" or
 * "(2d20kh1+4 adv: 15 ~7~ + 4)", muted, dropped dice struck through. Dice without values (a
 * physical total of several dice) → [] (nothing to show). FR-DICE-36 (B10): each die's faces
 * come from the expression's dice terms in order ("1d8+1d6" → d8, d6); an unparsable expression
 * or a die count that doesn't match the terms → round chips (faces unknown), in stored order.
 */
export function rollBreakdownSegments(r: RollBreakdown): LineSegment[] {
  if (r.dice.length === 0 || r.dice.some(([v]) => v === null)) return [];
  const parsed = parseExpression(r.expression);
  const terms = parsed.ok ? diceTerms(parsed.value) : [];
  const faces = terms.flatMap((t) => Array.from({ length: t.count }, () => t.faces));
  const fits = parsed.ok && faces.length === r.dice.length;
  let run: LineSegment[];
  if (fits) {
    run = termSegments({
      rollId: "-",
      expression: r.expression,
      mode: r.mode ?? "normal",
      manual: false,
      dice: r.dice.map(([value, kept], i) => ({ faces: faces[i] as number, value, kept })),
      constant: r.constant,
      total: 0,
      natural: null,
      label: null,
    });
  } else {
    run = [];
    groupSegments(
      r.dice.map(([value, kept]) => ({ faces: null, value, kept })),
      run,
    );
    withConstant(run, r.constant);
  }
  const mode = r.mode === "advantage" ? " adv" : r.mode === "disadvantage" ? " dis" : "";
  const muted = (s: LineSegment): LineSegment =>
    s.style === "dropped" ? s : { ...s, style: "muted" };
  return [
    { text: ` (${r.expression}${mode}: `, style: "muted" },
    ...run.map(muted),
    { text: ")", style: "muted" },
  ];
}

export const rollKind = defineLogKind({
  kind: ROLL_KIND,
  payload: RollEntryPayload,
  dmPayload: RollEntryDmPayload,
  formatLine({ actorName, payload, dmPayload, category }) {
    const out: LineSegment[] = [{ text: actorName, style: "actor" }, { text: " — " }];
    payload.forEach((item, i) => {
      if (i > 0) out.push({ text: "; " });
      out.push(...rollSegments(item, { category, dm: dmPayload?.items[i] }));
    });
    return out;
  },
});
