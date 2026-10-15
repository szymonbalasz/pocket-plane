// Pure structure logic both clients and the Structure tool use (FR-SCN-08, -09, -12, -13, -14):
// the drawn view of a DM or player `scene-structure` record, segment hit tests in map px, the
// polyline → segments rule, door state toggles and menu items, and the player's reject watch
// (a refused move snaps the shown token back from its drop cell → flash that cell). DOM-free.

import {
  blockingSegments,
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

/** FR-SCN-08 Erase: the nearest wall or door within `tol` map px of `p`, or null. */
export function hitSegment(
  s: StructureView,
  g: Grid,
  p: { x: number; y: number },
  tol: number,
): number | null {
  let best: { n: number; d: number } | null = null;
  const all: [number, Segment][] = [
    ...s.walls.map((w): [number, Segment] => [w[0], [w[1], w[2], w[3], w[4]]]),
    ...s.doors.map((d): [number, Segment] => [d.n, d.seg]),
  ];
  for (const [n, seg] of all) {
    const d = distToSegment(p, segmentPx(g, seg));
    if (d <= tol && (!best || d < best.d)) best = { n, d };
  }
  return best?.n ?? null;
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

const sameVertex = (a: Vertex, b: Vertex) => a.x === b.x && a.y === b.y;

/** Adds a clicked vertex to a polyline: a repeat of the last one is ignored; ≤ 200 segments. */
export function addPoint(points: readonly Vertex[], v: Vertex): Vertex[] {
  const last = points.at(-1);
  if (last && sameVertex(last, v)) return [...points];
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
    if (sameVertex(a, b)) continue;
    const seg: Segment = [a.x, a.y, b.x, b.y];
    const key = segmentKey(seg);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(seg);
  }
  return out.slice(0, ADD_WALLS_MAX);
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
