// Pure structure logic both clients and the Structure tool use (FR-SCN-08, -09, -12, -13, -14):
// the drawn view of a DM or player `scene-structure` record, segment hit tests in map px, the
// polyline → segments rule, door state toggles and menu items, and the player's reject watch
// (a refused move snaps the shown token back from its drop cell → flash that cell). DOM-free.

import {
  blockingSegments,
  pxToVertex,
  SEGMENT_MIN_LENGTH,
  segmentKey,
  type Vertex,
  vertexToPx,
} from "@shared/scene-tools/geometry";
import {
  ADD_WALLS_MAX,
  DOOR_CLOSED,
  DOOR_LOCKED,
  DOOR_OPEN,
  DOOR_STATE_NAMES,
  type Door,
  type DoorState,
  type PlayerSceneStructureRecord,
  type SceneStructureRecord,
  type Segment,
  type Wall,
} from "@shared/scene-tools/schemas";
import type { Grid } from "@shared/scenes-map/geometry";

export type DoorStateName = (typeof DOOR_STATE_NAMES)[number];

export interface DoorView {
  n: number;
  seg: Segment;
  state: DoorState;
}

export interface StructureView {
  /** DM only; players never receive walls (FR-SCN-14). */
  walls: Wall[];
  doors: DoorView[];
  /** DM record (for undo and the hint); null on the player client. */
  full: SceneStructureRecord | null;
}

export const EMPTY_STRUCTURE: StructureView = { walls: [], doors: [], full: null };

/** A DM or player record as drawn: players' `open` 1 / 0 become open / closed. */
export function structureView(
  r: SceneStructureRecord | PlayerSceneStructureRecord | undefined,
): StructureView {
  if (!r) return EMPTY_STRUCTURE;
  if ("walls" in r) {
    return {
      walls: r.walls,
      doors: r.doors.map(([n, x1, y1, x2, y2, state]) => ({ n, seg: [x1, y1, x2, y2], state })),
      full: r,
    };
  }
  return {
    walls: [],
    doors: r.doors.map(([n, x1, y1, x2, y2, open]) => ({
      n,
      seg: [x1, y1, x2, y2],
      state: open === 1 ? DOOR_OPEN : DOOR_CLOSED,
    })),
    full: null,
  };
}

export const doorStateName = (s: DoorState): DoorStateName => DOOR_STATE_NAMES[s];

// ---------- hit tests (map px) ----------

/** A segment's endpoints in map px. */
export function segmentPx(g: Grid, [x1, y1, x2, y2]: Segment): [number, number, number, number] {
  const a = vertexToPx(g, { x: x1, y: y1 });
  const b = vertexToPx(g, { x: x2, y: y2 });
  return [a.x, a.y, b.x, b.y];
}

/** Distance from `p` to the segment `ab`. */
export function distToSegment(
  p: { x: number; y: number },
  [ax, ay, bx, by]: [number, number, number, number],
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / len2));
  return Math.hypot(p.x - (ax + t * dx), p.y - (ay + t * dy));
}

/** A door with both ends within this many cells of a wall lies on it (freeform 0.01 rounding). */
export const ON_WALL_CELLS = 0.02;

/** Whether the `door` segment lies along the `wall` segment, within `slack` map px. */
function liesOn(g: Grid, door: Segment, wall: Segment, slack: number): boolean {
  const [ax, ay, bx, by] = segmentPx(g, door);
  const w = segmentPx(g, wall);
  return distToSegment({ x: ax, y: ay }, w) <= slack && distToSegment({ x: bx, y: by }, w) <= slack;
}

/**
 * FR-SCN-08 Erase: the nearest wall or door within `tol` map px of `p`, or null. A door is the
 * more specific target: it wins a tie, and it wins over the nearest wall when it lies on that
 * wall, so a door drawn over a wall is erased before the wall under it (BL-12).
 */
