// Throws from received `roll` entries (FR-DICEX-13, -14; ADR-0044). Pure: one throw = the `roll`
// entries of one live frame, dice in `n` order. Reads `payload` only, never `dmPayload`
// (FR-DICEX-12): what a client throws is exactly what its log already shows.
import { labelAfterActor } from "@shared/dice-roll-log/actor-label";
import { z } from "zod";

/** FR-DICEX-14: the faces that get a 3D mesh; d100 = two d10 (tens + units). */
export const MESH_FACES: ReadonlySet<number> = new Set([4, 6, 8, 10, 12, 20]);
/** FR-DICEX-14 (OQ-DICEX-12): at most this many dice per throw; the rest → "+N more". */
export const MAX_THROW_DICE = 20;

export type DieShape = "d4" | "d6" | "d8" | "d10" | "d12" | "d20";

export interface ThrowDie {
  /** Stable within the throw: `<entryId>:<index>`. */
  key: string;
  entryId: string;
  /** Faces of the die as rolled (a d100's two parts keep 100). */
  faces: number;
  /** The server's value for this die (a d100 part: its part, tens 0–90 / units 0–9); null = chip. */
  value: number | null;
  /** What the die shows at rest: the value, or "00" / "0" for d100 parts. */
  face: string;
  /** 3D mesh; null = a flat chip (other faces, a part's sum, a manual total). */
  shape: DieShape | null;
  kept: boolean;
  /** Flat: no tumble (chips and physical dice). */
  flat: boolean;
  /** Typed in from physical dice (FR-DICE-06). */
  physical?: true;
  /** A sum without per-die values (a part's sum, a manual total): a round chip (FR-DICEX-42). */
  sum?: true;
  /** MOD / offered part label ("DM" when the part's label is null). */
  label?: string;
  sign: 1 | -1;
  /** Offered trigger part (Divine Fury): "on a hit", outside the total (R1). */
  offered?: true;
  d100?: "tens" | "units";
}

export interface DiceThrow {
  /** The first entry's id (`data-record-id`). */
  id: string;
  /**
   * FR-DICEX-15: the tumble's seed source, the first **public** entry's id (else the first
   * entry's), so a DM frame mixing a DM-only entry with public ones tumbles the public dice
   * exactly as the players see them.
   */
  seedId: string;
  entryIds: string[];
  /** Entries coalesced (FR-DICEX-11). */
  count: number;
  roller: { role: "dm" | "player"; playerId: string | null; name: string };
  /** First payload item's label, else its expression. */
  label: string;
  /** Per payload item total, in order (offered parts are outside it). */
  totals: number[];
  /** Any entry hidden from players (only ever true on the DM client). */
  hidden: boolean;
  dice: ThrowDie[];
  /** Dice beyond the first `MAX_THROW_DICE`. */
  more: number;
}

/** A die the 3D renderer draws (a mesh die with a server value); the rest stay flat chips. */
export const isMeshDie = (d: ThrowDie) => d.shape !== null && !d.flat && d.value !== null;

/** What a throw reads of an entry: never `dmPayload`. */
export interface ThrowEntry {
  id: string;
  n: number;
  kind: string;
  public: boolean;
  rollerRole: "dm" | "player";
  rollerPlayerId: string | null;
  actorName: string;
  payload: unknown;
}

// Lenient reads: a later spec's fields (R1: per-die `dice` on parts, `offered` items) pass
// through, and an item that doesn't parse is skipped rather than failing the whole throw.
const Part = z.looseObject({
  label: z.string().nullable().optional(),
  value: z.number(),
  expression: z.string().optional(),
  dice: z.array(z.number().int()).max(20).optional(),
  auto: z.boolean().optional(),
});
type Part = z.infer<typeof Part>;

const Item = z.looseObject({
  expression: z.string(),
  manual: z.boolean(),
  dice: z.array(
    z.looseObject({
      faces: z.number().int(),
      value: z.number().nullable(),
      kept: z.boolean(),
      auto: z.boolean().optional(),
    }),
  ),
  constant: z.number(),
  total: z.number(),
  label: z.string().nullable(),
  mods: z.array(Part).optional(),
  offered: z.array(Part).optional(),
});
type Item = z.infer<typeof Item>;

const shapeOf = (faces: number): DieShape | null =>
  MESH_FACES.has(faces) ? (`d${faces}` as DieShape) : null;

type DieInit = Omit<ThrowDie, "key" | "entryId">;

/** One die with a server value; d100 → tens + units (100 → "00" + "0"). */
function dieOf(faces: number, value: number, rest: Partial<DieInit>): DieInit[] {
  const base = { faces, kept: true, flat: false, sign: 1 as const, ...rest };
  if (faces === 100 && !base.flat) {
    const tens = (value % 100) - (value % 10);
    const units = value % 10;
    return [
      { ...base, value: tens, face: String(tens).padStart(2, "0"), shape: "d10", d100: "tens" },
      { ...base, value: units, face: String(units), shape: "d10", d100: "units" },
    ];
  }
  const shape = base.flat ? null : shapeOf(faces);
  return [{ ...base, value, face: String(value), shape, flat: base.flat || shape === null }];
}

/** A flat chip for a sum without per-die values. */
const chipOf = (faces: number, sum: number, rest: Partial<DieInit>): DieInit => ({
  faces,
  value: sum,
  face: String(sum),
  shape: null,
  kept: true,
  flat: true,
  sign: 1,
  ...rest,
  sum: true,
});

