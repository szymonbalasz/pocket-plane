// Canvas layer registry (FR-MAP-29, FR-SCN-02/03). APPEND-ONLY (AGENTS §9.9): a feature adds one
// import and one line, at a free order between its neighbours (`LAYER_ORDER`; fog 30 is FOG's),
// and picks one of the four Konva layers (`layer`: base < fog < objects < top, BL-07), never a new
// one. A layer is a component rendering one Konva `<Group>` that reads `useCanvas()`; MapCanvas
// wraps it in a Group named by its id; entries with a `group` share one more Group.
import { FogLayer } from "../fog-of-war/FogLayer";
import { FOG_LAYER_SWITCH } from "../fog-of-war/plain-map";
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
  { id: "map", order: LAYER_ORDER.map, layer: "base", component: MapLayer },
  { id: "grid", order: LAYER_ORDER.grid, layer: "base", component: GridLayer },
  { id: "tokens", order: LAYER_ORDER.tokens, layer: "objects", component: TokensLayer },
  // `map-labels` (FR-MAP-42): the labels Group inside `objects`, above the tokens.
  { id: "labels", order: LAYER_ORDER.labels, layer: "objects", component: LabelsLayer },
  { id: "pointers", order: LAYER_ORDER.pointers, layer: "top", component: PointersLayer },
  // scene-tools (FR-SCN-02): props + structure share the `scn-objects` Group.
  {
    id: "scn-props",
    order: LAYER_ORDER.scnProps,
    layer: "base",
    component: ScnPropsLayer,
    group: "scn-objects",
    toggle: { key: "props", label: "Props", layer: "objects" },
  },
  {
    id: "scn-structure",
    order: LAYER_ORDER.scnStructure,
    layer: "base",
    component: ScnStructureLayer,
    group: "scn-objects",
    toggle: { key: "walls", label: "Walls & doors", layer: "objects" },
  },
  {
    id: "scn-templates",
    order: LAYER_ORDER.scnTemplates,
    layer: "objects",
    component: ScnTemplatesLayer,
    toggle: { key: "templates", label: "Templates", layer: "objects" },
  },
  {
    id: "scn-edit",
    order: LAYER_ORDER.scnEdit,
    layer: "top",
    component: ScnEditLayer,
    clients: ["dm"],
  },
  // fog-of-war (FR-FOG-20/21): translucent for the DM (+ Fog tool draft), opaque for players.
  // The DM sees it only with the Fog tool, or with the Layers "Fog" switch on (sprint 4).
  {
    id: "fog",
    order: LAYER_ORDER.fog,
    layer: "fog",
    component: FogLayer,
    toggle: FOG_LAYER_SWITCH,
  },
]);
