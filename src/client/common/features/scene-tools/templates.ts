// AoE template client logic (SCN FR-SCN-20–27, -41–45), DOM-free so it runs under `bun test`:
// the gesture → template math (FR-SCN-22; snapped unless Ctrl, FR-SCN-43), the kept template's
// origin / end handles (FR-SCN-45), the Clear templates scope (FR-SCN-44), the ephemeral sender
// (≤ 20 sends/s while dragging, repeated every 1 s at rest, `end` on Clear / Esc / Keep;
// FR-SCN-23), the receivers' store (dropped on `end`, on a snapshot or after 3 s of silence; one
// per sender connection; drawn only for the shown scene), who may edit a kept template
// (FR-SCN-26), the right-click menu's hit test and items (FR-SCN-48, -49) and the label hover
// (FR-SCN-52).
import type { SignalFrom } from "@shared/protocol/frames";
import type { RecordStore } from "@shared/protocol/store";
import {
  FT_PER_CELL,
  TEMPLATE_SIZE,
  TEMPLATE_WIDTH,
  type TemplateGeometry,
  type TemplateRecordView,
  type TemplateShape,
  type TemplateSignalData,
} from "@shared/scene-tools/schemas";
import { contains, snapAngle, templateArea } from "@shared/scenes-map/area";
import type { Grid } from "@shared/scenes-map/geometry";
import { DRAG_INTERVAL_MS, DRAG_REPEAT_MS, DRAG_TIMEOUT_MS } from "@shared/scenes-map/schemas";
import { createStore, type StoreApi } from "zustand";
import type { ReadVar } from "../campaign-management/colors";
import type { LaserTimers } from "../scenes-map/laser";
import { type MarkPerson, markColor } from "../scenes-map/mark-colors";
import { type AoeOrigin, aoeOrigin, type SnapOptions } from "./aoe-snap";

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

/** A point in grid units (vertex = integers; FR-SCN-20 origins have ≤ 2 decimals). */
export interface GridPoint {
  x: number;
  y: number;
}

/** Map px → grid units. */
export function gridPoint(g: Grid, x: number, y: number): GridPoint {
  return { x: (x - g.gridOffsetX) / g.gridCellSize, y: (y - g.gridOffsetY) / g.gridCellSize };
}

/** Grid units → map px. */
export function mapPx(g: Grid, p: GridPoint): GridPoint {
  return { x: g.gridOffsetX + p.x * g.gridCellSize, y: g.gridOffsetY + p.y * g.gridCellSize };
}

/**
 * FR-SCN-20 / -43: the template angle a drag direction `(dx, dy)` aims (0 = east, 90 = south):
 * the direction itself for cones and lines; for a cube, its diagonal (the far corner follows the
 * pointer, so sides run along `angle` and `angle + 90°`). 15° steps, or 0.1° with Ctrl.
 */
