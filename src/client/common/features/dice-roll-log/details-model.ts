// FR-DICE-107: what the details window shows per roll, pure, from the entry this client holds: a
// `roll` line's items, a `cbt.attack` line's to-hit and damage. A player's entry has no `dmPayload`,
// so the DM's names and dice simply aren't there (FR-DICE-15, -28). The hero is one equation, and
// it is shown only when it adds up (`settle`): a total the DM set or halved stands alone.
import {
  AttackLogDmPayload,
  AttackLogPayload,
  attackOutcomeText,
  publicRuling,
} from "@shared/combat-tracker/log-kinds";
import { LOG_KIND_ATTACK } from "@shared/combat-tracker/schemas";
import { baseExpression } from "@shared/dice-roll-log/grammar";
import type { LineSegment } from "@shared/dice-roll-log/kind-types";
import {
  diceSegments,
  itemsAfterActor,
  ROLL_KIND,
  type RollBreakdown,
  rollBreakdownSegments,
} from "@shared/dice-roll-log/roll-kind";
import { type RollOutcome, resultOutcome, rowAction } from "@shared/dice-roll-log/row";
import {
  type GameLogEntryView,
  RollEntryDmPayload,
  RollEntryPayload,
  type RollMode,
  type RollModPart,
  type RollPayloadItem,
} from "@shared/dice-roll-log/schemas";
import { modeLabels } from "@shared/effect-modifiers/line";

export interface DetailLine {
  key: string;
  /** Signed value as read: "+ 2", "- 1". */
  value: string;
  label: string;
  /** A rolled number: "…" until the landing (FR-DICE-40). */
  rolled: boolean;
}

/** Next to the total, in the outcome colours. */
export interface DetailOutcome {
  text: string;
  tone: "good" | "bad" | "plain";
}

export interface DetailTerm {
  value: number;
  /** A rolled number: "…" until the landing (FR-DICE-40). The flat bonus isn't. */
  rolled: boolean;
}

export interface DetailSection {
  key: string;
  /** The roll record, for `data-record-id`; a combat line's section has none. */
  rollId: string | null;
  /** "To hit", "Damage": shown only when the line has several rolls. */
  heading: string;
  /** The expression as typed (FR-DICE-04 undone), or null (a player's view of a combat line). */
  expression: string | null;
  /** "Advantage: Bless"; null = normal. Withheld until the landing, as the line's "(adv)". */
  mode: string | null;
  /** Purpose, damage type, "Edited", "Set by DM", "Rolled 13": facts the roll doesn't wait for. */
  tags: string[];
  /** The dice and the signs between them; [] = no equation, the total stands alone. */
  dice: LineSegment[];
  /** What the equation adds to the dice, in order: the flat bonus, then the named parts' sum. */
  terms: DetailTerm[];
  /** Named modifiers, or a total's parts when there is no equation. */
  lines: DetailLine[];
  /** Offered trigger parts, not in the total (FR-MOD-19). */
  offered: DetailLine[];
  total: number;
  outcome: RollOutcome;
  /** A to-hit that hit: the kit's green number, as on the row (BL-141). */
  hit: boolean;
  outcomes: DetailOutcome[];
}

const signed = (n: number) => (n < 0 ? `- ${Math.abs(n)}` : `+ ${n}`);
/** The equation's own text for a term. */
export const termText = signed;

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Kept dice summed, a die after a "-" (or inside its group) subtracted. */
function diceSum(dice: readonly LineSegment[]): number {
  let sum = 0;
  let sign = 1;
  let group = false;
  for (const s of dice) {
    if (s.die) {
      if (s.die.kept) sum += sign * s.die.value;
    } else if (s.text.includes("(")) group = true;
    else if (s.text.includes(")")) group = false;
    else if (!group && s.text.includes("-")) sign = -1;
    else if (!group && s.text.includes("+")) sign = 1;
  }
  return sum;
}

/**
 * The dice and the terms, only when they add up to the total. Terms at 0 are left out; dice are
 * shown side by side, so only a subtraction's sign and group remain between them.
 */
