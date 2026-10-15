// `scn-props` canvas layer (order 20, FR-SCN-02, -18): a Konva Group in the shared `scn-objects`
// layer, below structure. Empty in fix/scn-core; build/scene-tools-props draws the props.
import { Group } from "react-konva";

export function ScnPropsLayer() {
  return <Group name="scn-props" />;
}
