// Canvas tool registry core (FR-SCN-06, FR-FOG-17): the entry shape, validation and the pure
// dispatch rules MapCanvas follows. The registry itself is `canvas-tools.ts`. DOM-free so it runs
// under `bun test`.
import type { SceneView } from "@shared/scenes-map/schemas";
import type { CanvasClient } from "./layers";

/** The base tools every client has (MAP §7); registry ids must differ from these. */
export const BASE_TOOLS = ["select", "ruler", "ping"] as const;
export type BaseTool = (typeof BASE_TOOLS)[number];

export interface ToolGrid {
  gridCellSize: number;
  gridOffsetX: number;
  gridOffsetY: number;
}

/** One stage pointer event, as the active tool receives it. */
export interface ToolPointer {
  /** Map px (stage-relative). */
  x: number;
  y: number;
  /** The cell under the pointer (FR-MAP-14) and the nearest vertex (FR-SCN-08 snapping). */
  cell: { col: number; row: number };
  vertex: { x: number; y: number };
  /** Screen px (menus, popovers). */
  screen: { x: number; y: number };
  button: number;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
  /** Click count of a press (2 = double-click; FR-SCN-08 ends a polyline). */
  clicks: number;
  client: CanvasClient;
  /** The shown scene and its effective grid (grid edits preview, FR-MAP-10). */
  scene: SceneView;
  grid: ToolGrid;
  /** Sends a WS intent; resolves on `ack`, rejects on `reject` (show it with `toastReject`). */
  intent(name: string, input: unknown): Promise<unknown>;
  /** Sends a signal (e.g. `scn.template`). */
  signal(name: string, data: unknown): void;
}

/**
 * Why an in-progress gesture is dropped: Esc, another tool picked, the shown scene changed, the
 * client left `live` (FR-SCN-34, FR-FOG-22), or the canvas unmounted.
 */
export type ToolCancelReason = "escape" | "tool" | "scene" | "live" | "unmount";

export interface ToolPointerHandlers {
  /** Left press (not while Space pans). */
  down?(e: ToolPointer): void;
  /** Every pointer move over the stage (hover previews too). */
  move?(e: ToolPointer): void;
  /** Release of a press this tool received, anywhere on the page. */
  up?(e: ToolPointer): void;
  /** Drop any gesture in progress. Return true if one was dropped (Esc then stops there). */
  cancel?(reason: ToolCancelReason): boolean | undefined;
  /**
   * Right press on the stage, off tokens (FR-FOG-42: a darkness shape's menu). Return true to take
   * it (the tool opens its own menu); otherwise the laser starts as usual.
   */
  menu?(e: ToolPointer): boolean;
}

/** A canvas tool (FR-SCN-06): a rail button; with `pointer`, a drawing tool. */
export interface CanvasToolDef {
  /** Unique, kebab-case; the tool-store value and `map-tool-<id>` test id prefix. */
  id: string;
  label: string;
  icon: (props: { className?: string }) => unknown;
  clients: readonly CanvasClient[];
  /** Rail position after the base tools. */
  order: number;
  /** Shown beside the rail while the tool is active. */
  panel?: () => unknown;
  /** CSS cursor over the canvas while active (default `crosshair`). */
  cursor?: string;
  /** Stage pointer handlers: MapCanvas dispatches to the active tool's (FR-SCN-06). */
  pointer?: ToolPointerHandlers;
}

/** Validated, sorted copy; duplicate ids or orders, or a base tool id, throw at load. */
export function orderTools(tools: readonly CanvasToolDef[]): CanvasToolDef[] {
  const ids = new Set<string>(BASE_TOOLS);
  const orders = new Set<number>();
  for (const t of tools) {
    if (ids.has(t.id)) throw new Error(`Canvas tool "${t.id}" registered twice`);
    if (orders.has(t.order)) throw new Error(`Canvas tool order ${t.order} used twice`);
    ids.add(t.id);
    orders.add(t.order);
  }
  return [...tools].sort((a, b) => a.order - b.order);
}

/** The registry tools a client shows. */
export function toolsFor(tools: readonly CanvasToolDef[], client: CanvasClient): CanvasToolDef[] {
  return tools.filter((t) => t.clients.includes(client));
}

/** The active registry tool for a client, or null (a base tool, or one the client lacks). */
export function activeTool(
  tools: readonly CanvasToolDef[],
  tool: string,
  client: CanvasClient,
): CanvasToolDef | null {
  return tools.find((t) => t.id === tool && t.clients.includes(client)) ?? null;
}

/** A drawing tool: one with pointer handlers (tokens ignore left-press, Space pans). */
export const isDrawing = (t: CanvasToolDef | null): boolean => t?.pointer !== undefined;

/** FR-MAP-12 / FR-SCN-06: the stage pans with the Select tool, or with any tool while Space is held. */
export function stagePans(tool: string, space: boolean): boolean {
  return tool === "select" || space;
}

/** FR-SCN-06: a stage press goes to the active drawing tool: left button, live, Space not held. */
export function pressGoesToTool(
  def: CanvasToolDef | null,
  e: { button: number; space: boolean; live: boolean },
): boolean {
  return isDrawing(def) && e.button === 0 && !e.space && e.live;
}

/**
 * What a stage press does, decided in MapCanvas before any tool or Konva node sees it:
 * `pan` = a middle-mouse pan starts; `ignore` = swallowed (a middle press during a left-button
 * drag, OQ-MAP-45, or any press while a middle pan runs); `tool` = the active drawing tool's;
 * `canvas` = MapCanvas's own select / ruler / ping / laser handling.
 */
export type PointerIntent = "pan" | "ignore" | "tool" | "canvas";

/**
 * FR-MAP-12 (sprint 4): the middle mouse (button 1) pans with every tool and never reaches one
 * (`pressGoesToTool` stays left-only); ignored while the left button is down (`buttons` bit 1).
 */
export function pointerIntent(
  def: CanvasToolDef | null,
  e: { button: number; buttons: number; space: boolean; live: boolean; panning: boolean },
): PointerIntent {
  if (e.button === 1) return e.panning || (e.buttons & 1) !== 0 ? "ignore" : "pan";
  if (e.panning) return "ignore";
  return pressGoesToTool(def, e) ? "tool" : "canvas";
}

/**
 * FR-SCN-06: while a drawing tool is active, tokens take no left-press (no select, no
 * double-click, no drag); right-click menus still open.
 */
export function tokenTakesLeftPress(def: CanvasToolDef | null): boolean {
  return !isDrawing(def);
}

/** Esc order: a token drag, then a box select (FR-MAP-15 / -32), then the active tool. */
export function escapeOrder(
  dragging: boolean,
  boxing: boolean,
  def: CanvasToolDef | null,
): "drag" | "box" | "tool" | null {
  if (dragging) return "drag";
  if (boxing) return "box";
  return def?.pointer?.cancel ? "tool" : null;
}

/** Whether a key event comes from a field or button (Space then types or presses, not pans). */
export function typingTarget(target: unknown): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el) return false;
  return (
    el.isContentEditable === true ||
    el.tagName === "INPUT" ||
    el.tagName === "TEXTAREA" ||
    el.tagName === "SELECT" ||
    el.tagName === "BUTTON"
  );
}