export function hitSegment(
  s: StructureView,
  g: Grid,
  p: { x: number; y: number },
  tol: number,
): number | null {
  const near = (seg: Segment) => distToSegment(p, segmentPx(g, seg));
  let wall: { n: number; d: number; seg: Segment } | null = null;
  for (const w of s.walls) {
    const seg: Segment = [w[1], w[2], w[3], w[4]];
    const d = near(seg);
    if (d <= tol && (!wall || d < wall.d)) wall = { n: w[0], d, seg };
  }
  const slack = ON_WALL_CELLS * g.gridCellSize;
  let door: { n: number; d: number } | null = null;
  for (const dr of s.doors) {
    const d = near(dr.seg);
    if (d > tol || (door && d >= door.d)) continue;
    if (!wall || d <= wall.d || liesOn(g, dr.seg, wall.seg, slack)) door = { n: dr.n, d };
  }
  return door?.n ?? wall?.n ?? null;
}

export interface PxBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** FR-SCN-08 Erase box: the `n`s of segments fully inside the box (both endpoints). */
export function segmentsInBox(s: StructureView, g: Grid, b: PxBox): number[] {
  const [l, r] = [Math.min(b.x0, b.x1), Math.max(b.x0, b.x1)];
  const [t, bt] = [Math.min(b.y0, b.y1), Math.max(b.y0, b.y1)];
  const inside = (x: number, y: number) => x >= l && x <= r && y >= t && y <= bt;
  const out: number[] = [];
  const test = (n: number, seg: Segment) => {
    const [ax, ay, bx, by] = segmentPx(g, seg);
    if (inside(ax, ay) && inside(bx, by)) out.push(n);
  };
  for (const w of s.walls) test(w[0], [w[1], w[2], w[3], w[4]]);
  for (const d of s.doors) test(d.n, d.seg);
  return out;
}

// ---------- drawing (FR-SCN-08) ----------

/** FR-SCN-07: two points closer than 0.05 cell make no segment (exact on 1/100-cell points). */
export function tooClose(a: Vertex, b: Vertex): boolean {
  const dx = Math.round((b.x - a.x) * 100);
  const dy = Math.round((b.y - a.y) * 100);
  return dx * dx + dy * dy < (SEGMENT_MIN_LENGTH * 100) ** 2;
}

/**
 * Adds a clicked point to a polyline: a repeat of the last one (or one < 0.05 cell from it) is
 * ignored; ≤ 200 segments.
 */
export function addPoint(points: readonly Vertex[], v: Vertex): Vertex[] {
  const last = points.at(-1);
  if (last && tooClose(last, v)) return [...points];
  if (points.length > ADD_WALLS_MAX) return [...points];
  return [...points, v];
}

/** A polyline's segments, in order; repeats of an identical segment are dropped. */
export function polylineSegments(points: readonly Vertex[]): Segment[] {
  const out: Segment[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Vertex;
    const b = points[i] as Vertex;
    if (tooClose(a, b)) continue;
    const seg: Segment = [a.x, a.y, b.x, b.y];
    const key = segmentKey(seg);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(seg);
  }
  return out.slice(0, ADD_WALLS_MAX);
}

// ---------- freeform points and the endpoint magnet (FR-SCN-08, sprint 3) ----------

/** FR-SCN-08 (#207, OQ-SCN-24): magnet radius around existing endpoints, screen px. */
export const MAGNET_PX = 8;

const round2 = (v: number) => Math.round(v * 100) / 100 + 0;

/** FR-SCN-08 freeform: the map point in grid units, rounded to 0.01 cell. */
export function freePoint(g: Grid, x: number, y: number): Vertex {
  return {
    x: round2((x - g.gridOffsetX) / g.gridCellSize),
    y: round2((y - g.gridOffsetY) / g.gridCellSize),
  };
}

/** A point off the grid's vertices (drawn as an open dot; `scn-draft-point` attr `free`). */
export const isFreePoint = (v: Vertex): boolean => !Number.isInteger(v.x) || !Number.isInteger(v.y);

/**
 * FR-SCN-08 magnet: the existing wall or door endpoint (or a point of the polyline in progress)
 * nearest the map point `p`, within `tol` map px; null if none. Never moves a segment.
 */
export function magnetPoint(
  s: StructureView,
  draft: readonly Vertex[],
  g: Grid,
  p: { x: number; y: number },
  tol: number,
): Vertex | null {
  let best: { v: Vertex; d: number } | null = null;
  const consider = (v: Vertex) => {
    const q = vertexToPx(g, v);
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d <= tol && (!best || d < best.d)) best = { v, d };
  };
  for (const w of s.walls) {
    consider({ x: w[1], y: w[2] });
    consider({ x: w[3], y: w[4] });
  }
  for (const d of s.doors) {
    consider({ x: d.seg[0], y: d.seg[1] });
    consider({ x: d.seg[2], y: d.seg[3] });
  }
  for (const v of draft) consider(v);
  const hit = best as { v: Vertex; d: number } | null;
  return hit ? { x: hit.v.x, y: hit.v.y } : null;
}

