// An image item (FR-OVW-22, -23): the `display` file drawn whole in its `w × h`, never cropped. A
// failed load: the asset error tile, as props (OVW §7).
import { Group, Image, Line, Rect } from "react-konva";
import { useAssetImage } from "../../assets-pipeline/useAssetImage";
import { useOverviewCanvas } from "../overview-canvas-context";
import { HIDDEN_OPACITY, HiddenMark } from "./HiddenMark";
import type { ItemViewProps } from "./item-view";

export function ImageItem({ item, scale }: ItemViewProps) {
  const { colors } = useOverviewCanvas();
  const img = useAssetImage(item.assetId, "display");
  const w = item.w ?? 0;
  const h = item.h ?? 0;
  return (
    <>
      <Group opacity={item.hidden ? HIDDEN_OPACITY : 1}>
        {img.image ? (
          <Image
            image={img.image}
            width={w}
            height={h}
            name="ovw-image"
            perfectDrawEnabled={false}
          />
        ) : (
          <Group name={img.state === "error" ? "ovw-image-error" : "ovw-image-loading"}>
            <Rect
              width={w}
              height={h}
              fill={colors.muted}
              stroke={colors.border}
              strokeScaleEnabled={false}
            />
            {img.state === "error" && (
              <Line
                points={[0, 0, w, h, w, 0, 0, h]}
                stroke={colors.mutedForeground}
                strokeWidth={1.5}
                strokeScaleEnabled={false}
              />
            )}
          </Group>
        )}
      </Group>
      {item.hidden && <HiddenMark box={{ x: 0, y: 0, w, h }} scale={scale} />}
    </>
  );
}
