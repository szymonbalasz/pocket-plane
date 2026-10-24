// Pure combat rules shared by the server (authoritative) and the clients (previews, hints).
import { parseExpression, type Term, toNotation } from "@shared/dice-roll-log/grammar";
import { numberedName } from "@shared/scenes-map/geometry";
import type {
  CombatantKind,
  DamageCardTargetOutcome,
  DamageMultiplier,
  HealthBand,
  Side,
  TurnMode,
} from "./schemas";

// ---------- side (FR-CBT-98, #252) ----------

/** The kind's default side: PCs are the party's, monsters against it. */
export const defaultSide = (kind: CombatantKind): Side => (kind === "pc" ? "ally" : "enemy");

/** The true side (DM, likely targets); null = the kind's default. */
export const sideOf = (c: { kind: CombatantKind; side?: Side | null }): Side =>
  c.side ?? defaultSide(c.kind);

/** The side players were last openly shown (FR-CBT-100); null = the kind's default. */
export const publicSideOf = (c: { kind: CombatantKind; publicSide?: Side | null }): Side =>
  c.publicSide ?? defaultSide(c.kind);

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
  /** Sprint 6 (FR-CBT-107): companions rank by their owner PC's combatant (`entityId`). */
  entityId?: string;
  ownerCharacterId?: string | null;
  turnMode?: TurnMode | null;
  /** FR-CBT-116: a hidden owner hides its companions from players (no player rank). */
  ownerHidden?: boolean;
  /** Sprint 8 (FR-CBT-162): the DM's order inside a tie; null = default rules. */
  tieOrder?: number | null;
}

/** What `ranks` needs besides the rows (FR-CBT-108's owner states). */
export interface RankContext {
  /** Combatants that can't take a turn now (removed, dead: FR-CBT-14, FR-CBTX-25). */
  ineligible?: ReadonlySet<string>;
  /** The turn combatant keeps a rank until the turn moves on (a restored owner, FR-CBT-108). */
  turnCombatantId?: string | null;
}

/**
 * Initiative desc, then (sprint 8, FR-CBT-162) `tieOrder` asc with null after any number, init
 * bonus desc, PC before monster, `seq`; no initiative last.
 */
export function compareOrder(a: RankInput, b: RankInput): number {
  if (a.initiative === null && b.initiative !== null) return 1;
  if (b.initiative === null && a.initiative !== null) return -1;
  if (a.initiative !== null && b.initiative !== null && a.initiative !== b.initiative) {
    return b.initiative - a.initiative;
  }
  const ta = a.tieOrder ?? null;
  const tb = b.tieOrder ?? null;
  if (ta !== tb) {
    if (ta === null) return 1;
    if (tb === null) return -1;
    return ta - tb;
  }
  if (a.initBonus !== b.initBonus) return b.initBonus - a.initBonus;
  if (a.kind !== b.kind) return a.kind === "pc" ? -1 : 1;
  return a.seq - b.seq;
}

/**
 * FR-CBT-107 (sprint 6): the owner PC's combatant a companion ranks by: the first PC combatant
 * of its owner character; null = not a companion, or the owner never joined (ranks as `own`).
 */
export function ownerRowOf<
  T extends Pick<RankInput, "id" | "kind" | "seq"> & { entityId?: string },
>(rows: readonly T[], c: { ownerCharacterId?: string | null }): T | null {
  if (!c.ownerCharacterId) return null;
  let best: T | null = null;
  for (const r of rows) {
    if (r.kind !== "pc" || r.entityId !== c.ownerCharacterId) continue;
    if (!best || r.seq < best.seq) best = r;
  }
  return best;
}

/**
 * FR-CBT-107 / -162: an `after-owner` / `in-owner-turn` companion whose owner joined rides its
 * owner (no sort key, no `tieOrder`, no grip); without an owner row it ranks as `own`.
 */
export function ridesOwner<
  T extends Pick<RankInput, "id" | "kind" | "seq" | "turnMode" | "ownerCharacterId"> & {
    entityId?: string;
  },
>(rows: readonly T[], c: T): boolean {
  return (
    (c.turnMode === "after-owner" || c.turnMode === "in-owner-turn") && ownerRowOf(rows, c) !== null
  );
}