function settle(
  dice: readonly LineSegment[],
  flat: number,
  named: number,
  total: number,
): Pick<DetailSection, "dice" | "terms"> {
  if (!dice.some((s) => s.die) || diceSum(dice) + flat + named !== total) {
    return { dice: [], terms: [] };
  }
  return {
    dice: dice.filter((s) => s.die || /[-()]/.test(s.text)),
    terms: [
      { value: flat, rolled: false },
      { value: named, rolled: true },
    ].filter((t) => t.value !== 0),
  };
}

const sumOf = (xs: readonly { value: number }[]) => xs.reduce((n, x) => n + x.value, 0);

/** A roll-hook part: the DM's name, else the player-safe label, else "(DM)" (FR-MOD-20). */
function modLines(
  mods: readonly RollModPart[] | undefined,
  names: readonly { label: string }[] | undefined,
): DetailLine[] {
  return (mods ?? []).map((p, i) => {
    const name = names?.[i]?.label ?? p.label ?? "(DM)";
    return {
      key: `mod-${i}`,
      value: `${signed(p.value)}${p.type ? ` ${p.type}` : ""}`,
      label: p.expression ? `${name} (${p.expression})` : name,
      rolled: true,
    };
  });
}

const modeText = (mode: RollMode, why = "") =>
  mode === "normal" ? null : `${capital(mode)}${why}`;

/** A note's tone: a save kept or lost reads as the card's outcome does. */
const noteTone = (note: string): DetailOutcome["tone"] =>
  /^(fail|lost)/i.test(note) ? "bad" : /^(success|kept)/i.test(note) ? "good" : "plain";

function headingOf(item: RollPayloadItem, i: number, category: GameLogEntryView["category"]) {
  const type = item.part?.type ? ` (${item.part.type})` : "";
  if (item.purpose === "attack") return "To hit";
  if (item.purpose === "damage") return `Damage${type}`;
  if (category === "attack") return i === 0 ? "To hit" : `Damage${type}`;
  return item.label ?? baseExpression(item.expression, item.mode);
}

function rollSections(e: GameLogEntryView): DetailSection[] {
  const parsed = RollEntryPayload.safeParse(e.payload);
  if (!parsed.success) return [];
  const dm = RollEntryDmPayload.safeParse(e.dmPayload ?? null).data;
  return itemsAfterActor(parsed.data, e.actorName).map((item, i) => {
    const names = dm?.items[i];
    const natural = e.category === "initiative" ? null : item.natural;
    // A purpose or type the label already says isn't said again ("Dagger damage (piercing)").
    const said = (word: string) => item.label?.toLowerCase().includes(word) === true;
    const facts = [item.purpose, item.part?.type].flatMap((w) => (w && !said(w) ? [w] : []));
    const tags = [
      ...facts.map(capital),
      ...(item.edited ? ["Edited"] : []),
      ...(item.replaces ? [`Reroll, was ${item.replaces.total}`] : []),
    ];
    const outcomes: DetailOutcome[] = [];
    if (natural === 20) outcomes.push({ text: "Natural 20!", tone: "good" });
    if (natural === 1) outcomes.push({ text: "Natural 1", tone: "bad" });
    if (item.note) outcomes.push({ text: capital(item.note), tone: noteTone(item.note) });
    const why = item.modes ? `: ${modeLabels(item.modes, names?.modes)}` : "";
    return {
      key: item.rollId,
      rollId: item.rollId,
      heading: headingOf(item, i, e.category),
      expression: baseExpression(item.expression, item.mode),
      mode: modeText(item.mode, why),
      tags,
      ...settle(diceSegments(item), item.constant, sumOf(item.mods ?? []), item.total),
      lines: modLines(item.mods, names?.mods),
      offered: (item.offered ?? []).map((o, j) => ({
        key: `offered-${j}`,
        value: `${o.expression}: ${o.value}${o.type ? ` ${o.type}` : ""}`,
        label: names?.offered?.[j]?.label ?? o.label ?? "(DM)",
        rolled: true,
      })),
      total: item.total,
      outcome: resultOutcome(item, e.category, e.category === "attack" && i > 0),
      hit: false,
      outcomes,
    };
  });
}

