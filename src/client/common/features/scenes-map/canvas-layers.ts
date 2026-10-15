// Canvas layer registry (FR-MAP-29, FR-SCN-02/03). APPEND-ONLY (AGENTS §9.9): a feature adds one
// import and one line, at a free order between its neighbours (`LAYER_ORDER`; fog 30 is FOG's).
// A layer is a component rendering one Konva `<Layer>` that reads `useCanvas()`; entries with a
// `group` render a Konva `<Group>` and share one `<Layer>` with their same-group neighbours.
import { FogLayer } from "../fog-of-war/FogLayer";
import { ScnEditLayer } from "../scene-tools/layers/EditLayer";
import { ScnPropsLayer } from "../scene-tools/layers/PropsLayer";
import { ScnStructureLayer } from "../scene-tools/layers/StructureLayer";
import { ScnTemplatesLayer } from "../scene-tools/layers/TemplatesLayer";
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
  // scene-tools (FR-SCN-02): props + structure share the `scn-objects` Konva layer.
  {
    id: "scn-props",
    order: LAYER_ORDER.scnProps,
    component: ScnPropsLayer,
    group: "scn-objects",
    toggle: { key: "props", label: "Props", layer: "objects" },
  },
  {
    id: "scn-structure",
    order: LAYER_ORDER.scnStructure,
    component: ScnStructureLayer,
    group: "scn-objects",
    toggle: { key: "walls", label: "Walls & doors", layer: "objects" },
  },
  {
    id: "scn-templates",
    order: LAYER_ORDER.scnTemplates,
    component: ScnTemplatesLayer,
    toggle: { key: "templates", label: "Templates", layer: "objects" },
  },
  { id: "scn-edit", order: LAYER_ORDER.scnEdit, component: ScnEditLayer, clients: ["dm"] },
  // fog-of-war (FR-FOG-20/21): translucent for the DM (+ Fog tool draft), opaque for players.
  { id: "fog", order: LAYER_ORDER.fog, component: FogLayer },
]);