/**
 * `position` 1…n over all; `playerPosition` 1…k over active, non-removed, non-hidden (and, since
 * sprint 6, not of a hidden owner). FR-CBT-107 / -108: an `after-owner` companion sits right after
 * its owner's combatant (by `seq` among them); an `in-owner-turn` one has no rank (both null)
 * while its owner is eligible, else (or while it is the turn combatant) it ranks as `after-owner`;
 * `own` and owner-less rows by `compareOrder`.
 */
export function ranks(
  rows: readonly RankInput[],
  rc: RankContext = {},
): Map<string, { position: number | null; playerPosition: number | null }> {
  const out = new Map<string, { position: number | null; playerPosition: number | null }>();
  const attached = new Map<string, RankInput[]>();
  const base: RankInput[] = [];
  for (const r of rows) {
    const owner =
      r.turnMode === "after-owner" || r.turnMode === "in-owner-turn" ? ownerRowOf(rows, r) : null;
    if (!owner) {
      base.push(r);
      continue;
    }
    const list = attached.get(owner.id) ?? [];
    list.push(r);
    attached.set(owner.id, list);
  }
  let i = 0;
  let k = 0;
  const place = (r: RankInput) => {
    const seen = r.active && !r.removed && !r.hidden && !r.ownerHidden;
    out.set(r.id, { position: ++i, playerPosition: seen ? ++k : null });
  };
  for (const r of [...base].sort(compareOrder)) {
    place(r);
    const companions = (attached.get(r.id) ?? []).sort((a, b) => a.seq - b.seq);
    const ownerEligible = !rc.ineligible?.has(r.id) && !r.removed && r.active;
    for (const c of companions) {
      if (c.turnMode === "in-owner-turn" && ownerEligible && rc.turnCombatantId !== c.id) {
        out.set(c.id, { position: null, playerPosition: null });
      } else {
        place(c);
      }
    }
  }
  return out;
}

/**
 * FR-CBT-108: the `in-owner-turn` companions acting inside `ownerCombatantId`'s turn (no rank,
 * active); their effects and `turnStart` triggers start with that turn, and Next onto the owner
 * resets their `movedFt`.
 */
export function inTurnCompanionsOf<
  T extends {
    id: string;
    kind: CombatantKind;
    seq: number;
    entityId?: string;
    active: boolean;
    position: number | null;
    turnMode?: TurnMode | null;
    ownerCharacterId?: string | null;
  },
>(rows: readonly T[], ownerCombatantId: string | null): T[] {
  if (!ownerCombatantId) return [];
  return rows
    .filter(
      (r) =>
        r.active &&
        r.turnMode === "in-owner-turn" &&
        r.position === null &&
        ownerRowOf(rows, r)?.id === ownerCombatantId,
    )
    .sort((a, b) => a.seq - b.seq);
}

// ---------- reorder (sprint 8, FR-CBTX-64–66) ----------

/** A movable row (active, not removed, not riding its owner), in the DM's current order. */
export interface MoveRow {
  id: string;
  kind: CombatantKind;
  hidden: boolean;
  initiative: number | null;
}

/** What a drop does: the order after, the numbers it changes, the tie it writes. */
export interface MovePlan {
  /** Movable rows' ids in the order after the drop. */
  order: string[];
  /** Changed numbers only (the moved row's and rewritten private rows'). */
  numbers: Map<string, number>;
  /** FR-CBTX-66: the number whose tie the drop arranges (every movable row with it, in `order`). */
  tieValue: number;
}

export type MoveResult =
  | { ok: true; plan: MovePlan | null }
  | { ok: false; code: "invalid" | "conflict"; message: string };

/**
 * FR-CBTX-65: a public number is a PC's (hidden ones too, so a reveal never shows a monster's
 * number on a PC); players see no other row's number.
 */
export const publicNumber = (r: Pick<MoveRow, "kind">) => r.kind === "pc";

/**
 * FR-CBTX-64–66 (decided #335, OQ-CBTX-31 A′): drop `movedId` right after `afterId` (null = top)
 * in `rows` (movable rows, current order). Plan null = the order stays as it is (ack, no write).
 * (a) A private moved row (not a PC) takes the anchor's number (top: the first other numbered row's).
 * (b) A PC keeps its own number, lowered to the nearest public row above the drop spot and
 * raised to the nearest public row below; private rows on the wrong side take that number. So a
 * PC's number only ever becomes another PC's, and the rule reveals no private number.
 * The server's command and the DM client's number hint both run this.
 */