/** The DM's stored dice of a combat roll, chips only (the line's run also holds its text). */
const breakdownChips = (r: RollBreakdown) => rollBreakdownSegments(r).filter((s) => s.die);

const setTags = (rolled: number | null | undefined) => [
  "Set by DM",
  ...(rolled === null || rolled === undefined ? [] : [`Rolled ${rolled}`]),
];

/**
 * The to-hit. A total the DM set has no breakdown: the DM reads "Set by DM" and what was rolled; a
 * player reads what their line says, the total alone. Players' dice are a sum (FR-CBT-24), one chip.
 */
function toHitSection(p: AttackLogPayload, dm: AttackLogDmPayload | undefined): DetailSection {
  const t = p.toHit as NonNullable<AttackLogPayload["toHit"]>;
  const stored = dm?.rolls?.toHit;
  const set = t.dice === null || dm?.overrides.toHit === true;
  // FR-CBT-114: a companion's face is the DM's only (`dm.toHitNatural`).
  const face = dm?.toHitNatural !== undefined ? dm.toHitNatural : t.natural;
  const dice: LineSegment[] = stored
    ? breakdownChips(stored)
    : t.dice === null
      ? []
      : [
          {
            text: String(t.dice),
            die: { faces: face === null ? null : 20, value: t.dice, kept: true },
          },
        ];
  const ruled = dm?.overrides.hit === true || publicRuling(face, p.hit);
  const outcomes: DetailOutcome[] = [];
  if (face === 20) outcomes.push({ text: "Natural 20", tone: "good" });
  if (face === 1) outcomes.push({ text: "Natural 1", tone: "bad" });
  outcomes.push({
    text: capital(attackOutcomeText(p.hit, p.crit, ruled, !!dm)),
    tone: p.hit ? "good" : "bad",
  });
  return {
    key: "hit",
    rollId: null,
    heading: "To hit",
    expression: stored ? baseExpression(stored.expression, stored.mode) : null,
    mode: stored ? modeText(stored.mode) : null,
    tags: dm && set ? setTags(dm.toHitRolled) : [],
    ...(set ? { dice: [], terms: [] } : settle(dice, t.constant, sumOf(t.mods ?? []), t.total)),
    lines: set ? [] : modLines(t.mods, dm?.mods?.toHit),
    offered: [],
    total: t.total,
    outcome: !p.hit ? "fumble" : p.crit ? "crit" : "plain",
    hit: p.hit && !p.crit,
    outcomes,
  };
}

/**
 * The damage: the DM's dice when they add up to the line's number; else, and for players, the
 * number with its parts as the line tells them, whose values do add up (`weapon` = the rest).
 */
