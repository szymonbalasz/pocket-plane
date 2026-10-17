// Fog tool gestures (FR-FOG-17–19, -22, -41, -42) as a pure state machine; the tool (`store.ts`)
// feeds it stage pointer events and keys, and sends what it returns. Points are grid units
// (corner (i, j) = map point `offset + (i, j) × cellSize`); they snap to the nearest grid corner
// unless **Ctrl** is held (read on every event: free, rounded to 0.01).
// - Rectangle: drag corner to corner, release sends; < 4 px (or no area) = the cell under the press.
// - Polygon: a click adds a vertex; < 4 px from the last click ignored; crossing refused; Enter, a
//   double-click or a click on the first vertex closes (≥ 3); Backspace drops the last; 64 max.
// - Circle: press = centre, drag = radius in whole cells (free with Ctrl); < 4 px → 1 cell.
// - Darkness mode: a press on a darkness shape selects it and drags it (whole cells, free with
//   Ctrl) → move on release; Delete / Backspace removes the selected one; drawing starts only on
//   empty space.
// - Brush (sprint 4, FR-FOG-55; `brush.ts`): the press starts a stroke (free iff Ctrl is held at
//   the press), moves paint it, release sends it; strokes completed mid-drag are sent at once.
//   Sent strokes stay drawn (`strokes`) until their event or reject; a new one may start meanwhile.
// A sent shape / move stays drawn (`pending`) until its event or reject. DOM-free (`bun test`).
import { FOG_VERTICES_MAX, FOG_VERTICES_MIN } from "@shared/fog-of-war/schemas";
import {
  CIRCLE_R_MAX,
  CIRCLE_R_MIN,
  type DarknessShape,
  type FogBrushGeom,
  type FogShapeGeom,
  type ShapeLike,
  shapeContains,
  shapeProblem,
} from "@shared/fog-of-war/shapes";
import type { DiagonalRule } from "@shared/scene-tools/schemas";
import { isClick } from "../scenes-map/selection-logic";
import type { ToolCancelReason } from "../scenes-map/tools";
import { BRUSH_FT, type BrushDraft, brushShape, extendBrush, startBrush } from "./brush";

export type FogShapeMode = "rect" | "polygon" | "circle" | "brush";
/** A point in grid units. */
export type Pt = readonly [number, number];
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
  a: Pt;
  b: Pt;
  free: boolean;
}
export interface CircleDraft {
  kind: "circle";
  c: Pt;
  r: number;
  free: boolean;
}
export interface Vertex {
  p: Pt;
  free: boolean;
  /** Screen px where it was placed (a click near the first vertex closes, FR-FOG-19). */
  screen: Screen;
}
export interface PolygonDraft {
  kind: "polygon";
  points: readonly Vertex[];
  /** The point under the pointer: the rubber-band edge from the last vertex. */
  hover: Pt | null;
}
export type FogDraft = RectDraft | CircleDraft | PolygonDraft | BrushDraft;

/** FR-FOG-42: a darkness shape being dragged (offset in grid units). */
export interface DarknessMove {
  id: string;
  from: Pt;
  dx: number;
  dy: number;
  pending: boolean;
}

export interface GestureState {
  /** The shape being drawn, or (`pending`) the one sent and awaiting its event or reject. */
  draft: FogDraft | null;
  pending: boolean;
  /** The current left press. */
  press: { screen: Screen; at: Pt; cell: Cell; clicks: number } | null;
  /** Polygon: screen px of the click that placed the last vertex (< 4 px from it: ignored). */
  lastClick: Screen | null;
  /** FR-FOG-42: the selected darkness shape and a drag of it. */
  selected: string | null;
  move: DarknessMove | null;
  /** Ctrl held on the latest event (the "Free" chip, FOG §7). */
  free: boolean;
  /** FR-FOG-55: brush strokes sent and awaiting their event or reject (drawn meanwhile). */
  strokes: readonly BrushDraft[];
}

export const idleGesture: GestureState = {
  draft: null,
  pending: false,
  press: null,
  lastClick: null,
  selected: null,
  move: null,
  free: false,
  strokes: [],
};

/** What a stage pointer event gives the gesture (from a `ToolPointer`). */
export interface GesturePoint {
  /** Pointer position in grid units (unsnapped). */
  at: Pt;
  cell: Cell;
  screen: Screen;
  /** Click count of a press (2 = double-click). */
  clicks: number;
  ctrl: boolean;
}

/** The tool's choices and the shown scene's darkness (hit tests in Darkness mode). */
export interface GestureMode {
  shape: FogShapeMode;
  darkness: readonly DarknessShape[] | null;
  /** FR-FOG-55: the brush radius (ft) and the campaign's diagonal rule (default 10 ft, 5/10/5). */
  brush?: { ft: number; rule: DiagonalRule };
}