export function planMove(
  rows: readonly MoveRow[],
  movedId: string,
  afterId: string | null,
): MoveResult {
  const moved = rows.find((r) => r.id === movedId);
  if (!moved) return { ok: false, code: "conflict", message: "Can't move this row" };
  const rest = rows.filter((r) => r.id !== movedId);
  const firstNumbered = rest.find((r) => r.initiative !== null);
  if (!firstNumbered) return { ok: false, code: "conflict", message: "Roll initiative first" };
  let at = 0;
  if (afterId !== null) {
    const i = rest.findIndex((r) => r.id === afterId);
    if (i < 0 || rest[i]?.initiative === null) {
      return { ok: false, code: "invalid", message: "Drop below a row with initiative" };
    }
    at = i + 1;
  }
  const after = [...rest.slice(0, at), moved, ...rest.slice(at)];
  if (after.every((r, i) => r.id === rows[i]?.id)) return { ok: true, plan: null };
  const above = after.slice(0, at);
  const below = after.slice(at + 1);
  const numbers = new Map<string, number>();
  let n: number;
  if (!publicNumber(moved)) {
    n =
      afterId === null
        ? (firstNumbered.initiative as number)
        : (above.at(-1)?.initiative as number);
  } else {
    // Lists are in order, so the nearest public row above has the lowest public number above.
    const up = above.filter(publicNumber).at(-1)?.initiative ?? null;
    const down = below.find((r) => publicNumber(r) && r.initiative !== null)?.initiative ?? null;
    let own = moved.initiative ?? down ?? up;
    if (own === null) {
      return { ok: false, code: "conflict", message: "Set a number first" };
    }
    if (up !== null && own > up) own = up;
    if (down !== null && own < down) own = down;
    n = own;
    for (const r of above) {
      if (!publicNumber(r) && r.initiative !== null && r.initiative < n) numbers.set(r.id, n);
    }
    for (const r of below) {
      if (!publicNumber(r) && r.initiative !== null && r.initiative > n) numbers.set(r.id, n);
    }
  }
  if (moved.initiative !== n) numbers.set(moved.id, n);
  return { ok: true, plan: { order: after.map((r) => r.id), numbers, tieValue: n } };
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
  /** Null = no turn of its own (an `in-owner-turn` companion, FR-CBT-107). */
  position: number | null;
  kind: CombatantKind;
  removed: boolean;
  hpCurrent: number | null;
  initiative: number | null;
  /** Sprint 6 (FR-CBT-108): companions acting with their owner never count as missing. */
  turnMode?: TurnMode | null;
}

