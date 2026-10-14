// Canvas layer registry (FR-MAP-29). APPEND-ONLY (AGENTS §9.9): a feature adds one import and one
// line, at a free order between its neighbours (props 20, fog 30 are reserved for scene-tools).
// A layer is a component rendering one Konva `<Layer>` that reads `useCanvas()`.
import { LAYER_ORDER, type LayerDef, orderLayers } from "./layers";
import { GridLayer } from "./layers/GridLayer";
import { LabelsLayer } from "./layers/LabelsLayer";
import { MapLayer } from "./layers/MapLayer";
import { PointersLayer } from "./layers/PointersLayer";
import { TokensLayer } from "./layers/TokensLayer";

export const canvasLayers: readonly LayerDef<object>[] = orderLayers<object>([
  { id: "map", order: LAYER_ORDER.map, component: MapLayer },
  { id: "grid", order: LAYER_ORDER.grid, component: GridLayer },
  { id: "tokens", order: LAYER_ORDER.tokens, component: TokensLayer },
  { id: "labels", order: LAYER_ORDER.labels, component: LabelsLayer },
  { id: "pointers", order: LAYER_ORDER.pointers, component: PointersLayer },
]);
