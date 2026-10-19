// DM host of the Props tool's asset picker (FR-SCN-16, -17; FR-ASSET-17): the tool lives in `@ui`
// (the canvas tool registry), the picker in `@dm`. When the tool asks (`picking`), this opens the
// picker: "Choose image…" sets the image the next click places; the menu's "Image…" swaps a prop's
// image with `scn.updateProp {assetId}` (undoable, FR-SCN-15). Rendered once beside the DM rail.

import { AssetPickerDialog } from "@ui/features/assets-pipeline/AssetPicker";
import { updatePropFields, usePropTool } from "@ui/features/scene-tools/prop-tool";
import { toastReject, useMapIntent } from "@ui/features/scenes-map/intents";

export function ScnPropsDmHost() {
  const send = useMapIntent();
  const picking = usePropTool((s) => s.picking);
  const imageId = usePropTool((s) => s.imageId);
  const target = usePropTool((s) =>
    picking?.kind === "image" ? (s.props.find((p) => p.id === picking.propId) ?? null) : null,
  );
  if (!picking) return null;
  const close = () => usePropTool.setState({ picking: null });
  return (
    <AssetPickerDialog
      open
      onOpenChange={(o) => !o && close()}
      title={picking.kind === "place" ? "Prop image" : "Change prop image"}
      initialSelectedId={picking.kind === "place" ? imageId : (target?.assetId ?? null)}
      onSelect={(id) => {
        if (picking.kind === "place") {
          usePropTool.setState({ imageId: id });
        } else if (target) {
          updatePropFields(send, target, { assetId: id }).catch(toastReject);
        }
      }}
    />
  );
}