function damageSection(p: AttackLogPayload, dm: AttackLogDmPayload | undefined): DetailSection {
  const stored = dm?.rolls?.damage;
  const extra = dm?.rolls?.extra ?? [];
  const parts = (p.parts ?? []).map((x, i) => ({
    key: `trigger-${i}`,
    value: `${signed(x.value)}${x.type ? ` ${x.type}` : ""}`,
    label: dm?.parts?.[i]?.label ?? x.label ?? "(DM)",
    rolled: true,
  }));
  const set = dm?.overrides.damage === true || extra.some((x) => x.set);
  const mods = dm?.mods?.damage ?? [];
  const eq = set
    ? { dice: [], terms: [] }
    : settle(
        [...(stored ? breakdownChips(stored) : []), ...extra.flatMap(breakdownChips)],
        (stored?.constant ?? 0) + extra.reduce((n, x) => n + x.constant, 0),
        sumOf(mods) + sumOf(p.parts ?? []),
        p.damage,
      );
  const extras = p.damageParts ?? [];
  const weapon = p.damage - sumOf(p.parts ?? []) - sumOf(extras);
  const lines: DetailLine[] =
    eq.dice.length > 0
      ? [...modLines(mods, undefined), ...parts]
      : extras.length + parts.length === 0
        ? []
        : [
            { key: "weapon", value: String(weapon), label: p.damageType ?? "", rolled: true },
            ...extras.map((x, i) => ({
              key: `part-${i}`,
              value: signed(x.value),
              label: x.multiplier ? `${x.type} (${x.multiplier})` : x.type,
              rolled: true,
            })),
            ...parts,
          ];
  return {
    key: "damage",
    rollId: null,
    heading: p.damageType ? `Damage (${p.damageType})` : "Damage",
    expression: stored ? baseExpression(stored.expression, "normal") : null,
    mode: null,
    tags: [
      ...(p.crit ? ["Critical"] : []),
      ...(p.multiplier !== "normal" ? [capital(p.multiplier)] : []),
      ...(dm?.overrides.damage ? setTags(dm.damageRolled) : []),
      ...extra.flatMap((x) => (x.set ? [`${capital(x.type)}: Set by DM, rolled ${x.rolled}`] : [])),
    ],
    ...eq,
    lines,
    offered: [],
    total: p.damage,
    outcome: "damage",
    hit: false,
    outcomes: p.callout ? [{ text: "Overkill!", tone: "good" }] : [],
  };
}

function attackSections(e: GameLogEntryView): DetailSection[] {
  const parsed = AttackLogPayload.safeParse(e.payload);
  if (!parsed.success) return [];
  const p = parsed.data;
  const dm = AttackLogDmPayload.safeParse(e.dmPayload ?? null).data;
  const out: DetailSection[] = [];
  if (p.toHit) out.push(toHitSection(p, dm));
  if (p.hit && !p.awaitingDamage) out.push(damageSection(p, dm));
  return out;
}

/** FR-DICE-107: the sections of a `roll` or `cbt.attack` line; [] = show its full line instead. */
export function detailSections(e: GameLogEntryView): DetailSection[] {
  if (e.kind === ROLL_KIND) return rollSections(e);
  if (e.kind === LOG_KIND_ATTACK) return attackSections(e);
  return [];
}

/** FR-DICE-107: the header's "what it was": the label, never a baked expression (said below it). */
export function detailWhat(e: GameLogEntryView, sections: readonly DetailSection[]): string | null {
  if (e.kind === ROLL_KIND && sections.length === 1) {
    const items = RollEntryPayload.safeParse(e.payload);
    const item = items.success ? itemsAfterActor(items.data, e.actorName)[0] : undefined;
    if (item?.label) return item.label;
    return item?.purpose ? capital(item.purpose) : null;
  }
  return rowAction(e).text || null;
}

/** FR-DICE-107: the "physical" tag in the footer (a manual roll, either kind). */
export function entryPhysical(e: GameLogEntryView): boolean {
  if (e.kind === ROLL_KIND) {
    const items = RollEntryPayload.safeParse(e.payload);
    return items.success && items.data.some((i) => i.manual);
  }
  if (e.kind === LOG_KIND_ATTACK) {
    const m = AttackLogPayload.safeParse(e.payload).data?.manual;
    return m ? m.toHit || m.damage : false;
  }
  return false;
}

/**
 * FR-DICE-107: a line without dice, its actor split off: the header names it, so the line doesn't.
 * A line whose actor isn't first ("DM awards Mira …") stays whole, with no name in the header.
 */
export function lineWithoutActor(segments: readonly LineSegment[]): {
  actor: string | null;
  rest: LineSegment[];
} {
  const [first, second, ...others] = segments;
  if (first?.style !== "actor") return { actor: null, rest: [...segments] };
  if (!second) return { actor: first.text, rest: [] };
  const text = second.text.replace(/^\s*(?:[—:]\s*)?/, "");
  return { actor: first.text, rest: [...(text ? [{ ...second, text }] : []), ...others] };
}
