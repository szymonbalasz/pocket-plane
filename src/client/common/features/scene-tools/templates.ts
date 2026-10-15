// AoE template client logic (SCN FR-SCN-20–27), DOM-free so it runs under `bun test`:
// the gesture → template math (FR-SCN-22), the ephemeral sender (≤ 20 sends/s while dragging,
// repeated every 1 s at rest, `end` on Clear / Esc / Keep; FR-SCN-23), the receivers' store
// (dropped on `end`, on a snapshot or after 3 s of silence; one per sender connection; drawn
// only for the shown scene) and who may edit a kept template (FR-SCN-26).
import type { SignalFrom } from "@shared/protocol/frames";
import { pxToVertex } from "@shared/scene-tools/geometry";
import {
  type AoeTemplateRecord,
  FT_PER_CELL,
  TEMPLATE_ANGLE,
  TEMPLATE_SIZE,
  TEMPLATE_WIDTH,
  type TemplateGeometry,
  type TemplateShape,
  type TemplateSignalData,
} from "@shared/scene-tools/schemas";
import type { Grid } from "@shared/scenes-map/geometry";
import { DRAG_INTERVAL_MS, DRAG_REPEAT_MS, DRAG_TIMEOUT_MS } from "@shared/scenes-map/schemas";
import { createStore, type StoreApi } from "zustand";
import type { LaserTimers } from "../scenes-map/laser";

/** FR-SCN-23: like `map.drag` (≤ 20/s, 1 s repeat at rest, 3 s receiver timeout). */
export const TEMPLATE_INTERVAL_MS = DRAG_INTERVAL_MS;
export const TEMPLATE_REPEAT_MS = DRAG_REPEAT_MS;
export const TEMPLATE_TIMEOUT_MS = DRAG_TIMEOUT_MS;

/** A template as drawn: geometry + label (kept, ephemeral or a local preview). */
export interface TemplateView extends TemplateGeometry {
  label: string;
}

/** The AoE panel's settings (FR-SCN-22). */
export interface AoeSettings {
  shape: TemplateShape;
  size: number;
  width: number;
  label: string;
}

export const DEFAULT_AOE: AoeSettings = {
  shape: "sphere",
  size: 20,
  width: TEMPLATE_WIDTH.default,
  label: "",
};

const norm360 = (a: number) => ((a % 360) + 360) % 360;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** FR-SCN-20: a direction snapped to 15° steps, 0 = east, 90 = south, in 0–345. */
export function snapAngle(dx: number, dy: number): number {
  const deg = norm360((Math.atan2(dy, dx) * 180) / Math.PI);
  return norm360(Math.round(deg / TEMPLATE_ANGLE.step) * TEMPLATE_ANGLE.step);
}

/** FR-SCN-20: a size in ft snapped to 5, within 5–300. */
export function snapSize(ft: number): number {
  const s = Math.round(ft / TEMPLATE_SIZE.step) * TEMPLATE_SIZE.step;
  return clamp(s, TEMPLATE_SIZE.min, TEMPLATE_SIZE.max);
}

export function snapWidth(ft: number): number {
  const w = Math.round(ft / TEMPLATE_WIDTH.step) * TEMPLATE_WIDTH.step;
  return clamp(w, TEMPLATE_WIDTH.min, TEMPLATE_WIDTH.max);
}

/**
 * FR-SCN-22: the template a press at vertex `origin` dragged to map px `(x, y)` makes. Cone and
 * line: direction from the drag; cube: the quadrant dragged into (0 SE, 90 SW, 180 NW, 270 NE);
 * sphere and cylinder: the radius from the drag. Under half a cell of drag keeps the panel's
 * size and the previous direction (`angle`).
 */
export function gestureTemplate(
  s: AoeSettings,
  origin: { x: number; y: number },
  at: { x: number; y: number },
  g: Grid,
  angle = 0,
): TemplateView {
  const dx = (at.x - (g.gridOffsetX + origin.x * g.gridCellSize)) / g.gridCellSize;
  const dy = (at.y - (g.gridOffsetY + origin.y * g.gridCellSize)) / g.gridCellSize;
  const dragged = Math.hypot(dx, dy) >= 0.5;
  const base: TemplateView = {
    shape: s.shape,
    x: origin.x,
    y: origin.y,
    size: s.size,
    width: s.shape === "line" ? s.width : null,
    angle,
    label: s.label,
  };
  if (!dragged) return base;
  if (s.shape === "sphere" || s.shape === "cylinder") {
    return { ...base, size: snapSize(Math.hypot(dx, dy) * FT_PER_CELL), angle: 0 };
  }
  const raw = norm360((Math.atan2(dy, dx) * 180) / Math.PI);
  if (s.shape === "cube") return { ...base, angle: Math.floor(raw / 90) * 90 };
  return { ...base, angle: snapAngle(dx, dy) };
}

