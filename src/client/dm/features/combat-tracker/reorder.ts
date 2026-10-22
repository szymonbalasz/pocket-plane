// Sprint 8 CB1 (FR-CBTX-62, -63, FR-CBT-165): what a drag or a Move up / down in the DM Initiative
// may do, as pure functions over the listed rows. Blocks (a row + the companions riding it), the
// drop spots between them with the server's own number rule (`planMove`, shared), the "→ n" hint,
// the anchors of Move up / down and the crossing hint toasted after the ack. Display only: the
// server decides (`cbtx.moveCombatant`).
import {
  type MovePlan,
  type MoveRow,
  planMove,
  ridesOwner,
  stepTurn,
  type TurnRow,
} from "@shared/combat-tracker/rules";
import type { CombatantView } from "@shared/combat-tracker/schemas";

/** Pointer travel before a press on the grip becomes a drag, px. */
export const DRAG_THRESHOLD = 4;
/** The list scrolls while the pointer is this close to its top or bottom edge, px. */
export const AUTOSCROLL_EDGE = 24;
/** Scroll per animation frame at (or past) the edge, px; 1 px where the zone starts. */
export const AUTOSCROLL_MAX = 4;

/** One draggable unit: a row and the rows riding it (FR-CBT-107), top to bottom. */
export interface Block {
  head: CombatantView;
  rows: CombatantView[];
  /** Active, not removed, not riding an owner (FR-CBTX-62): has a grip. */
  movable: boolean;
}

/**
 * Blocks of the listed rows (the DM layout's rows in rank order, lines inside their owner's row).
 * A row riding its owner joins the block above it (its owner's, as the server ranks it); `all`
 * = every row of the encounter (removed too), so "rides its owner" reads as the server's.
 */
export function blocksOf(listed: readonly CombatantView[], all: readonly CombatantView[]): Block[] {
  const key = (r: CombatantView) => ({
    id: r.id,
    kind: r.kind,
    seq: r.seq ?? 0,
    turnMode: r.turnMode,
    ownerCharacterId: r.ownerCharacterId,
    entityId: r.entityId,
  });
  const keys = all.map(key);
  const out: Block[] = [];
  for (const c of listed) {
    const rides = ridesOwner(keys, key(c));
    const last = out.at(-1);
    if (rides && last) last.rows.push(c);
    else out.push({ head: c, rows: [c], movable: !rides && !c.removed });
  }
  return out;
}

/** `planMove`'s rows: the movable heads in the current order. */
export const moveRowsOf = (blocks: readonly Block[]): MoveRow[] =>
  blocks
    .filter((b) => b.movable)
    .map((b) => ({
      id: b.head.id,
      kind: b.head.kind,
      hidden: b.head.hidden === true,
      initiative: b.head.initiative ?? null,
    }));

/** FR-CBTX-62: no movable row has a number → grips disabled, "Roll initiative first". */
export const noInitiative = (blocks: readonly Block[]) =>
  !blocks.some((b) => b.movable && b.head.initiative != null);

/** A drop spot: the boundary before block `index` (`blocks.length` = below the last). */
export interface Slot {
  index: number;
  /** The anchor the intent names (null = top). */
  afterId: string | null;
  plan: MovePlan;
}

/** The anchor of the boundary before block `i`, or undefined when no drop can name it. */
function anchorAt(blocks: readonly Block[], i: number): string | null | undefined {
  if (i === 0) return null;
  const prev = blocks[i - 1];
  if (!prev?.movable || prev.head.initiative == null) return undefined;
  return prev.head.id;
}

/**
 * FR-CBTX-62: the spots `movedId` may drop on: between blocks only, never below the last row with
 * initiative, never the start spot (both boundaries of its own block: nothing would change).
 */
export function dropSlots(blocks: readonly Block[], movedId: string): Slot[] {
  const rows = moveRowsOf(blocks);
  const out: Slot[] = [];
  for (let i = 0; i <= blocks.length; i++) {
    const afterId = anchorAt(blocks, i);
    if (afterId === undefined || afterId === movedId) continue;
    const res = planMove(rows, movedId, afterId);
    if (res.ok && res.plan) out.push({ index: i, afterId, plan: res.plan });
  }
  return out;
}

/**
 * The spot nearest the pointer (`y`, list coordinates); `boundary(i)` = the y of the boundary
 * before block `i`. Null = the start spot (the moved block's own boundaries are nearer).
 */
export function nearestSlot(
  slots: readonly Slot[],
  boundary: (index: number) => number,
  movedIndex: number,
  y: number,
): Slot | null {
  let best: Slot | null = null;
  let dist = Math.min(Math.abs(y - boundary(movedIndex)), Math.abs(y - boundary(movedIndex + 1)));
  for (const s of slots) {
    const d = Math.abs(y - boundary(s.index));
    if (d < dist) {
      best = s;
      dist = d;
    }
  }
  return best;
}