export type GestureHint = "crossing" | "zero-area" | "max";

/** FR-FOG-19: Tooltip copy for a refused vertex or close. */
export const GESTURE_HINTS: Record<GestureHint, string> = {
  crossing: "Edges can't cross",
  "zero-area": "The shape has no area",
  max: `${FOG_VERTICES_MAX} corners at most`,
};

/** What to send: a drawn shape (fog edit or darkness place), a darkness move or remove. */
export type GestureSend =
  | { kind: "shape"; shape: FogShapeGeom }
  | { kind: "move"; id: string; dx: number; dy: number }
  | { kind: "remove"; id: string }
  /** FR-FOG-55: brush strokes, each one `fog.edit`, settled by its draft. */
  | { kind: "brush"; strokes: { draft: BrushDraft; shape: FogBrushGeom }[] };

export interface GestureStep {
  state: GestureState;
  send?: GestureSend;
  hint?: GestureHint;
}

const r2 = (v: number) => Math.round(v * 100) / 100;
/** FR-FOG-18 / -19 / -41: nearest grid corner, or free (0.01) with Ctrl. */
export const snap = (p: Pt, free: boolean): Pt =>
  free ? [r2(p[0]), r2(p[1])] : [Math.round(p[0]), Math.round(p[1])];
const same = (a: Pt, b: Pt) => a[0] === b[0] && a[1] === b[1];
/** Screen px within which a click on the first vertex closes the polygon. */
const CLOSE_PX = 8;

/** FR-FOG-41: the radius from a drag: whole cells (≥ 1), or free (0.01) with Ctrl; ≤ 60. */
export function circleRadius(c: Pt, p: Pt, free: boolean): number {
  const d = Math.hypot(p[0] - c[0], p[1] - c[1]);
  const r = free ? r2(d) : Math.max(1, Math.round(d));
  return Math.min(CIRCLE_R_MAX, Math.max(CIRCLE_R_MIN, r));
}

/** FR-FOG-41: the radius label, "15 ft" (whole cells) or "≈ 11 ft" (free). */
export function radiusLabel(r: number, free: boolean): string {
  const ft = Math.round(r * 5);
  return free ? `≈ ${ft} ft` : `${ft} ft`;
}

/** The shape a draft sends (not a brush stroke: `brushShape`). */
export function draftShape(d: RectDraft | CircleDraft | PolygonDraft): FogShapeGeom {
  if (d.kind === "rect") return { rect: [d.a[0], d.a[1], d.b[0], d.b[1]] };
  if (d.kind === "circle") return { circle: [d.c[0], d.c[1], d.r] };
  return { polygon: d.points.flatMap((v) => [v.p[0], v.p[1]]) };
}

const cellRect = (c: Cell): RectDraft => ({
  kind: "rect",
  a: [c.col, c.row],
  b: [c.col + 1, c.row + 1],
  free: false,
});

/** 1/100-cell integers: exact orientation tests for the open chain. */
const S = (p: Pt): Pt => [Math.round(p[0] * 100), Math.round(p[1] * 100)];
const cross = (o: Pt, a: Pt, b: Pt) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
const within = (p: Pt, a: Pt, b: Pt) =>
  Math.min(a[0], b[0]) <= p[0] &&
  p[0] <= Math.max(a[0], b[0]) &&
  Math.min(a[1], b[1]) <= p[1] &&
  p[1] <= Math.max(a[1], b[1]);

