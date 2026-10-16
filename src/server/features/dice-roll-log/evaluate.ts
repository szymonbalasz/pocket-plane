// `dice.evaluate` (FR-DICE-19, FR-DICE-01–08): grammar + mode + manual checks, then one
// immutable `roll` row in the caller's transaction. No event; the caller logs and emits.
// With a `subject` (FR-MOD-13) it first asks the hooks' `modes()` (FR-MOD-17: the final mode is
// known before the d20 is rolled), then runs their `adjust`: parts come back on `mods`, the
// caller adds `mods.modTotal` to its outcome and lists the part rolls (`rollIdsOf`). Physical
// part dice arrive as `manualParts` groups (FR-MOD-18): `e:` strict, `t:` lenient.
import {
  applyMode,
  constantOf,
  type DiceTerm,
  diceCount,
  diceRange,
  diceTerms,
  keptFlags,
  parseExpression,
  prepareExpression,
  type Term,
  toNotation,
} from "@shared/dice-roll-log/grammar";
import {
  type DieResult,
  type DmModPart,
  type ManualEntry,
  type ManualPart,
  PART_DICE_MAX,
  ROLL_MODS_MAX,
  ROLL_NOTE_MAX,
  ROLL_NOTES_MAX,
  ROLL_OFFERED_MAX,
  type RollCategory,
  type RollEntryDmPayload,
  RollLabel,
  type RollMode,
  type RollPayloadItem,
} from "@shared/dice-roll-log/schemas";
import { combineModes } from "@shared/effect-modifiers/rules";
import { RollSubject } from "@shared/effect-modifiers/schemas";
import type { CommandEnv } from "../../commands/commands";
import { rollDice } from "../../commands/dice";
import { CommandError, conflict, invalid } from "../../commands/errors";
import { roll } from "../../db/schema";
import {
  type OfferedPart,
  type RollHook,
  type RollModeHint,
  type RollPart,
  rollHooks,
} from "./roll-hooks";
import { campaignOf } from "./settings";

export type RollSource = "dice" | "char" | "cbt";
export type RollActorKind = "dm" | "player" | "entity" | "token";

export interface EvaluateInput {
  expression: string;
  mode: RollMode;
  category: RollCategory;
  label?: string | null;
  /** Resolved by the caller; the name is copied into the row (FR-DICE-10). */
  actor: { kind: RollActorKind; id: string | null; name: string };
  manual?: ManualEntry;
  source: RollSource;
  target?: { entityId?: string | null; tokenId?: string | null; name: string | null };
  /**
   * FR-MOD-13: who rolls what. Given → the roll hooks run after the base row and the result
   * carries `mods`. Absent → exactly as before (no hooks, no `mods`).
   */
  subject?: RollSubject;
  /**
   * FR-MOD-18 (tier 2 / T): physical groups for bonus dice (`e:<effectId>`) and offered trigger
   * dice (`t:<triggerId>`), beside the base `manual`. Absent = none sent (tier 1: a physical
   * roll's part dice are server-rolled, `auto`). Sent with a physical base roll → `e:` groups
   * must match the committed bonus dice exactly (else `conflict` "Effects changed — roll
   * again"); `t:` groups never conflict (surplus ignored; missing or unfit → server-rolled).
   */
  manualParts?: readonly ManualPart[];
}

/** A stored roll (data model §15). */
export type Roll = Omit<typeof roll.$inferSelect, "dice"> & { dice: DieResult[] };

/** FR-MOD-14: what the roll hooks added to a subject roll. */
export interface RollMods {
  /** Registry order, then each hook's order. */
  parts: RollPart[];
  /** Σ part values: the outcome total = base `total` + `modTotal` (FR-MOD-16). */
  modTotal: number;
  /**
   * FR-MOD-17, -19: the `modes()` hints behind the row's final `mode` (those agreeing with it;
   * none when hints cancel out), then any hints `adjust` returned (labels only).
   */
  modes: RollModeHint[];
  /** FR-MOD-37: offered trigger parts (rolled, **not** in `modTotal`), registry order; absent = none. */
  offered?: OfferedPart[];
  /** FR-MOD-34, -37: DM-only line notes from the hooks, registry order; absent = none. */
  notes?: string[];
}

