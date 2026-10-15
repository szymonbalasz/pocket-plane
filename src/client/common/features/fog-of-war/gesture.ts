// Fog tool gestures (FR-FOG-17–19, -22) as a pure state machine; the tool (`tool.ts`) feeds it
// stage pointer events and keys, and sends what it returns. Rectangle: left-drag cell to cell,
// release sends, < 4 px = the press cell. Polygon: a click (< 4 px of travel) adds the nearest grid
// corner; Enter, a double-click or a click on the first corner closes (≥ 3) and sends; Backspace
// drops the last corner; a corner whose edge would cross another is refused; 64 at most. A sent
// shape stays drawn (`pending`) until its event or reject. DOM-free so it runs under `bun test`.
import { polygonProblem } from "@shared/fog-of-war/raster";
import { FOG_VERTICES_MAX, FOG_VERTICES_MIN, type FogShape } from "@shared/fog-of-war/schemas";
import { isClick } from "../scenes-map/selection-logic";
import type { ToolCancelReason } from "../scenes-map/tools";

export type FogShapeMode = "rect" | "polygon";
/** A grid corner `[i, j]`: map point `(offsetX + i·cellSize, offsetY + j·cellSize)`. */
export type Corner = readonly [number, number];
export interface Cell {
  col: number;
  row: number;
}
export interface Screen {
  x: number;
  y: number;
}

export interface RectDraft {
  kind: "rect";
  c0: number;
  r0: number;
  c1: number;
  r1: number;
}
export interface PolygonDraft {
  kind: "polygon";
  points: readonly Corner[];
  /** The corner under the pointer: the rubber-band edge from the last corner. */
  hover: Corner | null;
}
export type FogDraft = RectDraft | PolygonDraft;

export interface GestureState {
  /** The shape being drawn, or (`pending`) the one sent and awaiting its event or reject. */
  draft: FogDraft | null;
  pending: boolean;
  /** The current left press. */
  press: { screen: Screen; cell: Cell; vertex: Corner; clicks: number } | null;
  /** Polygon: screen px of the click that placed the last corner (< 4 px from it: ignored). */
  lastClick: Screen | null;
}

export const idleGesture: GestureState = {
  draft: null,
  pending: false,
  press: null,
  lastClick: null,
};

/** What a stage pointer event gives the gesture (a `ToolPointer` subset). */
export interface GesturePoint {
  cell: Cell;
  /** Nearest grid corner, as indices (`pxToVertex`). */
  vertex: { x: number; y: number };
  screen: Screen;
  /** Click count of a press (2 = double-click). */
  clicks: number;
}

export type GestureHint = "crossing" | "zero-area" | "max";

/** FR-FOG-19: Tooltip copy for a refused corner or close. */
export const GESTURE_HINTS: Record<GestureHint, string> = {
  crossing: "Edges can't cross",
  "zero-area": "The shape has no area",
  max: `${FOG_VERTICES_MAX} corners at most`,
};

export interface GestureStep {
  state: GestureState;
  /** A finished shape to send as `fog.edit`. */
  send?: FogShape;
  hint?: GestureHint;
}

const same = (a: Corner, b: Corner) => a[0] === b[0] && a[1] === b[1];
const cornerOf = (v: { x: number; y: number }): Corner => [v.x, v.y];

const cross = (o: Corner, a: Corner, b: Corner) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

const within = (p: Corner, a: Corner, b: Corner) =>
  Math.min(a[0], b[0]) <= p[0] &&
  p[0] <= Math.max(a[0], b[0]) &&
  Math.min(a[1], b[1]) <= p[1] &&
  p[1] <= Math.max(a[1], b[1]);

/** Closed segments ab and cd share a point. */
function touch(a: Corner, b: Corner, c: Corner, d: Corner): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  return (
    (d1 === 0 && within(a, c, d)) ||
    (d2 === 0 && within(b, c, d)) ||
    (d3 === 0 && within(c, a, b)) ||
    (d4 === 0 && within(d, a, b))
  );
}

/**
 * FR-FOG-19: would the edge from the open chain's last corner to `v` cross the chain? It may meet
 * its neighbour edge only at the shared corner (no doubling back); no other edge at all.
 */
export function edgeCrosses(points: readonly Corner[], v: Corner): boolean {
  const n = points.length;
  if (n === 0) return false;
  const last = points[n - 1] as Corner;
  for (let k = 0; k < n - 1; k++) {
    const a = points[k] as Corner;
    const b = points[k + 1] as Corner;
    if (k === n - 2) {
      // Neighbour edge a→last: collinear overlap beyond `last` = doubling back.
      if (cross(a, last, v) === 0 && (within(v, a, last) || within(a, last, v))) return true;
      continue;
    }
    if (touch(a, b, last, v)) return true;
  }
  return false;
}

const openPolygon = (s: GestureState): readonly Corner[] =>
  s.draft?.kind === "polygon" && !s.pending ? s.draft.points : [];

