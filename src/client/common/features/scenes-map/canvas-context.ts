// What every canvas layer reads (FR-MAP-29): the shown scene, effective grid, tokens at their
// shown cells, camera, colours, pointer store, drag-preview store (FR-MAP-40), record store (token
// overlays, FR-MAP-34), DM selection + targeting (FR-MAP-31/33) and the host's token handlers.
import type { RecordStore } from "@shared/protocol/store";
import type { SceneView, TokenView } from "@shared/scenes-map/schemas";
import type Konva from "konva";
import { createContext, useContext } from "react";
import type { Camera } from "./camera";
import type { PreviewStore } from "./drag-preview";
import type { PointerStore } from "./pointers";
import type { CanvasColors } from "./theme";
import type { MapTool } from "./tool-store";
import type { CanvasToolDef } from "./tools";

export interface EffectiveGrid {
  gridCellSize: number;
  gridOffsetX: number;
  gridOffsetY: number;
  gridVisible: boolean;
  gridColor: string;
  gridOpacity: number;
}

export interface TokenHandlers {
  dragStart(t: TokenView, node: Konva.Node): void;
  dragMove(t: TokenView, node: Konva.Node): void;
  dragEnd(t: TokenView, node: Konva.Node): void;
  /** Left click; `toggle` = Ctrl or Shift held (FR-MAP-31). */
  click(t: TokenView, toggle: boolean): void;
  dblClick(t: TokenView): void;
}

export interface CanvasContextValue {
  client: "dm" | "player";
  scene: SceneView;
  grid: EffectiveGrid;
  /** Draw order (larger below smaller, then `seq`), at shown cells (move overlay applied). */
  tokens: TokenView[];
  cam: Camera;
  colors: CanvasColors;
  pointers: PointerStore;
  /** Others' drag previews + this client's own drag position (FR-MAP-40/42). */
  previews: PreviewStore;
  tool: MapTool;
  /** The active registry tool (FR-SCN-06), or null for a base tool. */
  activeTool: CanvasToolDef | null;
  /** A drawing tool is active: tokens ignore left-press; `scn-edit` mounts (FR-SCN-02). */
  drawing: boolean;
  live: boolean;
  myPlayerId: string | null;
  /** DM selection on this scene (FR-MAP-31); always empty on the player client. */
  selected: ReadonlySet<string>;
  /** FR-MAP-33: crosshair, token drag off. */
  targeting: boolean;
  store: RecordStore;
  canMove(t: TokenView): boolean;
  token: TokenHandlers;
}

export const CanvasContext = createContext<CanvasContextValue | null>(null);

export function useCanvas(): CanvasContextValue {
  const c = useContext(CanvasContext);
  if (!c) throw new Error("useCanvas outside MapCanvas");
  return c;
}

/**
 * The layer component contract (FR-MAP-29): a Konva `<Layer>` reading `useCanvas()`; a grouped
 * entry (FR-SCN-03 `group`) renders a Konva `<Group>` instead.
 */
export type CanvasLayerComponent = () => React.ReactNode;