/** The vertex nearest a map point (the origin snaps to it, FR-SCN-20). */
export const originAt = (g: Grid, x: number, y: number) => pxToVertex(g, x, y);

/** FR-SCN-21: "‹label› · N squares" (no label: "N squares"). */
export function templateCaption(label: string, n: number): string {
  const squares = `${n} ${n === 1 ? "square" : "squares"}`;
  return label ? `${label} · ${squares}` : squares;
}

/** FR-SCN-26: the DM edits any kept template; a player only one they placed. */
export function canEditTemplate(
  t: Pick<AoeTemplateRecord, "placedByPlayerId">,
  client: "dm" | "player",
  myPlayerId: string | null,
): boolean {
  return client === "dm" || (myPlayerId !== null && t.placedByPlayerId === myPlayerId);
}

/** A `scn.template` place frame (not `end`). */
export type TemplatePlaceFrame = Exclude<TemplateSignalData, { end: true }>;

/** The signal fields of a template (FR-SCN-23); `dmOnly` only when true (DM). */
export function placeFrame(
  sceneId: string,
  key: string,
  t: TemplateView,
  dmOnly: boolean,
): TemplatePlaceFrame {
  return {
    sceneId,
    key,
    shape: t.shape,
    x: t.x,
    y: t.y,
    size: t.size,
    ...(t.shape === "line" ? { width: t.width ?? TEMPLATE_WIDTH.default } : {}),
    angle: t.angle,
    ...(t.label ? { label: t.label } : {}),
    ...(dmOnly ? { dmOnly: true } : {}),
  };
}

// ---------- sender (FR-SCN-23) ----------

const browserTimers: LaserTimers = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as number),
};

/**
 * This connection's ephemeral template: `show` while dragging or after a panel change (≤ 1 per
 * 50 ms, only when it changed), the last frame repeated every 1 s at rest so receivers' 3 s
 * timeout never fires, `end` once. `send` returns false when not live (dropped, never queued).
 */
export class EphemeralSender {
  private last: TemplatePlaceFrame | null = null;
  private pending: TemplatePlaceFrame | null = null;
  private lastSend = Number.NEGATIVE_INFINITY;
  private throttle: unknown = null;
  private repeat: unknown = null;

  constructor(
    private readonly send: (d: TemplateSignalData) => void,
    private readonly timers: LaserTimers = browserTimers,
  ) {}

  /** Whether anything was sent since the last `end` (receivers may show it). */
  get shown(): boolean {
    return this.last !== null;
  }

  show(frame: TemplatePlaceFrame): void {
    if (this.last && this.last.sceneId !== frame.sceneId) this.end();
    this.pending = frame;
    const wait = this.lastSend + TEMPLATE_INTERVAL_MS - this.timers.now();
    if (wait <= 0) this.flush();
    else if (this.throttle === null) {
      this.throttle = this.timers.setTimeout(() => {
        this.throttle = null;
        this.flush();
      }, wait);
    }
  }

  /** Clear / Esc / Keep / tool or scene switch: one `end` if anything was shown. */
  end(): void {
    const last = this.last;
    this.stop();
    if (last) this.send({ sceneId: last.sceneId, key: last.key, end: true });
  }

  /** Not live (FR-SCN-34): stop sending; receivers drop it after 3 s. */
  stop(): void {
    for (const h of [this.throttle, this.repeat]) if (h !== null) this.timers.clearTimeout(h);
    this.throttle = null;
    this.repeat = null;
    this.pending = null;
    this.last = null;
    this.lastSend = Number.NEGATIVE_INFINITY;
  }

  private flush(): void {
    const f = this.pending;
    this.pending = null;
    if (!f || (this.last && JSON.stringify(this.last) === JSON.stringify(f))) return;
    this.emit(f);
  }

  private emit(f: TemplatePlaceFrame): void {
    this.last = f;
    this.lastSend = this.timers.now();
    this.send(f);
    if (this.repeat !== null) this.timers.clearTimeout(this.repeat);
    this.repeat = this.timers.setTimeout(() => {
      this.repeat = null;
      if (this.last) this.emit(this.last);
    }, TEMPLATE_REPEAT_MS);
  }
}

// ---------- receivers (FR-SCN-23) ----------

