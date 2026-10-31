// The tray's attack / damage composition (FR-DICEX-97, -99, -101, -105; ADR-0073 decision 1): the
// dice with a damage type and a modifier per die group, the parts they form and why they can't
// roll. Pure.
import {
  type DiceTerm,
  diceCount,
  MAX_DICE,
  parseExpression,
  type Term,
  toNotation,
} from "@shared/dice-roll-log/grammar";
import {
  ATTACK_NEEDS_D20,
  type DmRollActorRef,
  type RollPurpose,
  type StagedPart,
  stagedPartsIssue,
} from "@shared/dice-roll-log/schemas";
import { MODIFIER_DAMAGE_TYPES } from "@shared/effect-modifiers/schemas";

/** A damage part's type (FR-CHARX-54; `StagedPart.type`). */
export type PartType = NonNullable<StagedPart["type"]>;
export const PART_TYPES: readonly PartType[] = MODIFIER_DAMAGE_TYPES;

/** The tray's purpose toggle (FR-DICEX-99): plain or a roll purpose. */
export type TrayPurpose = "plain" | RollPurpose;

/**
 * The tray's dice: `terms` with `types` parallel. Damage: every dice term is one **die group** (a
 * row in the tray, FR-DICEX-105) with its type; a constant belongs to the dice before it (leading
 * ones to the first group), its own `types` entry stays null. Plain and attack rolls leave every
 * type null.
 */
export interface Composition {
  terms: Term[];
  types: (PartType | null)[];
}

export const ATTACK_D20_TIP = "An attack needs its d20";
export const DAMAGE_DIE_TIP = "A damage roll needs a die";

/** A plain composition of an expression (no types); null when it doesn't parse. */
export function plainComposition(expression: string): Composition | null {
  const r = parseExpression(expression);
  return r.ok ? { terms: r.value, types: r.value.map(() => null) } : null;
}

const isDice = (t: Term): t is DiceTerm => t.kind === "dice";
const joinable = (t: Term, faces: number): t is DiceTerm =>
  isDice(t) && t.faces === faces && t.keep === null && t.sign === 1;

/** One die group (FR-DICEX-105): its dice term, its type and its own modifier. */
export interface TrayRow {
  term: number;
  type: PartType | null;
  constant: number;
  /** The constant terms that make up `constant`. */
  consts: number[];
}

/** FR-DICEX-105: the groups of a composition, in order. No dice → no groups. */
export function rowsOf(c: Composition): TrayRow[] {
  const rows: TrayRow[] = [];
  const leading: number[] = [];
  const own = (row: TrayRow, i: number) => {
    const t = c.terms[i];
    if (t?.kind !== "const") return;
    row.constant += t.sign * t.value;
    row.consts.push(i);
  };
  c.terms.forEach((t, i) => {
    if (isDice(t)) {
      const row: TrayRow = { term: i, type: c.types[i] ?? null, constant: 0, consts: [] };
      if (rows.length === 0) for (const k of leading) own(row, k);
      rows.push(row);
      return;
    }
    const last = rows[rows.length - 1];
    if (last) own(last, i);
    else leading.push(i);
  });
  return rows;
}

const constTerm = (value: number): Term => ({
  kind: "const",
  sign: value < 0 ? -1 : 1,
  value: Math.abs(Math.trunc(value)),
});

/**
 * A composition as rows: each group's dice then its modifier as one term; side by side, dice of
 * one size and type with no modifier between them are one group.
 */
export function normalize(c: Composition): Composition {
  const rows = rowsOf(c);
  if (rows.length === 0) return c;
  const terms: Term[] = [];
  const types: (PartType | null)[] = [];
  for (const row of rows) {
    const t = c.terms[row.term] as DiceTerm;
    const prev = terms[terms.length - 1];
    if (prev && joinable(t, t.faces) && joinable(prev, t.faces) && types.at(-1) === row.type) {
      terms[terms.length - 1] = { ...prev, count: prev.count + t.count };
    } else {
      terms.push(t);
      types.push(row.type);
    }
    if (row.constant !== 0) {
      terms.push(constTerm(row.constant));
      types.push(null);
    }
  }
  return { terms, types };
}

/**
 * FR-DICEX-101 (a): a staged control's composition. Damage: each part's dice with its type and its
 * constant after them, as rows. Attack (and plain): the expressions' terms, dice first, no types.
 */