/** FR-FOG-19: close the open polygon (≥ 3 corners) and send it, or refuse with a hint. */
export function closePolygon(s: GestureState): GestureStep {
  const points = openPolygon(s);
  if (points.length < FOG_VERTICES_MIN) return { state: s };
  const problem = polygonProblem(points);
  if (problem) return { state: s, hint: problem };
  const shape: FogShape = { kind: "polygon", points: points.map((p) => [p[0], p[1]]) };
  return {
    state: { ...s, draft: { kind: "polygon", points, hover: null }, pending: true, press: null },
    send: shape,
  };
}

/** FR-FOG-19: one click (no drag) at corner `v`. */
function polygonClick(s: GestureState, v: Corner, screen: Screen, clicks: number): GestureStep {
  const points = openPolygon(s);
  const n = points.length;
  if (n >= FOG_VERTICES_MIN && (clicks >= 2 || same(v, points[0] as Corner))) {
    return closePolygon(s);
  }
  if (n > 0) {
    if (same(v, points[n - 1] as Corner)) return { state: s };
    if (s.lastClick && isClick(screen.x - s.lastClick.x, screen.y - s.lastClick.y)) {
      return { state: s };
    }
  }
  if (n >= FOG_VERTICES_MAX) return { state: s, hint: "max" };
  if (edgeCrosses(points, v)) return { state: s, hint: "crossing" };
  return {
    state: {
      ...s,
      draft: { kind: "polygon", points: [...points, v], hover: null },
      pending: false,
      lastClick: screen,
    },
  };
}

/** Left press on the stage (not while Space pans). */
export function gestureDown(s: GestureState, mode: FogShapeMode, p: GesturePoint): GestureStep {
  const press = { screen: p.screen, cell: p.cell, vertex: cornerOf(p.vertex), clicks: p.clicks };
  if (mode === "rect") {
    const { col, row } = p.cell;
    const draft: RectDraft = { kind: "rect", c0: col, r0: row, c1: col, r1: row };
    return { state: { ...s, draft, pending: false, press } };
  }
  return { state: { ...s, press } };
}

/** Any pointer move over the stage: the rectangle follows; the polygon's rubber band follows. */
export function gestureMove(s: GestureState, mode: FogShapeMode, p: GesturePoint): GestureStep {
  const d = s.draft;
  if (mode === "rect") {
    if (!s.press || d?.kind !== "rect" || s.pending) return { state: s };
    if (d.c1 === p.cell.col && d.r1 === p.cell.row) return { state: s };
    return { state: { ...s, draft: { ...d, c1: p.cell.col, r1: p.cell.row } } };
  }
  if (d?.kind !== "polygon" || s.pending || d.points.length === 0) return { state: s };
  const v = cornerOf(p.vertex);
  if (d.hover && same(d.hover, v)) return { state: s };
  return { state: { ...s, draft: { ...d, hover: v } } };
}

/** Release of a press this tool received. */
export function gestureUp(s: GestureState, mode: FogShapeMode, p: GesturePoint): GestureStep {
  const press = s.press;
  if (!press) return { state: s };
  const click = isClick(p.screen.x - press.screen.x, p.screen.y - press.screen.y);
  const released = { ...s, press: null };
  if (mode === "rect") {
    const end = click ? press.cell : p.cell;
    const shape: FogShape = {
      kind: "rect",
      c0: press.cell.col,
      r0: press.cell.row,
      c1: end.col,
      r1: end.row,
    };
    const draft: RectDraft = {
      kind: "rect",
      c0: shape.c0,
      r0: shape.r0,
      c1: shape.c1,
      r1: shape.r1,
    };
    return { state: { ...released, draft, pending: true }, send: shape };
  }
  // Polygon: a drag adds nothing.
  if (!click) return { state: released };
  return polygonClick(released, press.vertex, press.screen, press.clicks);
}

/** FR-FOG-19 keys (via `useBaseKeyDown`): Enter closes, Backspace drops the last corner. */
export function gestureKey(s: GestureState, key: string): GestureStep | null {
  if (key === "Enter") return openPolygon(s).length > 0 ? closePolygon(s) : null;
  if (key !== "Backspace") return null;
  const points = openPolygon(s);
  if (points.length === 0) return null;
  const rest = points.slice(0, -1);
  return {
    state: {
      ...s,
      draft: rest.length > 0 ? { kind: "polygon", points: rest, hover: null } : null,
      lastClick: null,
    },
  };
}

/**
 * FR-FOG-18/22: Esc drops the gesture in progress (a sent shape stays until it settles); leaving
 * `live`, a scene or tool switch and unmount drop everything. `dropped` = a gesture was in progress.
 */
export function gestureCancel(
  s: GestureState,
  reason: ToolCancelReason,
): { state: GestureState; dropped: boolean } {
  const dropped = s.press !== null || (s.draft !== null && !s.pending);
  if (reason !== "escape") return { state: idleGesture, dropped };
  if (!dropped) return { state: s, dropped };
  return {
    state: s.pending ? { ...idleGesture, draft: s.draft, pending: true } : idleGesture,
    dropped,
  };
}

/** The sent shape's event or reject arrived: its draft goes (a newer one stays). */
export function gestureSettled(s: GestureState, sent: FogDraft | null): GestureState {
  return s.pending && s.draft === sent ? { ...s, draft: null, pending: false } : s;
}
