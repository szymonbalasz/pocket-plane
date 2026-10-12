// What every canvas layer reads (FR-MAP-29): the shown scene, effective grid, tokens at their
// shown cells, camera, colours, pointer store and the token handlers of the host canvas.
import type { SceneView, TokenView } from "@shared/scenes-map/schemas";
import type Konva from "konva";
import { createContext, useContext } from "react";
import type { Camera } from "./camera";
import type { PointerStore } from "./pointers";
import type { CanvasColors } from "./theme";
import type { MapTool } from "./tool-store";

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
  click(t: TokenView): void;
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
  tool: MapTool;
  live: boolean;
  myPlayerId: string | null;
  selectedTokenId: string | null;
  canMove(t: TokenView): boolean;
  token: TokenHandlers;
}

export const CanvasContext = createContext<CanvasContextValue | null>(null);

export function useCanvas(): CanvasContextValue {
  const c = useContext(CanvasContext);
  if (!c) throw new Error("useCanvas outside MapCanvas");
  return c;
}

/** The layer component contract (FR-MAP-29): a Konva `<Layer>` reading `useCanvas()`. */
export type CanvasLayerComponent = () => React.ReactNode;
