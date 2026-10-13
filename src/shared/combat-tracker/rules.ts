// Pure combat rules shared by the server (authoritative) and the clients (previews, hints).
import { parseExpression, type Term, toNotation } from "@shared/dice-roll-log/grammar";
import { numberedName } from "@shared/scenes-map/geometry";
import type { CombatantKind, DamageMultiplier, HealthBand } from "./schemas";

// ---------- order (FR-CBT-13) ----------

export interface RankInput {
  id: string;
  seq: number;
  kind: CombatantKind;
  initiative: number | null;
  initBonus: number;
  active: boolean;
  removed: boolean;
  hidden: boolean;
}

/** Initiative desc, init bonus desc, PC before monster, `seq`; no initiative last. */
export function compareOrder(a: RankInput, b: RankInput): number {
  if (a.initiative === null && b.initiative !== null) return 1;
  if (b.initiative === null && a.initiative !== null) return -1;
  if (a.initiative !== null && b.initiative !== null && a.initiative !== b.initiative) {
    return b.initiative - a.initiative;
  }
  if (a.initBonus !== b.initBonus) return b.initBonus - a.initBonus;
  if (a.kind !== b.kind) return a.kind === "pc" ? -1 : 1;
  return a.seq - b.seq;
}

/** `position` 1…n over all; `playerPosition` 1…k over active, non-removed, non-hidden. */
export function ranks(
  rows: readonly RankInput[],
): Map<string, { position: number; playerPosition: number | null }> {
  const out = new Map<string, { position: number; playerPosition: number | null }>();
  let k = 0;
  [...rows].sort(compareOrder).forEach((r, i) => {
    const seen = r.active && !r.removed && !r.hidden;
    out.set(r.id, { position: i + 1, playerPosition: seen ? ++k : null });
  });
  return out;
}

// ---------- health band (FR-CBT-26) ----------

export function healthBand(hpCurrent: number, hpMax: number): HealthBand {
  if (hpCurrent <= 0) return "down";
  if (2 * hpCurrent <= hpMax) return "bloodied";
  return "healthy";
}

// ---------- turns (FR-CBT-14) ----------

export interface TurnRow {
  id: string;
  position: number;
  kind: CombatantKind;
  removed: boolean;
  hpCurrent: number | null;
  initiative: number | null;
}

/** Not removed and not a monster at 0 HP (PCs at 0 keep turns, #139 P14). */
export const eligible = (r: TurnRow) => !r.removed && !(r.kind === "monster" && r.hpCurrent === 0);

export type TurnStep =
  | { ok: true; round: number; turnCombatantId: string }
  | { ok: false; message: string };

export function stepTurn(
  rows: readonly TurnRow[],
  round: number,
  turnId: string | null,
  direction: "next" | "prev",
): TurnStep {
  const order = [...rows].sort((a, b) => a.position - b.position);
  const ok = order.filter(eligible);
  if (round === 0) {
    if (direction === "prev") return { ok: false, message: "Combat has not started" };
    const missing = order.filter((r) => !r.removed && r.initiative === null).length;
    if (missing > 0) return { ok: false, message: `${missing} without initiative` };
    const first = ok[0];
    if (!first) return { ok: false, message: "No one can act" };
    return { ok: true, round: 1, turnCombatantId: first.id };
  }
  if (ok.length === 0) return { ok: false, message: "No one can act" };
  const cur = order.find((r) => r.id === turnId);
  const at = cur?.position ?? 0;
  if (direction === "next") {
    const after = ok.find((r) => r.position > at);
    if (after) return { ok: true, round, turnCombatantId: after.id };
    return { ok: true, round: round + 1, turnCombatantId: (ok[0] as TurnRow).id };
  }
  const before = [...ok].reverse().find((r) => r.position < at);
  if (before) return { ok: true, round, turnCombatantId: before.id };
  if (round <= 1) return { ok: false, message: "Already at the first turn" };
  return { ok: true, round: round - 1, turnCombatantId: (ok.at(-1) as TurnRow).id };
}

// ---------- attack maths (FR-CBT-19, FR-CBT-20, FR-CBT-22) ----------

/** Hit hint: natural 20 hits, natural 1 misses, else total ≥ AC. */
export function hitHint(natural: number | null, total: number, ac: number): boolean {
  if (natural === 20) return true;
  if (natural === 1) return false;
  return total >= ac;
}

export const MULTIPLIER_FACTOR: Record<DamageMultiplier, number> = {
  normal: 1,
  half: 0.5,
  none: 0,
  double: 2,
};

export const MULTIPLIER_LABEL: Record<DamageMultiplier, string> = {
  normal: "Normal",
  half: "Half",
  none: "None",
  double: "Double",
};

/** `raw = hit ? floor(damageTotal × factor) : 0`. */
export function rawDamage(hit: boolean, damageTotal: number, m: DamageMultiplier): number {
  return hit ? Math.floor(damageTotal * MULTIPLIER_FACTOR[m]) : 0;
}

/** Monster HP after a delta, clamped 0…hpMax. */
export function clampHp(hp: number, delta: number, hpMax: number): number {
  return Math.max(0, Math.min(hpMax, hp + delta));
}

// ---------- roll specs ----------

const signed = (n: number) => (n < 0 ? `-${Math.abs(n)}` : `+${n}`);

/** d20 + bonus. */
export const d20Expression = (bonus: number) => (bonus === 0 ? "1d20" : `1d20${signed(bonus)}`);

/** FR-CBT-16: natural 20 → damage dice count doubled ("critical"). */
export function critExpression(damage: string): string {
  const p = parseExpression(damage);
  if (!p.ok) return damage;
  const terms: Term[] = p.value.map((t) =>
    t.kind === "dice" ? { ...t, count: t.count * 2, keep: t.keep && { ...t.keep } } : t,
  );
  return toNotation(terms);
}

// ---------- binding at Start (FR-CBT-08) ----------

export interface BindToken {
  id: string;
  seq: number;
  definitionId: string;
  name: string;
  imageAssetId: string | null;
  hidden: boolean;
}

export interface BindSlot {
  kind: CombatantKind;
  entityId: string;
  /** Definition / character name and portrait (token-less fallback). */
  name: string;
  portraitAssetId: string | null;
}

export interface Binding extends BindSlot {
  tokenId: string | null;
  name: string;
  imageAssetId: string | null;
  hidden: boolean;
}

/**
 * Each slot takes the next unbound token on the scene with its definition (token `seq` order)
 * and copies its name, image and hidden flag. None left → token-less, visible, FR-MAP-16
 * numbered name over the encounter's names so far, image = portrait.
 */
export function planBindings(slots: readonly BindSlot[], tokens: readonly BindToken[]): Binding[] {
  const free = [...tokens].sort((a, b) => a.seq - b.seq);
  const used = new Set<string>();
  const names: string[] = [];
  return slots.map((s) => {
    const t = free.find((x) => !used.has(x.id) && x.definitionId === s.entityId);
    let b: Binding;
    if (t) {
      used.add(t.id);
      b = { ...s, tokenId: t.id, name: t.name, imageAssetId: t.imageAssetId, hidden: t.hidden };
    } else {
      b = {
        ...s,
        tokenId: null,
        name: numberedName(s.name.slice(0, 40), names),
        imageAssetId: s.portraitAssetId,
        hidden: false,
      };
    }
    names.push(b.name);
    return b;
  });
}