export interface EphemeralTemplate {
  /** Store key: sender + the frame's `key` (one per sender connection; senders can't clash). */
  id: string;
  sceneId: string;
  role: SignalFrom["role"];
  template: TemplateView;
  dmOnly: boolean;
  /** Receipt time of the last frame (`performance.now()`), for the 3 s timeout. */
  at: number;
}

export interface EphemeralState {
  byId: Record<string, EphemeralTemplate>;
}

export type EphemeralStore = StoreApi<EphemeralState>;

export const createEphemeralStore = (): EphemeralStore =>
  createStore<EphemeralState>()(() => ({ byId: {} }));

const senderOf = (from: SignalFrom) => (from.role === "dm" ? "dm" : `player:${from.playerId}`);

/** A `scn.template` frame: place / replace the sender's template, or drop it on `end`. */
export function receiveTemplate(
  s: EphemeralStore,
  from: SignalFrom,
  d: TemplateSignalData,
  now: number,
): void {
  const id = `${senderOf(from)}:${d.key}`;
  if ("end" in d) {
    if (!(id in s.getState().byId)) return;
    const { [id]: _gone, ...rest } = s.getState().byId;
    s.setState({ byId: rest });
    return;
  }
  const template: TemplateView = {
    shape: d.shape,
    x: d.x,
    y: d.y,
    size: d.size,
    width: d.shape === "line" ? (d.width ?? TEMPLATE_WIDTH.default) : null,
    angle: d.angle,
    label: d.label ?? "",
  };
  s.setState((st) => ({
    byId: {
      ...st.byId,
      [id]: {
        id,
        sceneId: d.sceneId,
        role: from.role,
        template,
        dmOnly: d.dmOnly === true,
        at: now,
      },
    },
  }));
}

/** A snapshot (or leaving live) drops every ephemeral. */
export function resetEphemerals(s: EphemeralStore): void {
  if (Object.keys(s.getState().byId).length > 0) s.setState({ byId: {} });
}

/** Drops ephemerals silent for 3 s; true while any is left. */
export function pruneEphemerals(s: EphemeralStore, now: number): boolean {
  const st = s.getState().byId;
  const keep = Object.values(st).filter((e) => now - e.at < TEMPLATE_TIMEOUT_MS);
  if (keep.length !== Object.keys(st).length) {
    s.setState({ byId: Object.fromEntries(keep.map((e) => [e.id, e])) });
  }
  return keep.length > 0;
}

/** Receivers draw only for the scene they show (FR-SCN-24). */
export function ephemeralsOn(st: EphemeralState, sceneId: string): EphemeralTemplate[] {
  return Object.values(st.byId).filter((e) => e.sceneId === sceneId);
}

// ---------- drawing (FR-SCN-20) ----------

export type TemplateOutline =
  | { kind: "circle"; x: number; y: number; r: number }
  | { kind: "poly"; points: number[] };

/** The shape's outline in map px (the affected squares are drawn from `templateCells`). */
export function templateOutline(t: TemplateGeometry, g: Grid): TemplateOutline {
  const cs = g.gridCellSize;
  const ox = g.gridOffsetX + t.x * cs;
  const oy = g.gridOffsetY + t.y * cs;
  const L = (t.size / FT_PER_CELL) * cs;
  if (t.shape === "sphere" || t.shape === "cylinder") return { kind: "circle", x: ox, y: oy, r: L };
  if (t.shape === "cube") {
    const q = Math.floor(norm360(t.angle) / 90);
    const sx = q === 0 || q === 3 ? 1 : -1;
    const sy = q === 0 || q === 1 ? 1 : -1;
    return {
      kind: "poly",
      points: [ox, oy, ox + sx * L, oy, ox + sx * L, oy + sy * L, ox, oy + sy * L],
    };
  }
  const rad = (norm360(t.angle) * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  // Normal (perpendicular) to the direction.
  const nx = -uy;
  const ny = ux;
  const ex = ox + ux * L;
  const ey = oy + uy * L;
  if (t.shape === "cone") {
    const h = L / 2;
    return { kind: "poly", points: [ox, oy, ex + nx * h, ey + ny * h, ex - nx * h, ey - ny * h] };
  }
  const h = (((t.width ?? TEMPLATE_WIDTH.default) / FT_PER_CELL) * cs) / 2;
  return {
    kind: "poly",
    points: [
      ox + nx * h,
      oy + ny * h,
      ex + nx * h,
      ey + ny * h,
      ex - nx * h,
      ey - ny * h,
      ox - nx * h,
      oy - ny * h,
    ],
  };
}