/** `dice.evaluate`'s result: the base roll row, plus `mods` iff a subject was passed. */
export type EvaluatedRoll = Roll & { mods?: RollMods };

const exprIssue = (message: string) => invalid(message, [{ path: ["expression"], message }]);
/** FR-MOD-17, -18: the client's physical dice no longer fit the committed effects. */
export const EFFECTS_CHANGED = "Effects changed — roll again";
const manualIssue = (message: string, path: (string | number)[] = []) =>
  invalid(message, [{ path: ["manual", ...path], message }]);

/** Signed sum of kept dice with known values. */
function keptSum(terms: DiceTerm[], dice: DieResult[]): number {
  let at = 0;
  let sum = 0;
  for (const t of terms) {
    for (const d of dice.slice(at, at + t.count)) if (d.kept) sum += t.sign * (d.value ?? 0);
    at += t.count;
  }
  return sum;
}

/** FR-DICE-06: manual dice, validated against the final terms. */
function manualDice(terms: Term[], m: ManualEntry): DieResult[] {
  const dts = diceTerms(terms);
  const { min, max } = diceRange(terms);
  if (m.diceTotal < min || m.diceTotal > max) {
    throw manualIssue(`Dice total must be ${min}–${max}`, ["diceTotal"]);
  }
  const count = diceCount(terms);
  if (m.dice) {
    if (m.dice.length !== count) throw manualIssue(`Enter ${count} dice values`, ["dice"]);
    const out: DieResult[] = [];
    let at = 0;
    for (const t of dts) {
      const values = m.dice.slice(at, at + t.count);
      values.forEach((v, i) => {
        if (v > t.faces) {
          throw manualIssue(`Die ${at + i + 1} must be 1–${t.faces}`, ["dice", at + i]);
        }
      });
      const kept = keptFlags(t, values);
      values.forEach((v, i) => {
        out.push({ faces: t.faces, value: v, kept: kept[i] ?? true });
      });
      at += t.count;
    }
    if (keptSum(dts, out) !== m.diceTotal) {
      throw manualIssue("Dice values must add up to the dice total", ["dice"]);
    }
    return out;
  }
  if (count === 1) {
    const t = dts[0] as DiceTerm;
    return [{ faces: t.faces, value: t.sign * m.diceTotal, kept: true }];
  }
  // Several dice, total only: values unknown (null); kept = the first K of a keep term.
  return dts.flatMap((t) =>
    Array.from({ length: t.count }, (_, i) => ({
      faces: t.faces,
      value: null,
      kept: i < (t.keep ? t.keep.n : t.count),
    })),
  );
}

/** Rolled dice from `ctx.dice` via the library (FR-DICE-02, FR-DICE-03). */
function rolledDice(env: CommandEnv, terms: Term[]): { dice: DieResult[]; libraryTotal: number } {
  let rolled: ReturnType<typeof rollDice>;
  try {
    rolled = rollDice(env.ctx.dice, toNotation(terms));
  } catch (err) {
    if (err instanceof CommandError) throw err;
    throw exprIssue("Invalid dice expression");
  }
  const dts = diceTerms(terms);
  if (rolled.dice.length !== dts.length) throw new Error("Dice library term count mismatch");
  const dice = dts.flatMap((t, i) => {
    const group = rolled.dice[i] ?? [];
    if (group.length !== t.count) throw new Error("Dice library die count mismatch");
    return group.map((d) => ({ faces: t.faces, value: d.value, kept: d.kept }));
  });
  return { dice, libraryTotal: rolled.total };
}

/** `natural` = the value of the single kept d20 (positive term), else null. */
function naturalOf(terms: Term[], dice: DieResult[]): number | null {
  const kept: DieResult[] = [];
  let at = 0;
  for (const t of diceTerms(terms)) {
    for (const d of dice.slice(at, at + t.count)) {
      if (d.kept && d.faces === 20 && t.sign === 1) kept.push(d);
    }
    at += t.count;
  }
  return kept.length === 1 ? (kept[0]?.value ?? null) : null;
}

/**
 * `hooks` defaults to the registry; tests pass their own list (stub hooks). Callers never do.
 */
