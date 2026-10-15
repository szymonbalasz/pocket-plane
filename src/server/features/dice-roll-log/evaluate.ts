// `dice.evaluate` (FR-DICE-19, FR-DICE-01–08): grammar + mode + manual checks, then one
// immutable `roll` row in the caller's transaction. No event; the caller logs and emits.
// With a `subject` (FR-MOD-13) it then runs the roll hooks: their parts come back on `mods`, the
// caller adds `mods.modTotal` to its outcome and lists the part rolls (`rollIdsOf`).
import {
  constantOf,
  type DiceTerm,
  diceCount,
  diceRange,
  diceTerms,
  keptFlags,
  prepareExpression,
  type Term,
  toNotation,
} from "@shared/dice-roll-log/grammar";
import {
  type DieResult,
  type ManualEntry,
  ROLL_MODS_MAX,
  type RollCategory,
  type RollEntryDmPayload,
  RollLabel,
  type RollMode,
  type RollPayloadItem,
} from "@shared/dice-roll-log/schemas";
import { RollSubject } from "@shared/effect-modifiers/schemas";
import type { CommandEnv } from "../../commands/commands";
import { rollDice } from "../../commands/dice";
import { CommandError, conflict, invalid } from "../../commands/errors";
import { roll } from "../../db/schema";
import { type RollHook, type RollModeHint, type RollPart, rollHooks } from "./roll-hooks";
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
}

/** A stored roll (data model §15). */
export type Roll = Omit<typeof roll.$inferSelect, "dice"> & { dice: DieResult[] };

/** FR-MOD-14: what the roll hooks added to a subject roll. */
export interface RollMods {
  /** Registry order, then each hook's order. */
  parts: RollPart[];
  /** Σ part values: the outcome total = base `total` + `modTotal` (FR-MOD-16). */
  modTotal: number;
  modes: RollModeHint[];
}

/** `dice.evaluate`'s result: the base roll row, plus `mods` iff a subject was passed. */
export type EvaluatedRoll = Roll & { mods?: RollMods };

const exprIssue = (message: string) => invalid(message, [{ path: ["expression"], message }]);
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
  const row = evaluateBase(env, input);
  if (!subject) return row;
  return { ...row, mods: runRollHooks(env, input, row, subject, hooks) };
}

/** FR-MOD-13/14: every hook in order, after the base row, in the caller's transaction. */
function runRollHooks(
  env: CommandEnv,
  input: EvaluateInput,
  base: Roll,
  subject: RollSubject,
  hooks: readonly RollHook[],
): RollMods {
  const rollExtra = (expression: string, label: string): Roll =>
    evaluateBase(env, {
      expression,
      mode: "normal",
      category: input.category,
      label,
      actor: input.actor,
      source: input.source,
      ...(input.target ? { target: input.target } : {}),
    });
  const ctx = { manual: base.manual, category: base.category, source: input.source, rollExtra };
  const parts: RollPart[] = [];
  const modes: RollModeHint[] = [];
  for (const h of hooks) {
    const r = h.adjust(env, subject, ctx);
    for (const p of r.parts) {
      if (!Number.isInteger(p.value)) throw new Error(`Roll hook "${h.id}": part value not an int`);
      parts.push(p);
    }
    modes.push(...r.modes);
  }
  if (parts.length > ROLL_MODS_MAX || modes.length > ROLL_MODS_MAX) {
    throw conflict(`At most ${ROLL_MODS_MAX} effect modifiers per roll`);
  }
  return { parts, modTotal: parts.reduce((s, p) => s + p.value, 0), modes };
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
    }));
  }
  if (r.mods?.modes.length) item.modes = r.mods.modes.map((m) => (m.public ? m.label : null));
  return item;
}

/**
 * FR-MOD-19: the `roll` kind's `dmPayload` for an entry of these rolls (payload order): every
 * part's and mode hint's effect id and label. Undefined when no roll has any (no `dmPayload`).
 */
export function rollDmPayload(rolls: readonly EvaluatedRoll[]): RollEntryDmPayload | undefined {
  if (!rolls.some((r) => r.mods?.parts.length || r.mods?.modes.length)) return undefined;
  const named = (x: { effectId: string; label: string }) => ({
    effectId: x.effectId,
    label: x.label,
  });
  return {
    items: rolls.map((r) => ({
      mods: (r.mods?.parts ?? []).map(named),
      ...(r.mods?.modes.length ? { modes: r.mods.modes.map(named) } : {}),
    })),
  };
}

/** FR-DICE-26: the base roll and its part rolls (bonus dice), for an entry's `rollIds`. */
export const rollIdsOf = (r: EvaluatedRoll): string[] => [
  r.id,
  ...(r.mods?.parts ?? []).flatMap((p) => (p.rollId ? [p.rollId] : [])),
];
