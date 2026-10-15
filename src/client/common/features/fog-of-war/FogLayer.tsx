// `fog` canvas layer (order 30, FR-FOG-20/21): the shown scene's fogged cells as one shape of
// row-run rects (`fog-mask`, `listening: false`), clipped to the map; translucent for the DM.
// Registered DM only until build/fog-visibility switches the player render on.
import { FOG_TYPE } from "@shared/fog-of-war/schemas";
import { useMemo } from "react";
import { Group, Layer, Shape } from "react-konva";
import { useCanvas } from "../scenes-map/canvas-context";
import {
  FOG_COLOR_FALLBACK,
  FOG_COLOR_VARS,
  type FogRecordLike,
  fogOpacity,
  fogRuns,
} from "./render";

function cssVar(name: string): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function FogLayer() {
  const { client, scene, grid, store } = useCanvas();
  const rec = (store.records[FOG_TYPE]?.[scene.id] ?? null) as FogRecordLike | null;
  const { mapWidth, mapHeight } = scene;
  const { gridCellSize, gridOffsetX, gridOffsetY } = grid;
  const render = useMemo(
    () => fogRuns(rec, { mapWidth, mapHeight, gridCellSize, gridOffsetX, gridOffsetY }),
    [rec, mapWidth, mapHeight, gridCellSize, gridOffsetX, gridOffsetY],
  );
  const fill = useMemo(() => cssVar(FOG_COLOR_VARS[client]) || FOG_COLOR_FALLBACK, [client]);
  return (
    <Layer name="fog-layer" listening={false}>
      {rec && (
        <Group clipX={0} clipY={0} clipWidth={mapWidth} clipHeight={mapHeight}>
          <Shape
            name="fog-mask"
            fill={fill}
            opacity={fogOpacity(client)}
            fogged-cells={render.cells}
            perfectDrawEnabled={false}
            sceneFunc={(ctx, shape) => {
              ctx.beginPath();
              for (const [x, y, w, h] of render.runs) ctx.rect(x, y, w, h);
              ctx.fillShape(shape);
            }}
          />
        </Group>
      )}
    </Layer>
  );
}
