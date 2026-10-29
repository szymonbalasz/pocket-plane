// The tray's attack / damage composition (FR-DICEX-97, -99, -101; ADR-0073 decision 1): the dice
// with a damage type per die group, the parts they form and why they can't roll. Pure.
import {
  constantOf,
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
 * The tray's dice: `terms` with `types` parallel (a dice term's group type; a constant's part,
 * null = the base part's). Plain and attack rolls leave every type null.
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

/** Dice terms first (their order kept), then the constants; one term per die size and type. */
export function normalize(c: Composition): Composition {
  const terms: Term[] = [];
  const types: (PartType | null)[] = [];
  c.terms.forEach((t, i) => {
    if (!isDice(t)) return;
    const type = c.types[i] ?? null;
    const same =
      t.keep === null && t.sign === 1
        ? terms.findIndex((x, j) => joinable(x, t.faces) && types[j] === type)
        : -1;
    const x = terms[same];
    if (x && isDice(x)) terms[same] = { ...x, count: x.count + t.count };
    else {
      terms.push(t);
      types.push(type);
    }
  });
  c.terms.forEach((t, i) => {
    if (isDice(t)) return;
    terms.push(t);
    types.push(c.types[i] ?? null);
  });
  return { terms, types };
}

/**
 * FR-DICEX-101 (a): a staged control's composition: each part's dice with its type (part 1 =
 * the base part, `partTypes[0]`), then the constants (the base part's untyped, an extra part's
 * with its type). Attack (and plain): the expressions' terms, no types.
 */
export function compositionOf(
  expressions: readonly string[],
  purpose: TrayPurpose,
  partTypes: readonly (PartType | null | undefined)[] = [],
): Composition {
  const terms: Term[] = [];
  const types: (PartType | null)[] = [];
  const consts: Term[] = [];
  const constTypes: (PartType | null)[] = [];
  expressions.forEach((x, i) => {
    const r = parseExpression(x);
    if (!r.ok) return;
    const type = purpose === "damage" ? (partTypes[i] ?? null) : null;
    for (const t of r.value) {
      if (isDice(t)) {
        terms.push(t);
        types.push(type);
      } else {
        consts.push(t);
        constTypes.push(i === 0 ? null : type);
      }
    }
  });
  const c = { terms: [...terms, ...consts], types: [...types, ...constTypes] };
  return purpose === "damage" ? normalize(c) : c;
}

/** The last die group's type (FR-DICEX-101 c), else null. */
function lastGroupType(c: Composition): PartType | null {
  for (let i = c.terms.length - 1; i >= 0; i--) {
    if (c.terms[i]?.kind === "dice") return c.types[i] ?? null;
  }
  return null;
}

/**
 * Palette (FR-DICEX-97, -101 b, c). Damage: a die of a size already in the roll joins the last
 * group of that size and its type (OQ-DICEX-66 A); a new size starts a group after the last one
 * with the last group's type. Else: joins the first positive same-faces term without keep, else
 * a new term before the constants (as `addDie`).
 */
export function joinDie(c: Composition, faces: number, purpose: TrayPurpose): Composition {
  if (diceCount(c.terms) >= MAX_DICE) return c;
  const idx = c.terms.map((t, i) => (joinable(t, faces) ? i : -1)).filter((i) => i >= 0);
  const at = purpose === "damage" ? idx[idx.length - 1] : idx[0];
  if (at !== undefined) {
    const t = c.terms[at] as DiceTerm;
    return { ...c, terms: c.terms.map((x, j) => (j === at ? { ...t, count: t.count + 1 } : x)) };
  }
  const die: DiceTerm = { kind: "dice", sign: 1, count: 1, faces, keep: null };
  const type = purpose === "damage" ? lastGroupType(c) : null;
  const firstConst = c.terms.findIndex((t) => t.kind === "const");
  const pos = firstConst < 0 ? c.terms.length : firstConst;
  return {
    terms: [...c.terms.slice(0, pos), die, ...c.terms.slice(pos)],
    types: [...c.types.slice(0, pos), type, ...c.types.slice(pos)],
  };
}

/** A die click removes one of its term (the term goes with its last die, and its type). */
export function dropDie(c: Composition, term: number): Composition {
  const t = c.terms[term];
  if (!t || !isDice(t)) return c;
  if (t.count > 1) {
    const count = t.count - 1;
    const keep = t.keep ? (t.keep.n >= count ? null : t.keep) : null;
    return { ...c, terms: c.terms.map((x, j) => (j === term ? { ...t, count, keep } : x)) };
  }
  const type = c.types[term] ?? null;
  const terms = c.terms.filter((_, j) => j !== term);
  const types = c.types.filter((_, j) => j !== term);
  // The part's own constant goes with its last die.
  const left = terms.some((x, j) => isDice(x) && types[j] === type);
  if (left || type === null) return { terms, types };
  return {
    terms: terms.filter((x, j) => isDice(x) || types[j] !== type),
    types: types.filter((y, j) => isDice(terms[j] as Term) || y !== type),
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

/**
 * FR-DICEX-101: a group's type Select. Groups of one size and type merge; a part's own constant
 * follows its dice when the last group of the old type moves.
 */
export function setGroupType(c: Composition, term: number, type: PartType | null): Composition {
  const old = c.types[term] ?? null;
  if (!isDice(c.terms[term] as Term) || old === type) return c;
  const types = c.types.map((y, j) => (j === term ? type : y));
  const left = c.terms.some((x, j) => isDice(x) && types[j] === old);
  const moved =
    left || old === null
      ? types
      : types.map((y, j) => (!isDice(c.terms[j] as Term) && y === old ? type : y));
  return normalize({ terms: c.terms, types: moved });
}

/** One damage part (FR-DICEX-101 d): its type, its terms (indices) and its constant. */
export interface TrayPart {
  type: PartType | null;
  /** Dice term indices, in order. */
  dice: number[];
  constant: number;
  /** Its own constant terms (an extra part's: read-only in the tray). */
  consts: number[];
}

/**
 * FR-DICEX-101 (d), (e): groups with the same type are one part; the untyped part (if any) is
 * the base part, else the part of the first group. The base part owns the untyped constants; a
 * constant typed for a part that has no dice left is dropped.
 */
export function partsOf(c: Composition): TrayPart[] {
  const parts: TrayPart[] = [];
  const at = (type: PartType | null) => parts.find((p) => p.type === type);
  c.terms.forEach((t, i) => {
    if (!isDice(t)) return;
    const type = c.types[i] ?? null;
    const p = at(type);
    if (p) p.dice.push(i);
    else parts.push({ type, dice: [i], constant: 0, consts: [] });
  });
  const untyped = parts.findIndex((p) => p.type === null);
  if (untyped > 0) parts.unshift(...parts.splice(untyped, 1));
  const base = parts[0];
  c.terms.forEach((t, i) => {
    if (isDice(t)) return;
    const type = c.types[i] ?? null;
    const p = type === null ? base : at(type);
    if (!p) return;
    p.constant += t.sign * t.value;
    p.consts.push(i);
  });
  return parts;
}

/** The base part's constant (the constant Input, FR-DICEX-97). */
export const baseConstant = (c: Composition, purpose: TrayPurpose): number =>
  purpose === "damage" ? (partsOf(c)[0]?.constant ?? 0) : constantOf(c.terms);

/**
 * The constant Input: the base part's constants replaced by one (0 → none), after the dice; an
 * extra part's own constant stays.
 */
export function setBaseConstant(c: Composition, value: number, purpose: TrayPurpose): Composition {
  const base = purpose === "damage" ? partsOf(c)[0] : null;
  const drop = new Set(
    base ? base.consts : c.terms.map((t, i) => (t.kind === "const" ? i : -1)).filter((i) => i >= 0),
  );
  const terms = c.terms.filter((_, i) => !drop.has(i));
  const types = c.types.filter((_, i) => !drop.has(i));
  if (value === 0 || !Number.isFinite(value)) return { terms, types };
  const k: Term = { kind: "const", sign: value < 0 ? -1 : 1, value: Math.abs(Math.trunc(value)) };
  const firstConst = terms.findIndex((t) => t.kind === "const");
  const pos = firstConst < 0 ? terms.length : firstConst;
  return {
    terms: [...terms.slice(0, pos), k, ...terms.slice(pos)],
    types: [...types.slice(0, pos), null, ...types.slice(pos)],
  };
}

/**
 * The expression Input (compose): a typed expression keeps each die size's type (the last group
 * of that size), a new size takes the last group's type, constants go to the base part.
 */
export function retype(prev: Composition, terms: readonly Term[]): Composition {
  const types = terms.map((t): PartType | null => {
    if (!isDice(t)) return null;
    for (let i = prev.terms.length - 1; i >= 0; i--) {
      const x = prev.terms[i];
      if (x && isDice(x) && x.faces === t.faces) return prev.types[i] ?? null;
    }
    return lastGroupType(prev);
  });
  return { terms: [...terms], types };
}

/** The whole composition as one expression (the expression Input, a plain roll). */
export const notationOfComposition = (c: Composition): string => toNotation(c.terms);

/**
 * ADR-0073 decision 1: the staged parts the intent sends. Attack (and plain): one part, the
 * whole expression. Damage: one per part, base first; the base part's type only when typed.
 */
export function stagedPartsOf(c: Composition, purpose: TrayPurpose): StagedPart[] {
  if (purpose !== "damage") return [{ expression: toNotation(c.terms) }];
  return partsOf(c).map((p) => {
    const expression = toNotation([...p.dice, ...p.consts].map((i) => c.terms[i] as Term));
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

/** FR-DICEX-101: a group's test record id, `<faces>:<type | none>`. */
export const groupRecordId = (c: Composition, term: number): string => {
  const t = c.terms[term];
  return `${t && isDice(t) ? t.faces : 0}:${c.types[term] ?? "none"}`;
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