export function evaluate(
  env: CommandEnv,
  input: EvaluateInput,
  hooks: readonly RollHook[] = rollHooks,
): EvaluatedRoll {
  // A bad subject is a caller bug (`internal`), caught before anything is rolled.
  const subject = input.subject === undefined ? undefined : RollSubject.parse(input.subject);
  if (!subject) return evaluateBase(env, input);
  // FR-MOD-17: hints first; the final mode rewrites the d20 before it is rolled (FR-DICE-04).
  const hints = preRollHints(env, input.expression, subject, hooks);
  const mode = combineModes(input.mode, hints);
  if (input.manual) checkManualMode(input.expression, input.manual, mode);
  const row = evaluateBase(env, { ...input, mode });
  const agreeing = hints.filter((h) => h.mode === mode);
  return { ...row, mods: runRollHooks(env, input, row, subject, hooks, agreeing) };
}

/** A plain `1d20` term the mode can rewrite (FR-DICE-04); none → modes don't apply. */
function modeable(expression: string): boolean {
  const parsed = parseExpression(expression);
  return parsed.ok && applyMode(parsed.value, "advantage").ok;
}

/** FR-MOD-17: every hook's `modes()`, registry order; none for a roll without a d20. */
function preRollHints(
  env: CommandEnv,
  expression: string,
  subject: RollSubject,
  hooks: readonly RollHook[],
): RollModeHint[] {
  if (!modeable(expression)) return [];
  return hooks.flatMap((h) => h.modes?.(env, subject) ?? []);
}

/**
 * FR-MOD-17: a physical entry whose die values fit another mode's d20 count but not the final
 * mode's (the effects changed since the client's preview) → `conflict`. Other count errors stay
 * `invalid` (FR-DICE-06, `manualDice`).
 */
function checkManualMode(expression: string, m: ManualEntry, mode: RollMode): void {
  if (!m.dice || !modeable(expression)) return;
  const count = (md: RollMode) => {
    const r = prepareExpression(expression, md);
    return r.ok ? diceCount(r.value) : -1;
  };
  if (m.dice.length === count(mode)) return;
  const others = (["normal", "advantage", "disadvantage"] as const).filter((x) => x !== mode);
  if (others.some((x) => count(x) === m.dice?.length)) throw conflict(EFFECTS_CHANGED);
}

/** FR-MOD-19 (D9): a roll's die values in notation order; an unknown value or > 20 dice → none. */
function dieValues(r: Roll): number[] | undefined {
  if (r.dice.length === 0 || r.dice.length > PART_DICE_MAX) return undefined;
  const out: number[] = [];
  for (const d of r.dice) {
    if (d.value === null) return undefined;
    out.push(Math.abs(d.value));
  }
  return out;
}

