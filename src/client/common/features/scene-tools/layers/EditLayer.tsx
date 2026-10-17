// `scn-edit` canvas layer (order 48, DM, FR-SCN-02): drawing previews and handles, mounted only
// while a drawing tool is active (layer budget: 8, 9 while drawing). Each SCN tool slice adds one
// child line for its own previews.
import { Group } from "react-konva";
import { useCanvas } from "../../scenes-map/canvas-context";
import { StructureEditPreview } from "./StructureEditPreview";

export function ScnEditLayer() {
  const { drawing } = useCanvas();
  if (!drawing) return null;
  return (
    <Group name="scn-edit">
      <StructureEditPreview />
    </Group>
  );
}