/** Rows with a turn of their own, in turn order. */
const turnOrder = <T extends TurnRow>(rows: readonly T[]) =>
  rows
    .filter((r): r is T & { position: number } => r.position !== null)
    .sort((a, b) => a.position - b.position);

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
  const order = turnOrder(rows);
  const ok = order.filter(eligible);
  if (round === 0) {
    if (direction === "prev") return { ok: false, message: "Combat has not started" };
    // FR-CBT-108: `after-owner` / `in-owner-turn` companions use their owner's number.
    const missing = order.filter(
      (r) =>
        !r.removed &&
        r.initiative === null &&
        r.turnMode !== "after-owner" &&
        r.turnMode !== "in-owner-turn",
    ).length;
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

// ---------- playtest pass (#171): roll controls, skip cue ----------

/**
 * FR-CBT-46 (#172): a roll-initiative control shows in round 0 (the DM may overwrite), and from
 * round 1 only for a combatant without initiative (nobody re-rolls).
 */
export const canRollInitiative = (round: number, initiative: number | null | undefined) =>
  round === 0 || initiative == null;

/**
 * FR-CBT-11 / -46: "Roll monsters" sends every non-removed monster without initiative; sprint 6
 * (FR-CBT-108): companions acting with their owner (`after-owner`, `in-owner-turn`) never roll.
 */
export function unrolledMonsters<
  T extends {
    kind: CombatantKind;
    removed?: boolean;
    initiative?: number | null;
    turnMode?: TurnMode | null;
  },
>(rows: readonly T[]): T[] {
  return rows.filter(
    (c) =>
      c.kind === "monster" &&
      !c.removed &&
      c.initiative == null &&
      c.turnMode !== "after-owner" &&
      c.turnMode !== "in-owner-turn",
  );
}

/**
 * FR-CBT-46 / -64: "Roll monsters" shows iff a non-removed monster lacks initiative. Since sprint 2
 * monsters roll at Start and add, so round 0 hides it too when it has nothing to send.
 */
export const showRollMonsters = (_round: number, unrolled: number) => unrolled > 0;

/** FR-CBT-50: a combatant Next / Prev skips while down (a monster at 0 HP, not removed). */
export const skippedWhileDown = (r: TurnRow) => !r.removed && !eligible(r);

/**
 * FR-CBT-50 skip cue, computed from the order at send time: the down combatants the turn passes
 * over from `turnId` to the step's target, in passing order (removed ones are not named), and
 * the new round if it changed. Null when the step fails or skips nobody. Sprint 11 (BL-110):
 * `inTurnOf` = the `in-owner-turn` companions acting inside a combatant's turn (no rank,
 * FR-CBT-108); the target's down ones are named after the passed-over rows.
 */
export function skippedOnStep<T extends TurnRow & { name: string }>(
  rows: readonly T[],
  round: number,
  turnId: string | null,
  direction: "next" | "prev",
  inTurnOf: (combatantId: string) => readonly (TurnRow & { name: string })[] = () => [],
): { names: string[]; round: number | null } | null {
  const step = stepTurn(rows, round, turnId, direction);
  if (!step.ok) return null;
  const order = turnOrder(rows);
  const n = order.length;
  const from = round === 0 ? -1 : order.findIndex((r) => r.id === turnId);
  const d = direction === "next" ? 1 : -1;
  const names: string[] = [];
  let i = from;
  for (let k = 0; k < n; k++) {
    i = (((i + d) % n) + n) % n;
    const r = order[i] as T;
    if (r.id === step.turnCombatantId) break;
    if (skippedWhileDown(r)) names.push(r.name);
  }
  for (const c of inTurnOf(step.turnCombatantId)) if (skippedWhileDown(c)) names.push(c.name);
  if (names.length === 0) return null;
  return { names, round: round !== 0 && step.round !== round ? step.round : null };
}

/** FR-CBT-50 DM Toast: "Skipped Goblin, Goblin 2 (down)" (+ " · Round 2"). */
export function skippedText(s: { names: readonly string[]; round: number | null }): string {
  return `Skipped ${s.names.join(", ")} (down)${s.round !== null ? ` · Round ${s.round}` : ""}`;
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

// ---------- undo unit (FR-CBT-35) ----------

export interface UndoRow {
  id: string;
  seq: number;
  cardId: string | null;
  undone: boolean;
}

/**
 * One undo step = one apply: the latest non-undone combat log entry plus every non-undone
 * entry of the same card (a card has at most one live apply). Latest first; [] = nothing.
 */
export function undoGroup<T extends UndoRow>(rows: readonly T[]): T[] {
  const live = rows.filter((r) => !r.undone).sort((a, b) => b.seq - a.seq);
  const last = live[0];
  if (!last) return [];
  if (last.cardId === null) return [last];
  return live.filter((r) => r.cardId === last.cardId);
}

const MULTIPLIER_SUFFIX: Record<DamageMultiplier, string> = {
  normal: "",
  half: " (half)",
  none: " (none)",
  double: " (double)",
};

/**
 * FR-CBT-42 player resolved view: one part per target, apply order, joined " · ". Hit → "Hit
 * Goblin: 6" (+ multiplier unless normal), miss → "Miss Goblin"; a null (hidden) name → "Hit: 6"
 * / "Miss".
 */
export function resolutionText(targets: readonly DamageCardTargetOutcome[]): string {
  return targets
    .map((t) => {
      const name = t.targetName === null ? "" : ` ${t.targetName}`;
      return t.hit ? `Hit${name}: ${t.applied}${MULTIPLIER_SUFFIX[t.multiplier]}` : `Miss${name}`;
    })
    .join(" · ");
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