/** FR-MOD-13/14: every hook in order, after the base row, in the caller's transaction. */
function runRollHooks(
  env: CommandEnv,
  input: EvaluateInput,
  base: Roll,
  subject: RollSubject,
  hooks: readonly RollHook[],
  preHints: readonly RollModeHint[],
): RollMods {
  const groups = new Map((input.manualParts ?? []).map((p) => [p.key, p.entry]));
  // FR-MOD-18: `e:` groups are strict for a physical base roll from a client that sends groups.
  const strict = base.manual && input.manualParts !== undefined;
  const usedKeys = new Set<string>();
  const extras = new Map<string, Roll>();
  const extra = (expression: string, label: string, manual?: ManualEntry): Roll => {
    const r = evaluateBase(env, {
      expression,
      mode: "normal",
      category: input.category,
      label,
      actor: input.actor,
      source: input.source,
      ...(input.target ? { target: input.target } : {}),
      ...(manual ? { manual } : {}),
    });
    extras.set(r.id, r);
    return r;
  };
  const rollExtra = (expression: string, label: string, key?: string): Roll => {
    if (key === undefined) return extra(expression, label);
    usedKeys.add(key);
    const entry = groups.get(key);
    if (key.startsWith("e:")) {
      if (entry === undefined) {
        if (strict) throw conflict(EFFECTS_CHANGED);
        return extra(expression, label);
      }
      const prepared = prepareExpression(expression, "normal");
      if (entry.dice && prepared.ok && entry.dice.length !== diceCount(prepared.value)) {
        throw conflict(EFFECTS_CHANGED);
      }
      return extra(expression, label, entry);
    }
    // `t:` (R2 ruling): never a conflict. An unfit group is ignored and the dice server-rolled.
    if (entry !== undefined) {
      try {
        return extra(expression, label, entry);
      } catch (err) {
        if (!(err instanceof CommandError)) throw err;
      }
    }
    return extra(expression, label);
  };
  const ctx = {
    manual: base.manual,
    category: base.category,
    source: input.source,
    rollExtra,
    ...(input.manualParts ? { manualParts: input.manualParts } : {}),
  };
  const parts: RollPart[] = [];
  const modes: RollModeHint[] = [...preHints];
  const offered: OfferedPart[] = [];
  const notes: string[] = [];
  for (const h of hooks) {
    const r = h.adjust(env, subject, ctx);
    for (const p of r.parts) {
      if (!Number.isInteger(p.value)) throw new Error(`Roll hook "${h.id}": part value not an int`);
      parts.push(p);
    }
    modes.push(...r.modes);
    offered.push(...(r.offered ?? []));
    notes.push(...(r.notes ?? []));
  }
  if (parts.length > ROLL_MODS_MAX || modes.length > ROLL_MODS_MAX) {
    throw conflict(`At most ${ROLL_MODS_MAX} effect modifiers per roll`);
  }
  if (offered.length > ROLL_OFFERED_MAX) {
    throw new Error(`Roll hooks offered ${offered.length} parts (max ${ROLL_OFFERED_MAX})`);
  }
  // FR-MOD-18: a strict `e:` group no committed bonus die asked for → that effect ended meanwhile.
  if (strict) {
    for (const k of groups.keys()) {
      if (k.startsWith("e:") && !usedKeys.has(k)) throw conflict(EFFECTS_CHANGED);
    }
  }
  // FR-MOD-19 (D9): per-die values of the dice each part / offer rolled through `rollExtra`.
  const withDice = <P extends { rollId?: string; dice?: number[] }>(p: P): P => {
    if (p.dice !== undefined || p.rollId === undefined) return p;
    const r = extras.get(p.rollId);
    const values = r ? dieValues(r) : undefined;
    return values ? { ...p, dice: values } : p;
  };
  const offers = offered.map(withDice);
  return {
    parts: parts.map(withDice),
    modTotal: parts.reduce((s, p) => s + p.value, 0),
    modes,
    ...(offers.length ? { offered: offers } : {}),
    ...(notes.length ? { notes } : {}),
  };
}

function evaluateBase(env: CommandEnv, input: EvaluateInput): Roll {
  const cid = campaignOf(env.actor);
  const prepared = prepareExpression(input.expression, input.mode);
  if (!prepared.ok) throw exprIssue(prepared.message);
  const terms = prepared.value;
  const constant = constantOf(terms);
  const dts = diceTerms(terms);

  let dice: DieResult[];
  let total: number;
  if (input.manual) {
    dice = manualDice(terms, input.manual);
    total = input.manual.diceTotal + constant;
  } else {
    const r = rolledDice(env, terms);
    dice = r.dice;
    total = keptSum(dts, dice) + constant;
    if (total !== r.libraryTotal) throw new Error("Dice library total mismatch");
  }

  let label: string | null = null;
  if (input.label !== undefined && input.label !== null) {
    const lp = RollLabel.safeParse(input.label);
    if (!lp.success) {
      const message = lp.error.issues[0]?.message ?? "Invalid label";
      throw invalid(message, [{ path: ["label"], message }]);
    }
    label = lp.data === "" ? null : lp.data;
  }
  const row: Roll = {
    id: env.ctx.ids.next(),
    campaignId: cid,
    at: env.ctx.clock.iso(),
    rollerRole: env.actor.role === "player" ? "player" : "dm",
    rollerPlayerId: env.actor.role === "player" ? env.actor.playerId : null,
    actorKind: input.actor.kind,
    actorId: input.actor.id,
    actorName: input.actor.name,
    targetEntityId: input.target?.entityId ?? null,
    targetTokenId: input.target?.tokenId ?? null,
    targetName: input.target?.name ?? null,
    category: input.category,
    label,
    source: input.source,
    expression: toNotation(terms),
    mode: input.mode,
    manual: input.manual !== undefined,
    dice,
    constant,
    total,
    natural: naturalOf(terms, dice),
    replacesRollId: null,
  };
  env.tx.insert(roll).values(row).run();
  return row;
}