/** Closed segments ab and cd share a point. */
function touch(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
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
 * FR-FOG-19: would the edge from the open chain's last vertex to `v` cross the chain? It may meet
 * its neighbour edge only at the shared vertex (no doubling back); no other edge at all.
 */
export function edgeCrosses(chain: readonly Pt[], to: Pt): boolean {
  const points = chain.map(S);
  const v = S(to);
  const n = points.length;
  if (n === 0) return false;
  const last = points[n - 1] as Pt;
  for (let k = 0; k < n - 1; k++) {
    const a = points[k] as Pt;
    const b = points[k + 1] as Pt;
    if (k === n - 2) {
      if (cross(a, last, v) === 0 && (within(v, a, last) || within(a, last, v))) return true;
      continue;
    }
    if (touch(a, b, last, v)) return true;
  }
  return false;
}

const openPolygon = (s: GestureState): readonly Vertex[] =>
  s.draft?.kind === "polygon" && !s.pending ? s.draft.points : [];

/** FR-FOG-19: close the open polygon (≥ 3 vertices) and send it, or refuse with a hint. */
export function closePolygon(s: GestureState): GestureStep {
  const points = openPolygon(s);
  if (points.length < FOG_VERTICES_MIN) return { state: s };
  const draft: PolygonDraft = { kind: "polygon", points, hover: null };
  const shape = draftShape(draft);
  const problem = shapeProblem(shape);
  if (problem) return { state: s, hint: problem };
  return {
    state: { ...s, draft, pending: true, press: null },
    send: { kind: "shape", shape },
  };
}

/** FR-FOG-19: one click (no drag) at `v`. */
function polygonClick(
  s: GestureState,
  v: Pt,
  free: boolean,
  screen: Screen,
  clicks: number,
): GestureStep {
  const points = openPolygon(s);
  const n = points.length;
  const first = points[0];
  const onFirst =
    first !== undefined &&
    (same(v, first.p) ||
      Math.hypot(screen.x - first.screen.x, screen.y - first.screen.y) <= CLOSE_PX);
  if (n >= FOG_VERTICES_MIN && (clicks >= 2 || onFirst)) return closePolygon(s);
  if (n > 0) {
    if (same(v, (points[n - 1] as Vertex).p)) return { state: s };
    if (s.lastClick && isClick(screen.x - s.lastClick.x, screen.y - s.lastClick.y)) {
      return { state: s };
    }
  }
  if (n >= FOG_VERTICES_MAX) return { state: s, hint: "max" };
  if (
    edgeCrosses(
      points.map((x) => x.p),
      v,
    )
  ) {
    return { state: s, hint: "crossing" };
  }
  return {
    state: {
      ...s,
      draft: { kind: "polygon", points: [...points, { p: v, free, screen }], hover: null },
      pending: false,
      lastClick: screen,
    },
  };
}

/** FR-FOG-42: the topmost darkness shape under the pointer. */
export function darknessAt(darkness: readonly DarknessShape[], p: Pt): DarknessShape | null {
  for (let i = darkness.length - 1; i >= 0; i--) {
    const d = darkness[i] as DarknessShape;
    if (shapeContains(d as ShapeLike, p[0], p[1])) return d;
  }
  return null;
}

/** Left press on the stage (not while Space pans). */
export function gestureDown(s: GestureState, m: GestureMode, p: GesturePoint): GestureStep {
  const press = { screen: p.screen, at: p.at, cell: p.cell, clicks: p.clicks };
  const base = { ...s, press, free: p.ctrl };
  if (m.darkness && openPolygon(s).length === 0) {
    const hit = darknessAt(m.darkness, p.at);
    if (hit) {
      const move: DarknessMove = { id: hit.id, from: p.at, dx: 0, dy: 0, pending: false };
      return { state: { ...base, selected: hit.id, move } };
    }
  }
  const next = { ...base, selected: null };
  if (m.shape === "brush") {
    const { ft, rule } = m.brush ?? { ft: BRUSH_FT.default, rule: "5-10-5" };
    const draft = startBrush(p.at, ft, p.ctrl, rule);
    return { state: { ...next, draft, pending: false } };
  }
  if (m.shape === "rect") {
    const a = snap(p.at, p.ctrl);
    return { state: { ...next, draft: { kind: "rect", a, b: a, free: p.ctrl }, pending: false } };
  }
  if (m.shape === "circle") {
    const c = snap(p.at, p.ctrl);
    return { state: { ...next, draft: { kind: "circle", c, r: 1, free: p.ctrl }, pending: false } };
  }
  return { state: next };
}

/** Any pointer move over the stage: drafts and darkness drags follow; the polygon's band too. */
export function gestureMove(s: GestureState, m: GestureMode, p: GesturePoint): GestureStep {
  const free = p.ctrl;
  const st = s.free === free ? s : { ...s, free };
  const mv = s.move;
  if (mv && s.press && !mv.pending) {
    const dx = p.at[0] - mv.from[0];
    const dy = p.at[1] - mv.from[1];
    const [sx, sy] = free ? [r2(dx), r2(dy)] : [Math.round(dx), Math.round(dy)];
    if (sx === mv.dx && sy === mv.dy) return { state: st };
    return { state: { ...st, move: { ...mv, dx: sx, dy: sy } } };
  }
  const d = s.draft;
  if (!d || s.pending) return { state: st };
  if (d.kind === "brush" && s.press) {
    const { draft, sent } = extendBrush(d, p.at);
    if (draft === d) return { state: st };
    return sendStrokes({ ...st, draft }, sent);
  }
  if (d.kind === "rect" && s.press && m.shape === "rect") {
    const b = snap(p.at, free);
    if (same(b, d.b) && d.free === free) return { state: st };
    return { state: { ...st, draft: { ...d, b, free } } };
  }
  if (d.kind === "circle" && s.press && m.shape === "circle") {
    const r = circleRadius(d.c, p.at, free);
    if (r === d.r && d.free === free) return { state: st };
    return { state: { ...st, draft: { ...d, r, free } } };
  }
  if (d.kind === "polygon" && d.points.length > 0) {
    const v = snap(p.at, free);
    if (d.hover && same(d.hover, v)) return { state: st };
    return { state: { ...st, draft: { ...d, hover: v } } };
  }
  return { state: st };
}

/** Moves completed brush strokes to `strokes` and sends them (empty ones are dropped). */
function sendStrokes(s: GestureState, done: readonly BrushDraft[]): GestureStep {
  const strokes = done.flatMap((draft) => {
    const shape = brushShape(draft);
    return shape ? [{ draft, shape }] : [];
  });
  if (strokes.length === 0) return { state: s };
  return {
    state: { ...s, strokes: [...s.strokes, ...strokes.map((x) => x.draft)] },
    send: { kind: "brush", strokes },
  };
}

/** Release of a press this tool received. */
export function gestureUp(s: GestureState, m: GestureMode, p: GesturePoint): GestureStep {
  const press = s.press;
  if (!press) return { state: s };
  const click = isClick(p.screen.x - press.screen.x, p.screen.y - press.screen.y);
  const released = { ...s, press: null, free: p.ctrl };
  const mv = s.move;
  if (mv && !mv.pending) {
    if (click || (mv.dx === 0 && mv.dy === 0)) return { state: { ...released, move: null } };
    return {
      state: { ...released, move: { ...mv, pending: true } },
      send: { kind: "move", id: mv.id, dx: mv.dx, dy: mv.dy },
    };
  }
  const d = s.draft;
  if (d?.kind === "brush") return sendStrokes({ ...released, draft: null }, [d]);
  if (m.shape === "rect" && d?.kind === "rect" && !s.pending) {
    let draft: RectDraft = click
      ? cellRect(press.cell)
      : { ...d, b: snap(p.at, p.ctrl), free: p.ctrl };
    if (shapeProblem(draftShape(draft))) draft = cellRect(press.cell);
    return {
      state: { ...released, draft, pending: true },
      send: { kind: "shape", shape: draftShape(draft) },
    };
  }
  if (m.shape === "circle" && d?.kind === "circle" && !s.pending) {
    const draft: CircleDraft = click
      ? { ...d, r: 1 }
      : { ...d, r: circleRadius(d.c, p.at, p.ctrl), free: p.ctrl || d.free };
    return {
      state: { ...released, draft, pending: true },
      send: { kind: "shape", shape: draftShape(draft) },
    };
  }
  if (m.shape !== "polygon" || !click) return { state: released };
  return polygonClick(released, snap(press.at, p.ctrl), p.ctrl, press.screen, press.clicks);
}

/**
 * Keys (via `useBaseKeyDown`): Enter closes the polygon; Backspace drops its last vertex; with no
 * polygon open, Delete / Backspace removes the selected darkness shape (FR-FOG-42).
 */
export function gestureKey(s: GestureState, key: string): GestureStep | null {
  if (key === "Enter") return openPolygon(s).length > 0 ? closePolygon(s) : null;
  if (key !== "Backspace" && key !== "Delete") return null;
  const points = openPolygon(s);
  if (points.length === 0) {
    if (s.selected === null || s.move?.pending) return null;
    return {
      state: { ...s, selected: null, move: null },
      send: { kind: "remove", id: s.selected },
    };
  }
  if (key === "Delete") return null;
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
 * FR-FOG-18 / -22: Esc drops the gesture in progress (a sent shape or move stays until it
 * settles), else the darkness selection; leaving `live`, a scene or tool switch and unmount drop
 * everything. `dropped` = something was dropped.
 */
export function gestureCancel(
  s: GestureState,
  reason: ToolCancelReason,
): { state: GestureState; dropped: boolean } {
  const drawing = s.press !== null || (s.draft !== null && !s.pending);
  const dragging = s.move !== null && !s.move.pending;
  const dropped = drawing || dragging || s.selected !== null;
  if (reason !== "escape") return { state: idleGesture, dropped };
  if (!dropped) return { state: s, dropped };
  const kept = {
    ...idleGesture,
    strokes: s.strokes,
    ...(s.pending ? { draft: s.draft, pending: true } : {}),
    ...(s.move?.pending ? { move: s.move } : {}),
  };
  if (drawing || dragging) {
    return { state: { ...kept, selected: dragging ? s.selected : null }, dropped };
  }
  return { state: kept, dropped };
}

/** The sent shape's or move's event or reject arrived: its draft goes (a newer one stays). */
export function gestureSettled(
  s: GestureState,
  sent: FogDraft | DarknessMove | null,
): GestureState {
  if (sent !== null && "id" in sent) {
    return s.move === sent ? { ...s, move: null } : s;
  }
  if (sent?.kind === "brush") {
    return s.strokes.includes(sent) ? { ...s, strokes: s.strokes.filter((x) => x !== sent) } : s;
  }
  return s.pending && s.draft === sent ? { ...s, draft: null, pending: false } : s;
}