/** The drop line's hint: the moved row's new number ("→ 15") and rewritten rows ("Wolf → 17"). */
export interface DropHint {
  number: number | null;
  others: string[];
}

export function dropHint(blocks: readonly Block[], slot: Slot, movedId: string): DropHint {
  const name = new Map(blocks.map((b) => [b.head.id, b.head.name]));
  const others = slot.plan.order
    .filter((id) => id !== movedId && slot.plan.numbers.has(id))
    .map((id) => `${name.get(id) ?? "?"} → ${slot.plan.numbers.get(id)}`);
  return { number: slot.plan.numbers.get(movedId) ?? null, others };
}

/**
 * Autoscroll per frame (walkthrough CB4 / CB8: a flat 8 px a frame ran the list to the end):
 * inside the 24 px zone at either edge, 1 px a frame where the zone starts up to
 * `AUTOSCROLL_MAX` at the edge and past it; the same for both edges; else 0. `top` = the first
 * visible row line (below the sticky column header).
 */
export function autoscrollStep(y: number, top: number, bottom: number): number {
  const speed = (inside: number) =>
    1 +
    Math.floor(((AUTOSCROLL_MAX - 1) * (AUTOSCROLL_EDGE - Math.max(0, inside))) / AUTOSCROLL_EDGE);
  const up = y - top;
  const down = bottom - y;
  if (up < AUTOSCROLL_EDGE && up <= down) return -speed(up);
  if (down < AUTOSCROLL_EDGE) return speed(down);
  return 0;
}

/**
 * FR-CBTX-63: Move up / down, one block per step: up → anchor = the block two above (top when
 * one above), down → the block below. Null = disabled (an end, an attached row, a spot the
 * server would refuse).
 */
export function stepAnchor(
  blocks: readonly Block[],
  id: string,
  dir: "up" | "down",
): { afterId: string | null } | null {
  const b = blocks.findIndex((x) => x.head.id === id);
  if (b < 0 || !blocks[b]?.movable) return null;
  const i = dir === "up" ? b - 1 : b + 2;
  if (i < 0 || i > blocks.length) return null;
  const afterId = anchorAt(blocks, i);
  if (afterId === undefined) return null;
  const res = planMove(moveRowsOf(blocks), id, afterId);
  return res.ok && res.plan ? { afterId } : null;
}

/** The plan of a drop `id` after `afterId` (for the hint after a Move up / down). */
export function planOf(blocks: readonly Block[], id: string, afterId: string | null) {
  const res = planMove(moveRowsOf(blocks), id, afterId);
  return res.ok ? res.plan : null;
}

/**
 * FR-CBT-165: the DM's hint once its move is acked (round ≥ 1): the moved row crossed the turn row
 * upwards ("no turn for it this round"), downwards ("it acts again"), or is the turn row (its
 * turn goes on; Next's row in the new order). `dead` (FR-CBTX-25) skips like a monster at 0.
 * Null: round 0, no turn, nothing crossed.
 */
export function crossingHint(
  blocks: readonly Block[],
  plan: MovePlan,
  movedId: string,
  round: number,
  turnId: string | null,
  dead: (c: CombatantView) => boolean = () => false,
): string | null {
  if (round < 1 || !turnId) return null;
  const turnBlock = blocks.find((b) => b.rows.some((r) => r.id === turnId));
  const moved = blocks.find((b) => b.head.id === movedId);
  const turn = turnBlock?.rows.find((r) => r.id === turnId);
  if (!turnBlock?.movable || !moved || !turn) return null;
  const byHead = new Map(blocks.map((b) => [b.head.id, b]));
  if (turnBlock === moved) {
    const after = plan.order.flatMap((id) => byHead.get(id)?.rows ?? []);
    const rows: TurnRow[] = after.map((c, i) => ({
      id: c.id,
      position: i + 1,
      kind: dead(c) ? "monster" : c.kind,
      removed: c.removed === true,
      hpCurrent: dead(c) ? 0 : (c.hpCurrent ?? null),
      initiative: c.initiative ?? null,
    }));
    const next = stepTurn(rows, round, turnId, "next");
    if (!next.ok || next.turnCombatantId === turnId) return null;
    const name = after.find((c) => c.id === next.turnCombatantId)?.name;
    return name ? `${turn.name}'s turn goes on; next: ${name}` : null;
  }
  const before = blocks.filter((b) => b.movable).map((b) => b.head.id);
  const t = turnBlock.head.id;
  const wasBelow = before.indexOf(movedId) > before.indexOf(t);
  const isBelow = plan.order.indexOf(movedId) > plan.order.indexOf(t);
  if (wasBelow && !isBelow) {
    return `${moved.head.name} now acts before ${turn.name}: no turn for it this round`;
  }
  if (!wasBelow && isBelow) {
    return `${moved.head.name} now acts after ${turn.name}: it acts again this round`;
  }
  return null;
}