/**
 * The `roll` kind's payload item for a stored roll (callers build multi-roll entries with it).
 * FR-MOD-19: with parts, `total` includes them and `mods` lists them; a part's label only if
 * its effect is player-visible (the DM's names go in `rollDmPayload`).
 */
export function rollPayloadItem(r: EvaluatedRoll): RollPayloadItem {
  const item: RollPayloadItem = {
    rollId: r.id,
    expression: r.expression,
    mode: r.mode,
    manual: r.manual,
    dice: r.dice,
    constant: r.constant,
    total: r.total,
    natural: r.natural,
    label: r.label,
  };
  if (r.mods?.parts.length) {
    item.total = r.total + r.mods.modTotal;
    item.mods = r.mods.parts.map((p) => ({
      label: p.public ? p.label : null,
      value: p.value,
      ...(p.expression !== undefined ? { expression: p.expression } : {}),
      ...(p.auto ? { auto: true as const } : {}),
      ...(p.rollId !== undefined ? { rollId: p.rollId } : {}),
      ...(p.dice !== undefined ? { dice: p.dice } : {}),
      ...(p.type !== undefined ? { type: p.type } : {}),
    }));
  }
  if (r.mods?.modes.length) item.modes = r.mods.modes.map((m) => (m.public ? m.label : null));
  // FR-MOD-19 (R1): offered trigger parts, **not** in `total`; settle facts ride on the card only.
  if (r.mods?.offered?.length) {
    item.offered = r.mods.offered.map((o) => ({
      label: o.public ? o.label : null,
      value: o.value,
      expression: o.expression,
      rollId: o.rollId,
      type: o.type,
      ...(o.auto ? { auto: true as const } : {}),
      ...(o.dice !== undefined ? { dice: o.dice } : {}),
    }));
  }
  return item;
}

/** FR-MOD-19: the DM's name of a part or hint: its trigger's (`roll` trigger) or its effect's. */
const dmName = (x: { effectId: string; triggerId?: string; label: string }): DmModPart =>
  x.triggerId !== undefined
    ? { triggerId: x.triggerId, label: x.label }
    : { effectId: x.effectId, label: x.label };

/**
 * FR-MOD-19: the `roll` kind's `dmPayload` for an entry of these rolls (payload order): every
 * part's, mode hint's and offer's name, plus the hooks' DM-only notes (FR-MOD-34, -37; ≤ 4,
 * each ≤ 80 chars). Undefined when there is none of them (no `dmPayload`).
 */
export function rollDmPayload(rolls: readonly EvaluatedRoll[]): RollEntryDmPayload | undefined {
  const notes = rolls
    .flatMap((r) => r.mods?.notes ?? [])
    .filter((n) => n.length > 0)
    .slice(0, ROLL_NOTES_MAX)
    .map((n) => (n.length > ROLL_NOTE_MAX ? `${n.slice(0, ROLL_NOTE_MAX - 1)}…` : n));
  const named = rolls.some(
    (r) => r.mods?.parts.length || r.mods?.modes.length || r.mods?.offered?.length,
  );
  if (!named && notes.length === 0) return undefined;
  return {
    ...(notes.length ? { notes } : {}),
    items: rolls.map((r) => ({
      mods: (r.mods?.parts ?? []).map(dmName),
      ...(r.mods?.modes.length ? { modes: r.mods.modes.map(dmName) } : {}),
      ...(r.mods?.offered?.length
        ? { offered: r.mods.offered.map((o) => ({ triggerId: o.triggerId, label: o.label })) }
        : {}),
    })),
  };
}

/**
 * FR-DICE-26: the base roll, its part rolls (bonus dice) and its offered trigger rolls
 * (FR-MOD-14), for an entry's `rollIds`.
 */
export const rollIdsOf = (r: EvaluatedRoll): string[] => [
  r.id,
  ...(r.mods?.parts ?? []).flatMap((p) => (p.rollId ? [p.rollId] : [])),
  ...(r.mods?.offered ?? []).map((o) => o.rollId),
];
