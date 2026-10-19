// Roll-hook parts in log lines (FR-MOD-20): one shared formatter for the `roll` kind and
// combat's lines. "+ 3 Bless" / "− 2 Bane"; a part whose effect players don't receive reads
// "(DM)" unless the DM's names are given; "(rolled for you)" on server-rolled dice of a
// physical roll (FR-MOD-18). Mode hints: "adv: Rage". FR-MOD-57 (sprint 4): a part's per-die
// values follow it as D5's die segments (one per die, `label` = the part's name; seams S8 /
// rulings B5, B9), built from whichever payload the line was given.
import { constantOf, parseExpression } from "@shared/dice-roll-log/grammar";
import type { LineSegment } from "@shared/dice-roll-log/kind-types";
import { rollBreakdownSegments } from "@shared/dice-roll-log/roll-kind";
import type { DmModPart, RollModPart } from "@shared/dice-roll-log/schemas";

export const DM_PART_LABEL = "(DM)";
export const AUTO_PART_TEXT = "(rolled for you)";

/** Sum of the parts' values (the part of a payload `total` that is not the base roll). */
export const modsTotal = (mods: readonly Pick<RollModPart, "value">[] | undefined): number =>
  (mods ?? []).reduce((s, m) => s + m.value, 0);

/** A part's roll as a payload carries it (FR-MOD-19 `dice`, FR-MOD-57). */
export interface PartRoll {
  expression?: string;
  dice?: readonly number[];
}

/** FR-MOD-57: how a part's dice show; `offered` → `offered: true` (dashed). */
export interface PartDiceView {
  /** The part's number ("3"): its die chip when one die is the whole value ("+ ⬡3 Bless"). */
  value: LineSegment;
  /** Else, after the part's name: " (1d6+2: 4 + 2)" (muted, one chip per die); [] = nothing. */
  after: LineSegment[];
}

/**
 * FR-MOD-57 (seams S8 / rulings B5): a part's dice as D5's die segments, `label` = the part's
 * name. A part rolled as one die with no constant whose value is that die (Bless `1d4` → 3) shows
 * the chip in place of its number, so its text stays the same; any other part (Divine Fury
 * `1d6+2`, a halved or DM-set value) keeps its number and shows the run after its name (D's
 * `rollBreakdownSegments`: faces from the expression, round chips when they don't fit).
 */
export function partDiceView(
  part: PartRoll,
  value: number,
  label: string,
  offered = false,
): PartDiceView {
  const plain: LineSegment = { text: String(Math.abs(value)) };
  const { expression, dice } = part;
  if (!expression || !dice?.length) return { value: plain, after: [] };
  const labelled = (s: LineSegment): LineSegment =>
    s.die ? { ...s, die: { ...s.die, label, ...(offered ? { offered: true as const } : {}) } } : s;
  const parsed = parseExpression(expression);
  const terms = parsed.ok ? parsed.value : [];
  const [only] = terms;
  if (
    terms.length === 1 &&
    only?.kind === "dice" &&
    only.count === 1 &&
    dice.length === 1 &&
    dice[0] === Math.abs(value)
  ) {
    return {
      value: labelled({ ...plain, die: { faces: only.faces, value: dice[0], kept: true } }),
      after: [],
    };
  }
  const after = rollBreakdownSegments({
    expression,
    dice: dice.map((v) => [v, true] as const),
    constant: parsed.ok ? constantOf(parsed.value) : 0,
  });
  return { value: plain, after: after.map(labelled) };
}

/**
 * Segments after the base dice and constant; `dm` = `dmPayload` names, same index. FR-MOD-57: a
 * part with per-die values shows its dice (`partDiceView`). A rolled part's (`expression`) value
 * is `numeric`, so a held line blanks it (FR-DICE-40).
 */
export function modSegments(
  mods: readonly RollModPart[] | undefined,
  dm?: readonly DmModPart[] | null,
): LineSegment[] {
  return (mods ?? []).flatMap((m, i) => {
    const named = dm?.[i]?.label ?? m.label;
    const label = named ?? DM_PART_LABEL;
    // A part players read as "(DM)" shows its value only (rulings B4).
    const dice = partDiceView(named === null ? {} : m, m.value, label);
    const value = m.expression ? { ...dice.value, numeric: true as const } : dice.value;
    const out: LineSegment[] = [
      { text: m.value < 0 ? " − " : " + " },
      value,
      { text: ` ${label}`, style: "muted" },
    ];
    if (m.auto) out.push({ text: ` ${AUTO_PART_TEXT}`, style: "muted" });
    out.push(...dice.after);
    return out;
  });
}

/** "Rage, (DM)": mode-hint labels for "(adv: …)"; `dm` = `dmPayload` names, same index. */
export function modeLabels(
  modes: readonly (string | null)[] | undefined,
  dm?: readonly DmModPart[] | null,
): string {
  return (modes ?? []).map((l, i) => dm?.[i]?.label ?? l ?? DM_PART_LABEL).join(", ");
}
