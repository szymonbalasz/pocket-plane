// Map layer: the scene's `display` image; loading placeholder; broken-image placeholder on
// error, grid and tokens still render (MAP §7). A later record carrying the map re-arms a
// failed load (FR-ASSET-16).
import { useEffect } from "react";
import { Group, Image, Rect, Text } from "react-konva";
import { retryAssetImage, useAssetImage } from "../../assets-pipeline/useAssetImage";
import { useCanvas } from "../canvas-context";

export function MapLayer() {
  const { scene, colors, cam } = useCanvas();
  const img = useAssetImage(scene.mapAssetId, "display");
  useEffect(() => {
    retryAssetImage(scene.mapAssetId, "display");
  }, [scene]);
  const w = scene.mapWidth;
  const h = scene.mapHeight;
  return (
    <Group listening={false} name="map-layer">
      {img.image ? (
        <Image image={img.image} x={0} y={0} width={w} height={h} name="map-image" />
      ) : (
        <>
          <Rect x={0} y={0} width={w} height={h} fill={colors.muted} name="map-placeholder" />
          {img.state === "error" && (
            <Text
              name="map-image-error"
              text="Map image unavailable"
              x={0}
              y={h / 2 - 12 / cam.scale}
              width={w}
              align="center"
              fontSize={16 / cam.scale}
              fill={colors.mutedForeground}
            />
          )}
        </>
      )}
    </Group>
  );
}
