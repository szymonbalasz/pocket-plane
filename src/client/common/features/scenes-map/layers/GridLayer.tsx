// Grid layer: drawn as one shape over the map rectangle (MAP §7), 1 screen px wide lines.
import { Layer, Shape } from "react-konva";
import { useCanvas } from "../canvas-context";

export function GridLayer() {
  const { scene, grid, cam } = useCanvas();
  if (!grid.gridVisible) return <Layer listening={false} name="grid-layer" />;
  const { gridCellSize: cell, gridOffsetX: ox, gridOffsetY: oy } = grid;
  const w = scene.mapWidth;
  const h = scene.mapHeight;
  return (
    <Layer listening={false} name="grid-layer">
      <Shape
        name="map-grid"
        stroke={grid.gridColor}
        strokeWidth={1 / cam.scale}
        opacity={grid.gridOpacity}
        perfectDrawEnabled={false}
        sceneFunc={(ctx, shape) => {
          ctx.beginPath();
          for (let x = ox; x <= w; x += cell) {
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
          }
          for (let y = oy; y <= h; y += cell) {
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
          }
          ctx.strokeShape(shape);
        }}
      />
    </Layer>
  );
}
