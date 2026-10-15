// `scn-structure` canvas layer (order 26, FR-SCN-02, -13, -14): a Konva Group in the shared
// `scn-objects` layer, above props. Empty in fix/scn-core; build/scene-tools-structure draws walls,
// doors and the DM's drag hint.
import { Group } from "react-konva";

export function ScnStructureLayer() {
  return <Group name="scn-structure" />;
}