export function compositionOf(
  expressions: readonly string[],
  purpose: TrayPurpose,
  partTypes: readonly (PartType | null | undefined)[] = [],
): Composition {
  const parsed = expressions.flatMap((x, i) => {
    const r = parseExpression(x);
    return r.ok ? [{ terms: r.value, type: partTypes[i] ?? null }] : [];
  });
  const diceFirst = (ts: readonly Term[]) => [
    ...ts.filter(isDice),
    ...ts.filter((t) => !isDice(t)),
  ];
  if (purpose === "damage") {
    const terms: Term[] = [];
    const types: (PartType | null)[] = [];
    for (const p of parsed) {
      for (const t of diceFirst(p.terms)) {
        terms.push(t);
        types.push(isDice(t) ? p.type : null);
      }
    }
    return normalize({ terms, types });
  }
  const terms = diceFirst(parsed.flatMap((p) => p.terms));
  return { terms, types: terms.map(() => null) };
}

/** The last die group's type (FR-DICEX-101 c), else null. */
export function lastGroupType(c: Composition): PartType | null {
  for (let i = c.terms.length - 1; i >= 0; i--) {
    if (c.terms[i]?.kind === "dice") return c.types[i] ?? null;
  }
  return null;
}

/** FR-DICEX-105: a new die group after the last one, whatever is already in the roll. */
export function startGroup(c: Composition, faces: number, type: PartType | null): Composition {
  if (diceCount(c.terms) >= MAX_DICE) return c;
  const die: DiceTerm = { kind: "dice", sign: 1, count: 1, faces, keep: null };
  return { terms: [...c.terms, die], types: [...c.types, type] };
}

/** FR-DICEX-105: a group's own "+": one more die of its size. */
export function addToGroup(c: Composition, term: number): Composition {
  const t = c.terms[term];
  if (!t || !isDice(t) || diceCount(c.terms) >= MAX_DICE) return c;
  return { ...c, terms: c.terms.map((x, j) => (j === term ? { ...t, count: t.count + 1 } : x)) };
}

/**
 * Palette (FR-DICEX-97, -101 b, c). Damage: a die of a size already in the roll joins the last
 * group of that size (OQ-DICEX-66 A); a new size starts a group after the last one with the last
 * group's type. Else: joins the first positive same-faces term without keep, else a new term
 * before the constants (as `addDie`).
 */
export function joinDie(c: Composition, faces: number, purpose: TrayPurpose): Composition {
  if (diceCount(c.terms) >= MAX_DICE) return c;
  const idx = c.terms.map((t, i) => (joinable(t, faces) ? i : -1)).filter((i) => i >= 0);
  const at = purpose === "damage" ? idx[idx.length - 1] : idx[0];
  if (at !== undefined) return addToGroup(c, at);
  if (purpose === "damage") return startGroup(c, faces, lastGroupType(c));
  const die: DiceTerm = { kind: "dice", sign: 1, count: 1, faces, keep: null };
  const firstConst = c.terms.findIndex((t) => t.kind === "const");
  const pos = firstConst < 0 ? c.terms.length : firstConst;
  return {
    terms: [...c.terms.slice(0, pos), die, ...c.terms.slice(pos)],
    types: [...c.types.slice(0, pos), null, ...c.types.slice(pos)],
  };
}

/**
 * A die click removes one of its term; the term goes with its last die. Damage: a group's modifier
 * goes with it (FR-DICEX-105); a plain or attack roll keeps its constant.
 */
export function dropDie(c: Composition, term: number, purpose: TrayPurpose = "plain"): Composition {
  const t = c.terms[term];
  if (!t || !isDice(t)) return c;
  if (t.count > 1) {
    const count = t.count - 1;
    const keep = t.keep ? (t.keep.n >= count ? null : t.keep) : null;
    return { ...c, terms: c.terms.map((x, j) => (j === term ? { ...t, count, keep } : x)) };
  }
  const gone = new Set([term]);
  if (purpose === "damage") {
    for (const k of rowsOf(c).find((r) => r.term === term)?.consts ?? []) gone.add(k);
  }
  return {
    terms: c.terms.filter((_, j) => !gone.has(j)),
    types: c.types.filter((_, j) => !gone.has(j)),
  };
}

