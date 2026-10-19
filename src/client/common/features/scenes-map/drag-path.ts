// Drag path (FR-MAP-52–55, sprint 4): derived on each client from the one drag pipeline
// (`drag-preview.ts`, seams S1) and the `token` records it already receives: no intent,
// signal field, ack hint or record (0 bytes). `pathShown` is a draw rule over frames already
// routed (FR-MAP-53); the blocked step comes from the SCN wall hint in the drag probe's ack
// (FR-MAP-55). Combat trails are drawn from the token's stored `trail` (sprint 5, FR-MAP-65–67):
// no client trail state. DOM-free so it runs under `bun test`.
import type { Segment } from "@shared/scene-tools/schemas";
import { dragPath } from "@shared/scenes-map/geometry";
import type { TokenTrail, TokenView } from "@shared/scenes-map/schemas";

export interface Cell {
  col: number;
  row: number;
}

/**
 * FR-MAP-53: the path of T is drawn iff this client draws T at all (T in its store: hidden, fog-
 * and vision-hidden tokens never reach a player, nor their frames) and it is a DM client or T is a
 * player token. Non-player tokens glide on players' canvases with no path (OQ-MAP-37).
 */
export function pathShown(
  t: Pick<TokenView, "ownerPlayerId"> | undefined,
  client: "dm" | "player",
): boolean {
  if (!t) return false;
  return client === "dm" || t.ownerPlayerId !== null;
}

/** "c,r c,r …": the `cells` attr of `map-drag-path`. */
export const cellsAttr = (cells: readonly Cell[]) =>
  cells.map((c) => `${c.col},${c.row}`).join(" ");

/** Every footprint cell of the path's steps (an n × n token covers n² per step), each once. */
export function pathFootprint(path: readonly Cell[], n: number): Cell[] {
  const seen = new Set<string>();
  const out: Cell[] = [];
  for (const s of path) {
    for (let dr = 0; dr < n; dr++) {
      for (let dc = 0; dc < n; dc++) {
        const k = `${s.col + dc},${s.row + dr}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ col: s.col + dc, row: s.row + dr });
      }
    }
  }
  return out;
}

const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;

/**
 * FR-MAP-55: the index of the first path step past the wall the move guard found (the step the
 * from → to line crosses into), or -1. `pieces` = the wall hint's pieces for the current cell
 * (one piece around the first crossing, FR-SCN-38); the crossing is where the line between the
 * footprint centres meets the piece's line.
 */
export function blockedStep(from: Cell, to: Cell, n: number, pieces: readonly Segment[]): number {
  const steps = Math.max(Math.abs(to.col - from.col), Math.abs(to.row - from.row));
  const piece = pieces[0];
  if (steps === 0 || !piece) return -1;
  const ax = from.col + n / 2;
  const ay = from.row + n / 2;
  const dx = to.col - from.col;
  const dy = to.row - from.row;
  const [x1, y1, x2, y2] = piece;
  const den = cross(dx, dy, x2 - x1, y2 - y1);
  let t: number;
  if (Math.abs(den) > 1e-12) t = cross(x1 - ax, y1 - ay, x2 - x1, y2 - y1) / den;
  else {
    // Along the line (a wall the move runs on): the piece's middle, projected.
    const mx = (x1 + x2) / 2 - ax;
    const my = (y1 + y2) / 2 - ay;
    t = (mx * dx + my * dy) / (dx * dx + dy * dy);
  }
  const at = Math.ceil(Math.min(1, Math.max(0, t)) * steps - 1e-9);
  return Math.min(steps, Math.max(1, at));
}

/**
 * FR-MAP-55: the `blocked` step of this client's own drag. A player's from the wall hint; the DM
 * is never blocked (plain path, FR-SCN-13's "through wall" tag), whatever hints an owner's dry
 * run carries.
 */
export function ownDragBlocked(
  client: "dm" | "player",
  drag: { from: Cell; to: Cell; size: number },
  pieces: readonly Segment[],
): number {
  return client === "player" ? blockedStep(drag.from, drag.to, drag.size, pieces) : -1;
}

// ---------- combat trail (FR-MAP-65–67, sprint 5) ----------

/**
 * FR-MAP-67: the stored trail's segments, one per consecutive cell pair, each a straight
 * `dragPath` (FR-MAP-52). Every client that holds the token draws the same, after any reload.
 */
export function trailSegments(trail: TokenTrail | null | undefined): Cell[][] {
  const cells = (trail?.cells ?? []).map(([col, row]): Cell => ({ col, row }));
  return cells.slice(1).map((to, i) => dragPath(cells[i] as Cell, to));
}

/** "c,r c,r …": the `cells` attr of `map-drag-trail` (the stored cells, FR-MAP-67). */
export const trailCellsAttr = (trail: TokenTrail) =>
  trail.cells.map(([c, r]) => `${c},${r}`).join(" ");