/**
 * FR-SCN-08: the point a Wall / Door click places. An endpoint within the magnet radius wins;
 * else with Ctrl held the free point under the pointer (0.01 cell), else the nearest vertex.
 */
export function pickPoint(
  s: StructureView,
  draft: readonly Vertex[],
  g: Grid,
  p: { x: number; y: number; ctrl: boolean },
  tol: number,
): Vertex {
  return (
    magnetPoint(s, draft, g, p, tol) ?? (p.ctrl ? freePoint(g, p.x, p.y) : pxToVertex(g, p.x, p.y))
  );
}

// ---------- doors (FR-SCN-09) ----------

/** Double-click with Select: open ↔ closed; a locked door stays locked (null = no change). */
export function toggledDoor(state: DoorState): DoorState | null {
  if (state === DOOR_LOCKED) return null;
  return state === DOOR_OPEN ? DOOR_CLOSED : DOOR_OPEN;
}

export type DoorMenuItem = "open" | "close" | "lock" | "unlock" | "delete";

/** The door menu's items for a state, in order, with the state each one sets. */
export function doorMenuItems(state: DoorState): { item: DoorMenuItem; state: DoorState | null }[] {
  const out: { item: DoorMenuItem; state: DoorState | null }[] = [];
  if (state !== DOOR_OPEN) out.push({ item: "open", state: DOOR_OPEN });
  if (state === DOOR_OPEN) out.push({ item: "close", state: DOOR_CLOSED });
  if (state !== DOOR_LOCKED) out.push({ item: "lock", state: DOOR_LOCKED });
  if (state === DOOR_LOCKED) out.push({ item: "unlock", state: DOOR_CLOSED });
  out.push({ item: "delete", state: null });
  return out;
}

// ---------- DM drag hint (FR-SCN-13) ----------

export interface DragHint {
  /** Blocking segments' `n`s. */
  ns: number[];
  to: { col: number; row: number };
  size: number;
}

/** FR-SCN-13: the segments a DM drag crosses (local only; the drop still sends). */
export function dragHint(
  s: StructureView,
  drag: {
    from: { col: number; row: number };
    to: { col: number; row: number };
    size: number;
  } | null,
): DragHint | null {
  if (!drag || !s.full) return null;
  const ns = blockingSegments(drag.from, drag.to, drag.size, s.full.walls, s.full.doors as Door[]);
  return ns.length > 0 ? { ns, to: drag.to, size: drag.size } : null;
}

// ---------- the player's blocked-move cue (FR-SCN-12) ----------

/** How long a drop is watched for a snap back, and how long the cell flashes. */
export const REJECT_WATCH_MS = 3000;
export const FLASH_MS = 1000;

export interface DropWatch {
  tokenId: string;
  to: { col: number; row: number };
  size: number;
  at: number;
  /** The shown token reached the drop cell (the move overlay applied). */
  seen: boolean;
}

/**
 * FR-SCN-12: a drop the client sent shows the token at `to` until the server answers (FR-MAP-15
 * overlay); an ack moves the record there, a reject snaps the shown token back. Fed the token's
 * shown and committed cells on every render: returns the next watch (null = done) and whether the
 * target cell should flash now.
 */
export function watchDrop(
  w: DropWatch | null,
  shown: { col: number; row: number } | null,
  committed: { col: number; row: number } | null,
  now: number,
): { watch: DropWatch | null; flash: boolean } {
  if (!w) return { watch: null, flash: false };
  if (now - w.at > REJECT_WATCH_MS || !shown || !committed) return { watch: null, flash: false };
  const at = (c: { col: number; row: number }) => c.col === w.to.col && c.row === w.to.row;
  if (at(committed)) return { watch: null, flash: false };
  if (at(shown)) return { watch: w.seen ? w : { ...w, seen: true }, flash: false };
  return w.seen ? { watch: null, flash: true } : { watch: w, flash: false };
}