/**
 * FR-DICEX-97: the die a click may not remove, with why: an attack's `1d20`; a damage roll's
 * last die. Null = every die is removable.
 */
export function lockedDie(
  c: Composition,
  purpose: TrayPurpose,
): { term: number; tip: string } | null {
  if (purpose === "attack") {
    const term = c.terms.findIndex(
      (t) => isDice(t) && t.faces === 20 && t.count === 1 && t.keep === null && t.sign === 1,
    );
    return term < 0 ? null : { term, tip: ATTACK_D20_TIP };
  }
  if (purpose === "damage" && diceCount(c.terms) === 1) {
    const term = c.terms.findIndex(isDice);
    return term < 0 ? null : { term, tip: DAMAGE_DIE_TIP };
  }
  return null;
}

/** FR-DICEX-101: a group's type Select. FR-DICEX-105: the group stays its own row, whatever type. */
export function setGroupType(c: Composition, term: number, type: PartType | null): Composition {
  if (!isDice(c.terms[term] as Term)) return c;
  return { ...c, types: c.types.map((y, j) => (j === term ? type : y)) };
}

/** FR-DICEX-105: a group's modifier, one term right after its dice (0 → none). */
export function setGroupConstant(c: Composition, term: number, value: number): Composition {
  const row = rowsOf(c).find((r) => r.term === term);
  if (!row) return c;
  const gone = new Set(row.consts);
  const terms: Term[] = [];
  const types: (PartType | null)[] = [];
  c.terms.forEach((t, i) => {
    if (gone.has(i)) return;
    terms.push(t);
    types.push(c.types[i] ?? null);
    if (i !== term || value === 0 || !Number.isFinite(value)) return;
    terms.push(constTerm(value));
    types.push(null);
  });
  return { terms, types };
}

/** One damage part (FR-DICEX-101 d): its type and the groups that form it. */
export interface TrayPart {
  type: PartType | null;
  rows: TrayRow[];
}

/**
 * FR-DICEX-101 (d), (e): groups with the same type are one part; the untyped part (if any) is the
 * base part, else the part of the first group.
 */
export function partsOf(c: Composition): TrayPart[] {
  const parts: TrayPart[] = [];
  for (const row of rowsOf(c)) {
    const p = parts.find((x) => x.type === row.type);
    if (p) p.rows.push(row);
    else parts.push({ type: row.type, rows: [row] });
  }
  const untyped = parts.findIndex((p) => p.type === null);
  if (untyped > 0) parts.unshift(...parts.splice(untyped, 1));
  return parts;
}

/** The constant Input of a plain or attack roll: every constant replaced by one, after the dice. */
export function setBaseConstant(c: Composition, value: number): Composition {
  const terms = c.terms.filter((t) => t.kind !== "const");
  const types = c.types.filter((_, i) => c.terms[i]?.kind !== "const");
  if (value === 0 || !Number.isFinite(value)) return { terms, types };
  return { terms: [...terms, constTerm(value)], types: [...types, null] };
}

/**
 * The expression Input (compose): a typed expression keeps each group's type (same place, same
 * size), else the type of the last group of that size; a new size takes the last group's type.
 */
export function retype(prev: Composition, terms: readonly Term[]): Composition {
  const rows = rowsOf(prev);
  let n = 0;
  const types = terms.map((t): PartType | null => {
    if (!isDice(t)) return null;
    const row = rows[n++];
    if (row && (prev.terms[row.term] as DiceTerm).faces === t.faces) return row.type;
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i] as TrayRow;
      if ((prev.terms[r.term] as DiceTerm).faces === t.faces) return r.type;
    }
    return lastGroupType(prev);
  });
  return { terms: [...terms], types };
}

/** The whole composition as one expression (the expression Input, a plain roll). */
export const notationOfComposition = (c: Composition): string => toNotation(c.terms);

/** A part's terms: its groups' dice (one term per size where they can merge), then one constant. */
function partTerms(c: Composition, p: TrayPart): Term[] {
  const dice: DiceTerm[] = [];
  for (const row of p.rows) {
    const t = c.terms[row.term] as DiceTerm;
    const same = joinable(t, t.faces) ? dice.findIndex((x) => joinable(x, t.faces)) : -1;
    const x = dice[same];
    if (x) dice[same] = { ...x, count: x.count + t.count };
    else dice.push(t);
  }
  const constant = p.rows.reduce((n, r) => n + r.constant, 0);
  return constant === 0 ? dice : [...dice, constTerm(constant)];
}

