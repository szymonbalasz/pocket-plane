// `scn-edit` canvas layer (order 48, DM, FR-SCN-02): drawing previews and handles, mounted only
// while a drawing tool is active (layer budget: 8, 9 while drawing). Empty in fix/scn-core; the SCN
// tool slices draw into it.
import { Layer } from "react-konva";
import { useCanvas } from "../../scenes-map/canvas-context";

export function ScnEditLayer() {
  const { drawing } = useCanvas();
  if (!drawing) return null;
  return <Layer name="scn-edit" />;
}