const ONE_DIE = /^([+-]?)1d(\d+)$/i;
const FACES = /d(\d+)/i;
const TERMS = /([+-]?)(\d+)d(\d+)/gi;
const TERMS_ANY = /\d+d\d+/i;

/**
 * Faces and sign of every die of an expression's dice terms, in order ("2d6+1d8" → d6, d6, d8;
 * "1d6-1d4" → d6, −d4): MOD's per-die `dice` follow the terms in this order (FR-MOD-19, #220).
 */
function termDice(expr: string): { faces: number; sign: 1 | -1 }[] {
  const out: { faces: number; sign: 1 | -1 }[] = [];
  for (const m of expr.matchAll(TERMS)) {
    const sign: 1 | -1 = m[1] === "-" ? -1 : 1;
    for (let i = 0; i < Number(m[2]); i++) out.push({ faces: Number(m[3]), sign });
  }
  return out;
}

/**
 * MOD parts and offered trigger parts: per-die `dice`, else `1dM` → one die, else a chip.
 * `physical`: the part's dice were typed in (a manual item's part not rolled by the server,
 * FR-MOD-18) → flat dice, no tumble, like the base roll's.
 */
function partDice(p: Part, offered: boolean, physical: boolean): DieInit[] {
  const expr = p.expression?.replace(/\s+/g, "") ?? "";
  const sign: 1 | -1 = expr.startsWith("-") || (!expr.startsWith("+") && p.value < 0) ? -1 : 1;
  const tag: Partial<DieInit> = {
    label: p.label ?? "DM",
    sign,
    ...(offered && { offered: true }),
    ...(physical && TERMS_ANY.test(expr) && { physical: true, flat: true }),
  };
  const faces = Number(FACES.exec(expr)?.[1] ?? 0);
  const terms = termDice(expr);
  if (p.dice && p.dice.length > 0 && terms.length === p.dice.length && terms.length > 1) {
    // Each die with its own type; a term's sign flips the part's ("1d6-1d4": the d4 is −).
    const lead = terms[0]?.sign ?? 1;
    return p.dice.flatMap((v, i) => {
      const t = terms[i] as { faces: number; sign: 1 | -1 };
      const s: 1 | -1 = t.sign === lead ? sign : sign === 1 ? -1 : 1;
      return dieOf(t.faces, Math.abs(v), { ...tag, sign: s });
    });
  }
  if (p.dice && p.dice.length > 0 && faces >= 2) {
    return p.dice.flatMap((v) => dieOf(faces, Math.abs(v), tag));
  }
  const one = ONE_DIE.exec(expr);
  if (one) return dieOf(Number(one[2]), Math.abs(p.value), tag);
  return [chipOf(faces, Math.abs(p.value), tag)];
}

function itemDice(item: Item): DieInit[] {
  const out: DieInit[] = [];
  if (item.manual) {
    const physical = { physical: true as const, flat: true };
    if (item.dice.some((d) => d.value === null)) {
      const mods = (item.mods ?? []).reduce((s, m) => s + m.value, 0);
      out.push(chipOf(item.dice[0]?.faces ?? 0, item.total - item.constant - mods, physical));
    } else {
      // A server-rolled d20 of a physical roll (FR-MOD-17, `auto`) tumbles like any rolled die.
      for (const d of item.dice)
        out.push(
          ...dieOf(
            d.faces,
            d.value ?? 0,
            d.auto ? { kept: d.kept } : { ...physical, kept: d.kept },
          ),
        );
    }
  } else {
    for (const d of item.dice) out.push(...dieOf(d.faces, d.value ?? 0, { kept: d.kept }));
  }
  for (const m of item.mods ?? []) out.push(...partDice(m, false, item.manual && !m.auto));
  for (const o of item.offered ?? []) out.push(...partDice(o, true, item.manual && !o.auto));
  return out;
}

/**
 * FR-DICEX-13: the throw of `entries` (one frame's new `roll` entries), or null when none of
 * them throws. Kinds other than `roll` never throw.
 */
export function throwDice(entries: readonly ThrowEntry[]): DiceThrow | null {
  const rolls = entries.filter((e) => e.kind === "roll").sort((a, b) => a.n - b.n);
  const first = rolls[0];
  if (!first) return null;
  const all: ThrowDie[] = [];
  const totals: number[] = [];
  let label: string | null = null;
  for (const e of rolls) {
    const items = Array.isArray(e.payload) ? e.payload : [];
    for (const raw of items) {
      const item = Item.safeParse(raw);
      if (!item.success) continue;
      label ??= labelAfterActor(item.data.label ?? item.data.expression, e.actorName);
      totals.push(item.data.total);
      for (const d of itemDice(item.data)) {
        all.push({ ...d, key: `${e.id}:${all.length}`, entryId: e.id });
      }
    }
  }
  return {
    id: first.id,
    seedId: (rolls.find((e) => e.public) ?? first).id,
    entryIds: rolls.map((e) => e.id),
    count: rolls.length,
    roller: { role: first.rollerRole, playerId: first.rollerPlayerId, name: first.actorName },
    label: label ?? "",
    totals,
    hidden: rolls.some((e) => !e.public),
    dice: all.slice(0, MAX_THROW_DICE),
    more: Math.max(0, all.length - MAX_THROW_DICE),
  };
}