/**
 * ADR-0073 decision 1: the staged parts the intent sends. Attack (and plain): one part, the whole
 * expression. Damage: one per part, base first; the base part's type only when typed.
 */
export function stagedPartsOf(c: Composition, purpose: TrayPurpose): StagedPart[] {
  if (purpose !== "damage") return [{ expression: toNotation(c.terms) }];
  return partsOf(c).map((p) => {
    const expression = toNotation(partTerms(c, p));
    return p.type ? { expression, type: p.type } : { expression };
  });
}

/**
 * FR-DICEX-99, -101 (f): why the composition can't roll as `purpose` (inline message, Roll
 * disabled), or null. Plain rolls are checked at Roll as today.
 */
export function compositionIssue(c: Composition, purpose: TrayPurpose): string | null {
  if (purpose === "plain") return null;
  if (purpose === "damage" && !c.terms.some(isDice)) return DAMAGE_DIE_TIP;
  if (purpose === "attack" && !c.terms.some(isDice)) return ATTACK_NEEDS_D20;
  return stagedPartsIssue(stagedPartsOf(c, purpose), purpose);
}

/** FR-DICEX-101 (e): "No type" is offered only while the base part is untyped. */
export const offersNoType = (c: Composition): boolean => partsOf(c)[0]?.type === null;

/**
 * FR-DICEX-101: a group's test record id, `<faces>:<type | none>`; FR-DICEX-105: the second group
 * of one size and type adds `:2`.
 */
export const groupRecordId = (c: Composition, term: number): string => {
  const id = (i: number) => {
    const t = c.terms[i];
    return `${t && isDice(t) ? t.faces : 0}:${c.types[i] ?? "none"}`;
  };
  const nth = rowsOf(c).filter((r) => r.term <= term && id(r.term) === id(term)).length;
  return nth > 1 ? `${id(term)}:${nth}` : id(term);
};

/** A type's label ("Slashing"); null → "No type". */
export const typeLabel = (t: PartType | null): string =>
  t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}` : "No type";

/** FR-DICE-41 (g): each staged part's slot label: "To hit" / the part's type / "Damage". */
export function partSlotLabels(c: Composition, purpose: TrayPurpose): (string | null)[] {
  if (purpose === "attack") return ["To hit"];
  if (purpose === "plain") return [null];
  return partsOf(c).map((p) => (p.type ? typeLabel(p.type) : "Damage"));
}

/** Two compositions with the same dice, constants and types. */
export const sameComposition = (a: Composition, b: Composition): boolean =>
  toNotation(a.terms) === toNotation(b.terms) && a.types.join() === b.types.join();

/** The records the player actor preset reads (FR-DICEX-99). */
export interface PresetRecords {
  you: { role: "dm" | "player"; playerId: string | null } | null;
  entities: readonly { id: string; kind: string; ownerPlayerId?: string | null }[];
  encounters: readonly { id: string; status: string }[];
  combatants: readonly {
    encounterId: string;
    kind: string;
    entityId?: string;
    active?: boolean;
    removed: boolean;
  }[];
}

/**
 * FR-DICEX-99: a player's Attack / Damage with the default actor ("me") rolls as their one own
 * character that is an active combatant of the started encounter; none or several → no preset.
 */
export function presetActor(r: PresetRecords): DmRollActorRef | null {
  if (r.you?.role !== "player") return null;
  const started = r.encounters.find((e) => e.status === "started")?.id;
  if (!started) return null;
  const own = new Set(
    r.entities
      .filter((e) => e.kind === "character" && e.ownerPlayerId === r.you?.playerId)
      .map((e) => e.id),
  );
  const fighting = r.combatants.filter(
    (c) =>
      c.encounterId === started &&
      c.kind === "pc" &&
      c.active !== false &&
      !c.removed &&
      c.entityId !== undefined &&
      own.has(c.entityId),
  );
  const ids = [...new Set(fighting.map((c) => c.entityId as string))];
  return ids.length === 1 ? { entityId: ids[0] as string } : null;
}
