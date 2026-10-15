// `scn-templates` canvas layer (order 35, FR-SCN-02, -21): above fog, below tokens. Empty in
// fix/scn-core; build/scene-tools-templates draws kept and ephemeral templates.
import { Layer } from "react-konva";

export function ScnTemplatesLayer() {
  return <Layer name="scn-templates" />;
}