export function aimAngle(dx: number, dy: number, shape: TemplateShape, free: boolean): number {
  const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  return snapAngle(shape === "cube" ? deg - 45 : deg, free);
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
 * FR-SCN-22 / -43: the template a press at `press` (grid units, raw) with its origin at `origin`
 * (already snapped, `aoeOrigin`) dragged to map px `at` makes. Cone and line: direction from the
 * origin to the pointer; cube: its diagonal toward the pointer; sphere and cylinder: the radius
 * from the origin to the pointer (5-ft steps). Snapped to 15° unless `free` (Ctrl, 0.1°). Under
 * half a cell of drag from the press keeps the panel's size and the previous direction (`angle`).
 */
export function gestureTemplate(
  s: AoeSettings,
  origin: GridPoint & { footprint?: number },
  at: GridPoint,
  g: Grid,
  angle = 0,
  free = false,
  press: GridPoint = origin,
): TemplateView {
  const p = gridPoint(g, at.x, at.y);
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  const dragged = Math.hypot(p.x - press.x, p.y - press.y) >= 0.5;
  const base: TemplateView = {
    shape: s.shape,
    x: origin.x,
    y: origin.y,
    size: s.size,
    width: s.shape === "line" ? s.width : null,
    angle,
    ...(origin.footprint ? { footprint: origin.footprint } : {}),
    label: s.label,
  };
  if (!dragged) return base;
  if (s.shape === "sphere" || s.shape === "cylinder") {
    return { ...base, size: radiusAt(Math.hypot(dx, dy), base), angle: 0 };
  }
  return { ...base, angle: aimAngle(dx, dy, s.shape, free) };
}

/** #377: half the origin block's side (cells): a snapped sphere's edge lies that much further out. */
const halfBlock = (t: TemplateGeometry) => (t.footprint ? t.footprint / 2 : 0);

/** FR-SCN-22 / -45: the radius (5-ft steps) whose drawn edge lies `d` cells from the origin. */
const radiusAt = (d: number, t: TemplateGeometry) =>
  snapSize(Math.max(0, d - halfBlock(t)) * FT_PER_CELL);

// ---------- handles (FR-SCN-45) ----------

/** Hit radius of a handle, in cells (≈ 21 px at a 70 px cell). */
export const HANDLE_HIT = 0.3;
/** A move shorter than this (cells) keeps the origin: a click on the handle only selects. */
export const MOVE_MIN = 0.1;

export type HandleKind = "origin" | "end";

/** Unit vector of a screen angle; exact at multiples of 90° (as the area helper). */
function unit(deg: number): [number, number] {
  const a = norm360(deg);
  if (a === 0) return [1, 0];
  if (a === 90) return [0, 1];
  if (a === 180) return [-1, 0];
  if (a === 270) return [0, -1];
  const r = (a * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
}

/**
 * FR-SCN-45: a template's handles in grid units: the origin, and the end: the far end of a cone
 * or line, a cube's far corner (its diagonal), the east point of a sphere / cylinder's rim.
 */
export function templateHandles(t: TemplateGeometry): Record<HandleKind, GridPoint> {
  const L = t.size / FT_PER_CELL;
  const origin = { x: t.x, y: t.y };
  if (t.shape === "sphere" || t.shape === "cylinder")
    return { origin, end: { x: t.x + L + halfBlock(t), y: t.y } };
  const [ux, uy] = unit(t.angle);
  if (t.shape === "cube") {
    const [nx, ny] = unit(t.angle + 90);
    return { origin, end: { x: t.x + (ux + nx) * L, y: t.y + (uy + ny) * L } };
  }
  return { origin, end: { x: t.x + ux * L, y: t.y + uy * L } };
}

/** The handle of `t` under `p` (grid units): its end handle only when `withEnd` (selected). */
export function handleAt(t: TemplateGeometry, p: GridPoint, withEnd: boolean): HandleKind | null {
  const h = templateHandles(t);
  const near = (q: GridPoint) => Math.hypot(q.x - p.x, q.y - p.y) <= HANDLE_HIT;
  if (withEnd && near(h.end)) return "end";
  return near(h.origin) ? "origin" : null;
}

/** The kept template whose origin handle is nearest `p` within the hit radius, if any. */
export function originHit<T extends TemplateGeometry>(kept: readonly T[], p: GridPoint): T | null {
  let best: T | null = null;
  let bestD = HANDLE_HIT;
  for (const t of kept) {
    const d = Math.hypot(t.x - p.x, t.y - p.y);
    if (d <= bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

/**
 * FR-SCN-45: the end handle dragged to `p` (grid units): cone / line aim at it, a cube's diagonal
 * aims at it, a sphere / cylinder takes its distance as the radius (5-ft steps). 15° steps unless
 * `free` (Ctrl). Under half a cell from the origin → unchanged.
 */
export function endEdit<T extends TemplateGeometry>(t: T, p: GridPoint, free: boolean): T {
  const dx = p.x - t.x;
  const dy = p.y - t.y;
  if (Math.hypot(dx, dy) < 0.5) return t;
  if (t.shape === "sphere" || t.shape === "cylinder") {
    return { ...t, size: radiusAt(Math.hypot(dx, dy), t) };
  }
  return { ...t, angle: aimAngle(dx, dy, t.shape, free) };
}

/**
 * FR-SCN-43 / -45 (#375): the origin handle of a `shape` template dragged to `p` (grid units):
 * snapped as a new placement (`aoeOrigin`: cell centre, token centre, cube vertex; Ctrl 0.01
 * cell); `null` while within `MOVE_MIN` of the press (a click keeps the origin).
 */
export function movedOrigin(
  shape: TemplateShape,
  press: GridPoint,
  p: GridPoint,
  o: SnapOptions,
): AoeOrigin | null {
  if (Math.hypot(p.x - press.x, p.y - press.y) < MOVE_MIN) return null;
  return aoeOrigin(shape, p, o);
}

export interface TemplateUpdate {
  templateId: string;
  x?: number;
  y?: number;
  angle?: number;
  size?: number;
  /** #377: a new origin block, or null (moved with Ctrl: the exact rule). */
  footprint?: number | null;
}

/** FR-SCN-45: release sends one `scn.updateTemplate` with the changed fields, or nothing. */
export function templateUpdate(
  id: string,
  before: TemplateGeometry,
  after: TemplateGeometry,
): TemplateUpdate | null {
  const patch: TemplateUpdate = { templateId: id };
  for (const k of ["x", "y", "angle", "size"] as const) {
    if (after[k] !== before[k]) patch[k] = after[k];
  }
  const fp = after.footprint ?? null;
  if (fp !== (before.footprint ?? null)) patch.footprint = fp;
  return Object.keys(patch).length > 1 ? patch : null;
}

// ---------- Clear templates (FR-SCN-44) ----------

/** FR-SCN-44: the kept templates of a scene the Clear dialog counts: DM-placed and players'. */
export function clearCounts(
  kept: readonly Pick<TemplateRecordView, "sceneId" | "placedByPlayerId">[],
  sceneId: string,
): { dm: number; players: number } {
  let dm = 0;
  let players = 0;
  for (const t of kept) {
    if (t.sceneId !== sceneId) continue;
    if (t.placedByPlayerId === null) dm++;
    else players++;
  }
  return { dm, players };
}

/** FR-SCN-44: how many the chosen scope deletes (Confirm is disabled at 0). */
export const clearScopeCount = (c: { dm: number; players: number }, players: boolean): number =>
  players ? c.dm + c.players : c.dm;

/** FR-SCN-44 / -34: Confirm needs something in scope and a live connection. */
export const clearConfirmEnabled = (n: number, live: boolean): boolean => n > 0 && live;

/** FR-SCN-44: the intent input (`players` absent = false). */
export const clearInput = (
  sceneId: string,
  players: boolean,
): { sceneId: string; players?: true } => (players ? { sceneId, players: true } : { sceneId });

/** FR-SCN-44: "Clear N DM templates on this scene?" */
export function clearTitle(dm: number): string {
  return `Clear ${dm} DM ${dm === 1 ? "template" : "templates"} on this scene?`;
}

/** Appendix A: `cells` attr = the squares as "c,r c,r …" (row-major). */
export const cellsAttr = (cells: readonly (readonly [number, number])[]): string =>
  cells.map(([c, r]) => `${c},${r}`).join(" ");

/** FR-SCN-21: "‹label› · N squares" (no label: "N squares"). */
export function templateCaption(label: string, n: number): string {
  const squares = `${n} ${n === 1 ? "square" : "squares"}`;
  return label ? `${label} · ${squares}` : squares;
}

/** FR-SCN-47: while hovered or selected the label also names its person ("· by Player 1"). */
export const templateCaptionBy = (label: string, n: number, byName: string | null) =>
  byName === null ? templateCaption(label, n) : `${templateCaption(label, n)} · by ${byName}`;

/**
 * FR-SCN-47: a drawn template's colour: its person's (`colorOf`; unknown → role accent), but a
 * hidden one keeps `visibility.hidden` styling (OQ-SCN-41 A).
 */
export function templateColor(
  store: Pick<RecordStore, "you" | "records">,
  who: MarkPerson,
  hidden: boolean,
  hiddenColor: string,
  read?: ReadVar,
): string {
  return hidden ? hiddenColor : markColor(store, who, read);
}

/** A kept record as drawn. */
export const keptView = (r: TemplateRecordView): TemplateView => ({
  shape: r.shape,
  x: r.x,
  y: r.y,
  size: r.size,
  width: r.width,
  angle: r.angle,
  ...(r.footprint ? { footprint: r.footprint } : {}),
  label: r.label,
});

/** FR-SCN-26: the DM edits any kept template; a player only one they placed. */
export function canEditTemplate(
  t: Pick<TemplateRecordView, "placedByPlayerId">,
  client: "dm" | "player",
  myPlayerId: string | null,
): boolean {
  return client === "dm" || (myPlayerId !== null && t.placedByPlayerId === myPlayerId);
}

/**
 * What the AoE tool may hit on the shown scene: the kept templates this client may edit, minus
 * hidden ones while the DM's "DM-only items" switch is off (not drawn, not hit; FR-SCN-05).
 */
export function pickableTemplates<
  T extends Pick<TemplateRecordView, "placedByPlayerId"> & { hidden: boolean },
>(kept: readonly T[], client: "dm" | "player", myPlayerId: string | null, dmOnlyOff: boolean): T[] {
  return kept.filter(
    (t) => canEditTemplate(t, client, myPlayerId) && !(dmOnlyOff && client === "dm" && t.hidden),
  );
}

// ---------- right-click menu (FR-SCN-48, -49) ----------

/** FR-SCN-49: a press this close (screen px) to a template's outline still hits it. */
export const TEMPLATE_HIT_PX = 6;

export interface TemplateHitOptions {
  client: "dm" | "player";
  myPlayerId: string | null;
  /** The DM's "DM-only items" switch is off: hidden ones are not drawn, so not hit. */
  dmOnlyOff: boolean;
  /** The DM's Layers switch "Templates" is off (FR-SCN-05): nothing hits. */
  templatesOff: boolean;
  /** FR-FOG-36: a blind player hits only their own kept templates. */
  blind: boolean;
  /** Camera scale (screen px per map px), for the 6 px tolerance. */
  scale: number;
  grid: Grid;
}

/** Distance (map px) from (x, y) to an outline's edge. */
function outlineDistance(o: TemplateOutline, x: number, y: number): number {
  if (o.kind === "circle") return Math.abs(Math.hypot(x - o.x, y - o.y) - o.r);
  let best = Number.POSITIVE_INFINITY;
  const n = o.points.length >> 1;
  for (let i = 0; i < n; i++) {
    const ax = o.points[2 * i] as number;
    const ay = o.points[2 * i + 1] as number;
    const bx = o.points[2 * ((i + 1) % n)] as number;
    const by = o.points[2 * ((i + 1) % n) + 1] as number;
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2;
    const k = len2 === 0 ? 0 : clamp(((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / len2, 0, 1);
    best = Math.min(best, Math.hypot(x - (ax + k * (bx - ax)), y - (ay + k * (by - ay))));
  }
  return best;
}

/**
 * FR-SCN-49: the topmost (last in draw order) kept template this client may edit (FR-SCN-26) whose
 * true outline (FR-SCN-42's `templateArea`, uncut: off the map's edge still hits) contains map
 * point `p` (map px) or lies within 6 screen px of it; else null. Hidden ones only for the DM
 * with DM-only items on; nothing while the Templates switch is off; a blind player only their own.
 */
export function templateAt<
  T extends TemplateGeometry & Pick<TemplateRecordView, "placedByPlayerId" | "hidden">,
>(p: GridPoint, templates: readonly T[], o: TemplateHitOptions): T | null {
  if (o.templatesOff) return null;
  const g = gridPoint(o.grid, p.x, p.y);
  const tol = TEMPLATE_HIT_PX / o.scale;
  for (let i = templates.length - 1; i >= 0; i--) {
    const t = templates[i] as T;
    if (!canEditTemplate(t, o.client, o.myPlayerId)) continue;
    if (t.hidden && (o.client !== "dm" || o.dmOnlyOff)) continue;
    if (o.blind && (o.myPlayerId === null || t.placedByPlayerId !== o.myPlayerId)) continue;
    if (isUnder(t, p, g, tol, o.grid)) return t;
  }
  return null;
}

/** FR-SCN-49 / -52: map point `p` (grid units `g`) inside `t`'s true outline or within `tol` map px. */
function isUnder(t: TemplateGeometry, p: GridPoint, g: GridPoint, tol: number, grid: Grid) {
  return (
    contains(templateArea(t), g.x, g.y) ||
    outlineDistance(templateOutline(t, grid), p.x, p.y) <= tol
  );
}

/** A label pill's rect in map px (as drawn now: grown while hovered or selected). */
export interface PillRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * FR-SCN-52: the id of the template the pointer hovers: the topmost (last in draw order) drawn
 * template whose true outline (uncut, as `templateAt`) contains map point `p` or lies within 6
 * screen px of it, or whose label pill (`pills`, as drawn: the hovered one grown) contains `p`.
 * Every drawn template counts, editable or not (no `templateAt` edit filter); else null. Because
 * the hovered pill is passed grown, hover ends only once `p` leaves both its area and that rect.
 */
export function templateUnder(
  p: GridPoint,
  drawn: readonly { id: string; template: TemplateGeometry }[],
  scale: number,
  grid: Grid,
  pills: Readonly<Record<string, PillRect>> = {},
): string | null {
  const g = gridPoint(grid, p.x, p.y);
  const tol = TEMPLATE_HIT_PX / scale;
  for (let i = drawn.length - 1; i >= 0; i--) {
    const d = drawn[i] as (typeof drawn)[number];
    const r = pills[d.id];
    if (r && p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height) return d.id;
    if (isUnder(d.template, p, g, tol, grid)) return d.id;
  }
  return null;
}

export type TemplateMenuItem = "delete" | "edit" | "hide";

export interface TemplateMenuEntry {
  item: TemplateMenuItem;
  label: string;
  disabled: boolean;
}

/**
 * FR-SCN-48 / -50: the menu's items for a template this client may edit: Delete, Edit…, and for
 * the DM Hide (Reveal when hidden). Disabled while not live; none for a template it may not edit.
 */
export function templateMenuItems(
  t: Pick<TemplateRecordView, "placedByPlayerId" | "hidden">,
  client: "dm" | "player",
  myPlayerId: string | null,
  live: boolean,
): TemplateMenuEntry[] {
  if (!canEditTemplate(t, client, myPlayerId)) return [];
  const disabled = !live;
  const out: TemplateMenuEntry[] = [
    { item: "delete", label: "Delete", disabled },
    { item: "edit", label: "Edit…", disabled },
  ];
  if (client === "dm") out.push({ item: "hide", label: t.hidden ? "Reveal" : "Hide", disabled });
  return out;
}

/**
 * FR-SCN-50: an open menu stays only while its template is one this client may edit on the shown
 * scene (`editable`); deleted, cleared, hidden for this player, a scene switch or a snapshot that
 * drops it close it.
 */
export function templateMenuStays(
  open: { templateId: string; sceneId: string } | null,
  editable: readonly { id: string }[],
  shownSceneId: string | null,
): boolean {
  return (
    open !== null && open.sceneId === shownSceneId && editable.some((t) => t.id === open.templateId)
  );
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
    ...(t.footprint ? { footprint: t.footprint } : {}),
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
  /** The server-stamped sender: its colour resolves at draw time (FR-SCN-47). */
  from: SignalFrom;
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
    ...(d.footprint ? { footprint: d.footprint } : {}),
    label: d.label ?? "",
  };
  s.setState((st) => ({
    byId: {
      ...st.byId,
      [id]: {
        id,
        sceneId: d.sceneId,
        from,
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
  if ((t.shape === "sphere" || t.shape === "cylinder") && t.footprint) {
    // #377: the stepped outline of its squares, so the outline and the tint agree.
    const area = templateArea(t);
    const pts = "polygon" in area ? area.polygon : [];
    return {
      kind: "poly",
      points: pts.map((v, i) => (i % 2 === 0 ? g.gridOffsetX : g.gridOffsetY) + v * cs),
    };
  }
  if (t.shape === "sphere" || t.shape === "cylinder") return { kind: "circle", x: ox, y: oy, r: L };
  if (t.shape === "cube") {
    // FR-SCN-20 (sprint 4): sides along `angle` and `angle + 90°` (0 / 90 / 180 / 270 = SE / SW /
    // NW / NE, as sprint 2's quadrants).
    const [ux, uy] = unit(t.angle);
    const [nx, ny] = unit(t.angle + 90);
    return {
      kind: "poly",
      points: [
        ox,
        oy,
        ox + ux * L,
        oy + uy * L,
        ox + (ux + nx) * L,
        oy + (uy + ny) * L,
        ox + nx * L,
        oy + ny * L,
      ],
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
